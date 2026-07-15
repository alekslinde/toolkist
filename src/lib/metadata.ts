// Client-side metadata detection + stripping for JPEG, PNG and WebP.
//
// Everything here operates on raw bytes so it runs entirely in the browser with
// no decode/re-encode step — stripping a JPEG rewrites its segment list, leaving
// the compressed image data byte-for-byte intact. The goal is twofold:
//   1. surface *what* privacy-relevant metadata a file carries (GPS, device,
//      timestamps, software, other), so the UI can teach, not just scrub; and
//   2. return a clean copy plus a list of exactly what was removed.
//
// PDF is handled separately in the tool page via pdf-lib (already a dependency),
// since it needs full document parsing rather than byte-segment surgery.

export type MetaCategory = 'location' | 'device' | 'timestamp' | 'software' | 'other';

export interface MetaField {
  /** Category used to group findings in the UI. */
  category: MetaCategory;
  /** Human-readable field name, e.g. "GPS Latitude", "Camera Model". */
  label: string;
  /** Decoded value when we could read one; null when we only know it is present. */
  value: string | null;
  /** Where it lives, e.g. "EXIF", "XMP", "iTXt:Software". Shown as a subtle tag. */
  source: string;
}

export interface MetadataResult {
  /** Format we detected, or 'unknown' when we don't handle it. */
  format: 'jpeg' | 'png' | 'webp' | 'unknown';
  /** Every metadata field found in the original file. */
  fields: MetaField[];
  /** Cleaned bytes with metadata removed. Same as input when nothing was found. */
  cleaned: Uint8Array;
  /** True when at least one field was found and removed. */
  changed: boolean;
}

// ── Format detection ────────────────────────────────────────────────────────

export function detectFormat(bytes: Uint8Array): MetadataResult['format'] {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) return 'webp';
  return 'unknown';
}

/**
 * Detect and strip metadata from an image byte buffer. Dispatches on the magic
 * bytes; returns an unchanged copy for formats we don't handle.
 */
export function processImage(bytes: Uint8Array): MetadataResult {
  const format = detectFormat(bytes);
  switch (format) {
    case 'jpeg': return processJpeg(bytes);
    case 'png': return processPng(bytes);
    case 'webp': return processWebp(bytes);
    default:
      return { format: 'unknown', fields: [], cleaned: bytes, changed: false };
  }
}

// ── JPEG ────────────────────────────────────────────────────────────────────
//
// A JPEG is SOI (FFD8) followed by marker segments. Metadata lives in the APPn
// segments: APP1 holds EXIF ("Exif\0\0…") and XMP ("http://ns.adobe.com/xap…"),
// APP13 holds Photoshop/IPTC, APP0 holds JFIF (kept — it's structural, not
// personal). We rebuild the file dropping the privacy-bearing APPn segments and
// stop copying once we reach compressed scan data (SOS, FFDA), which we append
// verbatim.

function processJpeg(bytes: Uint8Array): MetadataResult {
  const fields: MetaField[] = [];
  const kept: Array<[number, number]> = []; // [start, end) ranges to keep
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  kept.push([0, 2]); // SOI
  let off = 2;
  let removedAny = false;

  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) break; // not a marker — malformed; bail to safe append
    const marker = bytes[off + 1];

    // SOS (start of scan): everything from here is entropy-coded image data.
    if (marker === 0xda) {
      kept.push([off, bytes.length]);
      break;
    }
    // Standalone markers with no length (RSTn, TEM) — shouldn't appear here, keep and advance.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push([off, off + 2]);
      off += 2;
      continue;
    }

    const segLen = dv.getUint16(off + 2);
    const segEnd = off + 2 + segLen;
    if (segEnd > bytes.length) { kept.push([off, bytes.length]); break; }

    const isApp1 = marker === 0xe1;
    const isApp13 = marker === 0xed;
    const dataStart = off + 4;

    if (isApp1 && matchAscii(bytes, dataStart, 'Exif\0\0')) {
      fields.push(...parseExif(bytes, dataStart + 6, segEnd));
      removedAny = true;
    } else if (isApp1 && matchAscii(bytes, dataStart, 'http://ns.adobe.com/xap/')) {
      fields.push(...parseXmp(bytes, dataStart, segEnd, 'XMP'));
      removedAny = true;
    } else if (isApp13) {
      fields.push({ category: 'other', label: 'Photoshop / IPTC block', value: null, source: 'APP13' });
      removedAny = true;
    } else {
      kept.push([off, segEnd]); // APP0/JFIF, DQT, DHT, SOFn, COM, etc. — structural, keep
    }

    off = segEnd;
  }

  const cleaned = removedAny ? concatRanges(bytes, kept) : bytes;
  return { format: 'jpeg', fields, cleaned, changed: removedAny };
}

