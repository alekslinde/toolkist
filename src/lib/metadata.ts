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

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'unknown';

export interface MetadataResult {
  /** Format we detected, or 'unknown' when we don't handle it. */
  format: ImageFormat;
  /** Every metadata field found in the original file. */
  fields: MetaField[];
  /** Cleaned bytes with metadata removed. Same as input when nothing was found. */
  cleaned: Uint8Array;
  /** True when at least one field was found and removed. */
  changed: boolean;
  /**
   * True for formats we can *detect* metadata in but not strip in place (HEIC,
   * AVIF — ISOBMFF containers that need box-tree offset rewriting). The tool
   * reports what was found and directs the user to convert the file instead.
   */
  detectOnly: boolean;
}

// ── Format detection ────────────────────────────────────────────────────────

export function detectFormat(bytes: Uint8Array): ImageFormat {
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
  // ISOBMFF (HEIC/AVIF): "....ftyp<brand>" — box size(4) + "ftyp"(4) + major brand(4).
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 // "ftyp"
  ) {
    const brand = typeOf(bytes, 8);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
    if (/^(avif|avis)$/.test(brand)) return 'avif';
  }
  return 'unknown';
}

/**
 * Detect and strip metadata from an image byte buffer. Dispatches on the magic
 * bytes; returns an unchanged copy for formats we don't handle. HEIC/AVIF are
 * detect-only: their metadata is reported but not stripped (see detectOnly).
 */
export function processImage(bytes: Uint8Array): MetadataResult {
  const format = detectFormat(bytes);
  switch (format) {
    case 'jpeg': return processJpeg(bytes);
    case 'png': return processPng(bytes);
    case 'webp': return processWebp(bytes);
    case 'heic':
    case 'avif':
      return {
        format,
        fields: detectIsobmffMeta(bytes),
        cleaned: bytes,
        changed: false,
        detectOnly: true,
      };
    default:
      return { format: 'unknown', fields: [], cleaned: bytes, changed: false, detectOnly: false };
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
  return { format: 'jpeg', fields, cleaned, changed: removedAny, detectOnly: false };
}

// Bytes per component for each TIFF field type (1-based index). 0 = unknown.
// 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 6 SBYTE, 7 UNDEFINED, 8 SSHORT,
// 9 SLONG, 10 SRATIONAL, 11 FLOAT, 12 DOUBLE.
const TIFF_TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

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
      // Value is inline when it fits in the 4-byte value field, else at an offset
      // from tiffStart. byteLen uses the component size for the TIFF type so that
      // 8-byte types (RATIONAL/SRATIONAL/DOUBLE) aren't mistaken for inline.
      const compSize = TIFF_TYPE_SIZE[type] ?? 0; // 0 = unknown type
      const byteLen = num * compSize;
      // Unknown types (compSize 0) fall back to the offset read, which is the
      // safe default for any value that can't be proven to fit inline.
      const valOff = compSize > 0 && byteLen <= 4 ? entry + 8 : tiffStart + rd32(entry + 8);

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
  return { format: 'png', fields, cleaned, changed: removedAny, detectOnly: false };
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

  let hasVp8x = false;
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
      if (fourcc === 'VP8X') hasVp8x = true;
      kept.push([off, chunkEnd]);
    }
    off = chunkEnd;
  }

  if (!removedAny) return { format: 'webp', fields, cleaned: bytes, changed: false, detectOnly: false };

  // Rebuild: prepend the 12-byte RIFF/WEBP header to the kept chunk ranges.
  const body = concatRanges(bytes, kept);
  const header = bytes.slice(0, 12);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);

  // Clear the EXIF(bit3)/XMP(bit2) flags in VP8X. Locate VP8X in the *rebuilt*
  // output by scanning its chunk list, so a stale original offset can't mask the
  // wrong byte regardless of chunk ordering.
  if (hasVp8x) {
    const outDv = new DataView(out.buffer);
    let o = 12;
    while (o + 8 <= out.length) {
      const fourcc = typeOf(out, o);
      const size = outDv.getUint32(o + 4, true);
      if (fourcc === 'VP8X') { out[o + 8] &= ~0b0000_1100; break; }
      o += 8 + size + (size & 1);
    }
  }

  // Rewrite RIFF chunk size = total file size - 8.
  new DataView(out.buffer).setUint32(4, out.length - 8, true);

  return { format: 'webp', fields, cleaned: out, changed: true, detectOnly: false };
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