// Minimal EXIF (TIFF) reader: pulls out the human-meaningful, privacy-relevant
// tags. We deliberately don't decode every tag — just the ones that matter for
// the "what am I leaking" story, and note the rest generically.
function parseExif(bytes: Uint8Array, tiffStart: number, end: number): MetaField[] {
  const fields: MetaField[] = [];
  if (tiffStart + 8 > end) return fields;

  const le = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49; // 'II' little-endian
  const rd16 = (o: number) => (le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
  const rd32 = (o: number) =>
    le
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

  const readAscii = (valOff: number, count: number): string => {
    let s = '';
    for (let i = 0; i < count && valOff + i < end; i++) {
      const c = bytes[valOff + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };

  // Tags we care about, per IFD. Value bytes: type 2 = ASCII.
  const NAMED: Record<number, { label: string; category: MetaCategory }> = {
    0x010f: { label: 'Camera Make', category: 'device' },
    0x0110: { label: 'Camera Model', category: 'device' },
    0x0131: { label: 'Software', category: 'software' },
    0x0132: { label: 'Date/Time', category: 'timestamp' },
    0x9003: { label: 'Date/Time Original', category: 'timestamp' },
    0x9004: { label: 'Date/Time Digitised', category: 'timestamp' },
    0xa430: { label: 'Camera Owner', category: 'device' },
    0xa433: { label: 'Lens Make', category: 'device' },
    0xa434: { label: 'Lens Model', category: 'device' },
  };

  let hasGps = false;
  let hasExifSub = false;
  const seen = new Set<number>();

  const walkIfd = (ifdOff: number) => {
    if (ifdOff + 2 > end) return 0;
    const count = rd16(ifdOff);
    let entry = ifdOff + 2;
    for (let i = 0; i < count && entry + 12 <= end; i++, entry += 12) {
      const tag = rd16(entry);
      const type = rd16(entry + 2);
      const num = rd32(entry + 4);
      // Value is inline (<=4 bytes) or at an offset from tiffStart.
      const byteLen = type === 2 ? num : num * (type === 3 ? 2 : 4);
      const valOff = byteLen <= 4 ? entry + 8 : tiffStart + rd32(entry + 8);

      if (tag === 0x8769) { hasExifSub = true; if (!seen.has(0x8769)) { seen.add(0x8769); walkIfd(tiffStart + rd32(entry + 8)); } continue; }
      if (tag === 0x8825) { hasGps = true; continue; }

      const named = NAMED[tag];
      if (named && type === 2) {
        const v = readAscii(valOff, num);
        if (v) fields.push({ category: named.category, label: named.label, value: v, source: 'EXIF' });
      }
    }
    return entry + 4 <= end ? rd32(entry) : 0;
  };

  const ifd0 = rd32(tiffStart + 4);
  if (ifd0) walkIfd(tiffStart + ifd0);

  if (hasGps) fields.push({ category: 'location', label: 'GPS location', value: 'present', source: 'EXIF' });
  if (hasExifSub && !fields.some((f) => f.source === 'EXIF' && f.category === 'device'))
    fields.push({ category: 'other', label: 'Exif sub-IFD', value: null, source: 'EXIF' });
  if (fields.length === 0)
    fields.push({ category: 'other', label: 'EXIF block', value: null, source: 'EXIF' });

  return fields;
}

// ── PNG ───────────────────────────────────────────────────────────────────
//
// PNG metadata lives in ancillary chunks: tEXt/iTXt/zTXt (arbitrary text,
// including XMP and generator names), eXIf (embedded EXIF), tIME (last-modified),
// and iCCP/pHYs which we leave alone (colour/rendering, not personal). We copy
// through every chunk except the metadata ones.

const PNG_META_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

function processPng(bytes: Uint8Array): MetadataResult {
  const fields: MetaField[] = [];
  const kept: Array<[number, number]> = [[0, 8]]; // signature
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let removedAny = false;

  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = typeOf(bytes, off + 4);
    const chunkEnd = off + 12 + len; // len + type(4) + data + crc(4)
    if (chunkEnd > bytes.length) { kept.push([off, bytes.length]); break; }

    if (PNG_META_CHUNKS.has(type)) {
      fields.push(describePngChunk(bytes, off + 8, len, type));
      removedAny = true;
    } else {
      kept.push([off, chunkEnd]);
    }
    if (type === 'IEND') break;
    off = chunkEnd;
  }

  const cleaned = removedAny ? concatRanges(bytes, kept) : bytes;
  return { format: 'png', fields, cleaned, changed: removedAny };
}

function describePngChunk(bytes: Uint8Array, dataOff: number, len: number, type: string): MetaField {
  if (type === 'eXIf') return { category: 'other', label: 'Embedded EXIF', value: null, source: 'eXIf' };
  if (type === 'tIME') return { category: 'timestamp', label: 'Last-modified time', value: null, source: 'tIME' };
  // tEXt/iTXt/zTXt: keyword\0... — read the keyword (and value for uncompressed tEXt).
  const end = dataOff + len;
  let i = dataOff;
  let keyword = '';
  while (i < end && bytes[i] !== 0) keyword += String.fromCharCode(bytes[i++]);
  const cat: MetaCategory =
    /software|creat|program|tool/i.test(keyword) ? 'software'
    : /date|time/i.test(keyword) ? 'timestamp'
    : /xmp/i.test(keyword) ? 'other'
    : 'other';
  let value: string | null = null;
  if (type === 'tEXt' && i + 1 < end) value = latin1(bytes, i + 1, end).trim() || null;
  return { category: cat, label: keyword || `${type} chunk`, value, source: type };
}

// ── WebP ──────────────────────────────────────────────────────────────────
//
// WebP is a RIFF container: "RIFF" <size> "WEBP" then FourCC chunks. EXIF and
// XMP live in "EXIF" and "XMP " chunks; VP8/VP8L/VP8X/ALPH carry image data and
// stay. Dropping a metadata chunk means also clearing the "has metadata" bits in
// the VP8X header, and rewriting the top-level RIFF size.

function processWebp(bytes: Uint8Array): MetadataResult {
  const fields: MetaField[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Array<[number, number]> = [];
  let off = 12; // past "RIFF"<size>"WEBP"
  let removedAny = false;
  let vp8xOff = -1;

  while (off + 8 <= bytes.length) {
    const fourcc = typeOf(bytes, off);
    const size = dv.getUint32(off + 4, true);
    const padded = size + (size & 1); // chunks are even-padded
    const chunkEnd = off + 8 + padded;
    if (chunkEnd > bytes.length) { kept.push([off, bytes.length]); break; }

    if (fourcc === 'EXIF') {
      fields.push({ category: 'other', label: 'Embedded EXIF', value: null, source: 'EXIF chunk' });
      removedAny = true;
    } else if (fourcc === 'XMP ') {
      fields.push(...parseXmp(bytes, off + 8, off + 8 + size, 'XMP chunk'));
      removedAny = true;
    } else {
      if (fourcc === 'VP8X') vp8xOff = off;
      kept.push([off, chunkEnd]);
    }
    off = chunkEnd;
  }

  if (!removedAny) return { format: 'webp', fields, cleaned: bytes, changed: false };

  // Rebuild: keep header ranges, then fix up VP8X flags + RIFF size.
  const body = concatRanges(bytes, kept); // starts at offset 12 content... actually includes 0..12? no
  // kept only holds chunk ranges (>=12); prepend the 12-byte RIFF/WEBP header.
  const header = bytes.slice(0, 12);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);

  // Clear EXIF(bit3)/XMP(bit2) flags in the VP8X chunk if one is present.
  if (vp8xOff >= 0) {
    // vp8xOff was an offset into the original; its position in `out` is unchanged
    // because we kept every byte before the first removed chunk. The flags byte is
    // the first data byte of VP8X (at vp8xOff + 8).
    const flagsPos = vp8xOff + 8;
    if (flagsPos < out.length) out[flagsPos] &= ~0b0000_1100;
  }

  // Rewrite RIFF chunk size = total file size - 8.
  new DataView(out.buffer).setUint32(4, out.length - 8, true);

  return { format: 'webp', fields, cleaned: out, changed: true };
}

// ── XMP (shared JPEG/WebP) ──────────────────────────────────────────────────
// XMP is embedded RDF/XML. We don't fully parse it — we scan for the handful of
// tags that reveal location/device/software, so the report is meaningful.
function parseXmp(bytes: Uint8Array, start: number, end: number, source: string): MetaField[] {
  const xml = latin1(bytes, start, Math.min(end, start + 8192));
  const fields: MetaField[] = [];
  const has = (re: RegExp) => re.test(xml);
  if (has(/GPS|exif:GPS|geo:lat/i)) fields.push({ category: 'location', label: 'GPS location', value: 'present', source });
  if (has(/tiff:Make|tiff:Model/i)) fields.push({ category: 'device', label: 'Camera info', value: null, source });
  if (has(/CreatorTool|xmp:CreatorTool|Software/i)) fields.push({ category: 'software', label: 'Creator software', value: null, source });
  if (has(/CreateDate|ModifyDate|DateTimeOriginal/i)) fields.push({ category: 'timestamp', label: 'Timestamps', value: null, source });
  if (fields.length === 0) fields.push({ category: 'other', label: 'XMP metadata', value: null, source });
  return fields;
}

// ── Byte helpers ────────────────────────────────────────────────────────────

function typeOf(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

function matchAscii(bytes: Uint8Array, off: number, ascii: string): boolean {
  if (off + ascii.length > bytes.length) return false;
  for (let i = 0; i < ascii.length; i++) if (bytes[off + i] !== ascii.charCodeAt(i)) return false;
  return true;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function concatRanges(bytes: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  let total = 0;
  for (const [s, e] of ranges) total += e - s;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const [s, e] of ranges) { out.set(bytes.subarray(s, e), pos); pos += e - s; }
  return out;
}

/** Group fields by category, preserving first-seen order within each group. */
export function groupByCategory(fields: MetaField[]): Array<{ category: MetaCategory; fields: MetaField[] }> {
  const order: MetaCategory[] = ['location', 'device', 'timestamp', 'software', 'other'];
  return order
    .map((category) => ({ category, fields: fields.filter((f) => f.category === category) }))
    .filter((g) => g.fields.length > 0);
}

export const CATEGORY_META: Record<MetaCategory, { icon: string; title: string }> = {
  location: { icon: '📍', title: 'Location' },
  device: { icon: '📷', title: 'Device' },
  timestamp: { icon: '🕐', title: 'Timestamps' },
  software: { icon: '🏷️', title: 'Software' },
  other: { icon: '📄', title: 'Other' },
};