// ── HEIC / AVIF (ISOBMFF, detect-only) ──────────────────────────────────────
//
// HEIC and AVIF are ISO Base Media File Format containers: a tree of boxes
// [size:4][type:4][…]. Metadata items are declared in meta → iinf → infe entries
// (each naming an item type like "Exif" or "mime" for XMP) and their bytes live
// in mdat/idat, located via the iloc box. Stripping them means rewriting the box
// tree and recomputing every iloc offset — error-prone enough that we only
// *detect* here and steer the user to convert the file (a re-encode drops it).
function detectIsobmffMeta(bytes: Uint8Array): MetaField[] {
  const fields: MetaField[] = [];
  const meta = findBox(bytes, 0, bytes.length, 'meta');
  if (!meta) return fields;

  // `meta` is a FullBox: 4 bytes of version/flags precede its child boxes.
  const iinf = findBox(bytes, meta.contentStart + 4, meta.end, 'iinf');
  if (!iinf) {
    fields.push({ category: 'other', label: 'Embedded metadata', value: null, source: 'HEIF meta' });
    return fields;
  }

  // iinf is a FullBox: version/flags(4), then entry_count (2 bytes for version 0,
  // 4 bytes otherwise), then exactly entry_count infe child boxes. Walk by the
  // declared count so a malformed or unexpected box can't desync the scan.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iinfVer = bytes[iinf.contentStart];
  const countOff = iinf.contentStart + 4;
  const entryCount = iinfVer === 0 ? dv.getUint16(countOff) : dv.getUint32(countOff);
  let scan = countOff + (iinfVer === 0 ? 2 : 4);

  // Map each Exif/mime item to its item_id so we can locate its bytes via iloc.
  const exifItemIds: number[] = [];
  let hasXmp = false, hasOther = false;
  for (let i = 0; i < entryCount && scan + 8 <= iinf.end; i++) {
    const infe = readBoxHeader(bytes, scan, iinf.end);
    if (!infe) break;
    if (infe.type === 'infe') {
      const info = infeItemInfo(bytes, infe);
      if (info?.type === 'Exif') exifItemIds.push(info.itemId);
      else if (info?.type === 'mime') hasXmp = true; // XMP is stored as a "mime" item
      else if (info?.type) hasOther = true;
    }
    scan = infe.end;
  }

  // Resolve the first Exif item's actual bytes via iloc and read it with the same
  // TIFF reader used for JPEG, so GPS/device/timestamp reporting is precise rather
  // than a blanket "may be present" guess.
  let exifRead = false;
  for (const id of exifItemIds) {
    const loc = resolveItemBytes(bytes, meta, id);
    if (!loc) continue;
    // The Exif item payload is: [tiff_header_offset:4][TIFF block…].
    if (loc.end - loc.start < 8) continue;
    const tiffOff = loc.start + 4 + dv.getUint32(loc.start);
    if (tiffOff + 8 > loc.end || tiffOff + 8 > bytes.length) continue;
    fields.push(...parseExif(bytes, tiffOff, Math.min(loc.end, bytes.length)));
    exifRead = true;
    break;
  }
  // Exif item present but we couldn't resolve/parse it — fall back to a cautious note.
  if (exifItemIds.length > 0 && !exifRead)
    fields.push({ category: 'other', label: 'EXIF metadata', value: null, source: 'EXIF' });

  if (hasXmp) fields.push({ category: 'other', label: 'XMP metadata', value: null, source: 'XMP' });
  if (exifItemIds.length === 0 && !hasXmp && hasOther)
    fields.push({ category: 'other', label: 'Embedded metadata', value: null, source: 'HEIF meta' });
  return fields;
}

// Resolve an item's byte range [start, end) from the meta box's iloc table.
// Supports the common construction_method 0 (offset from file start) with a
// single extent — enough to reach the Exif payload in real HEIC/AVIF files.
function resolveItemBytes(bytes: Uint8Array, meta: Box, itemId: number): { start: number; end: number } | null {
  const iloc = findBox(bytes, meta.contentStart + 4, meta.end, 'iloc');
  if (!iloc) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = iloc.contentStart;
  const version = bytes[p];
  p += 4; // version + flags

  if (p + 2 > iloc.end) return null;
  const sizes = dv.getUint16(p); p += 2;
  const offsetSize = (sizes >> 12) & 0xf;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseOffsetSize = (sizes >> 4) & 0xf;
  const indexSize = version >= 1 ? sizes & 0xf : 0;

  const itemCount = version < 2 ? dv.getUint16(p) : dv.getUint32(p);
  p += version < 2 ? 2 : 4;

  const readN = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + bytes[p + i];
    p += n;
    return v;
  };

  for (let i = 0; i < itemCount && p < iloc.end; i++) {
    const id = version < 2 ? dv.getUint16(p) : dv.getUint32(p);
    p += version < 2 ? 2 : 4;
    if (version === 1 || version === 2) p += 2; // reserved(12 bits) + construction_method
    p += 2; // data_reference_index
    const baseOffset = readN(baseOffsetSize);
    const extentCount = dv.getUint16(p); p += 2;

    for (let e = 0; e < extentCount; e++) {
      if (indexSize) p += indexSize;
      const extentOffset = readN(offsetSize);
      const extentLength = readN(lengthSize);
      if (id === itemId) {
        const start = baseOffset + extentOffset;
        return { start, end: start + extentLength };
      }
    }
  }
  return null;
}

interface Box { type: string; start: number; contentStart: number; end: number; }

// Read one box header at `off`. Handles 64-bit sizes (size === 1) and
// size === 0 ("to end of file").
function readBoxHeader(bytes: Uint8Array, off: number, limit = bytes.length): Box | null {
  if (off + 8 > limit) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = dv.getUint32(off);
  const type = typeOf(bytes, off + 4);
  let contentStart = off + 8;
  if (size === 1) {
    if (off + 16 > limit) return null;
    const hi = dv.getUint32(off + 8), lo = dv.getUint32(off + 12);
    size = hi * 2 ** 32 + lo;
    contentStart = off + 16;
  } else if (size === 0) {
    size = limit - off;
  }
  const end = off + size;
  if (end > limit || end <= off) return null;
  return { type, start: off, contentStart, end };
}

// Scan sibling boxes in [start, end) for the first one of `type`.
function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  let off = start;
  while (off + 8 <= end) {
    const box = readBoxHeader(bytes, off, end);
    if (!box) return null;
    if (box.type === type) return box;
    off = box.end;
  }
  return null;
}

// infe (item info entry) FullBox: version/flags(4), then for versions ≥ 2:
//   v2: item_id(2) protection_index(2) item_type(4)
//   v3: item_id(4) protection_index(2) item_type(4)
// Returns the item_id and 4-char item type.
function infeItemInfo(bytes: Uint8Array, box: Box): { itemId: number; type: string } | null {
  const version = bytes[box.contentStart];
  if (version < 2) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = box.contentStart + 4; // past version+flags
  const idSize = version === 2 ? 2 : 4;
  const itemId = version === 2 ? dv.getUint16(p) : dv.getUint32(p);
  const typeOff = p + idSize + 2; // + protection_index(2)
  if (typeOff + 4 > box.end) return null;
  return { itemId, type: typeOf(bytes, typeOff) };
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
