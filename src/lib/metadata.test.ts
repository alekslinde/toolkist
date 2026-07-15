import { describe, it, expect } from 'vitest';
import { detectFormat, processImage, groupByCategory, type MetaField } from './metadata.js';

// ── Builders for minimal valid files ────────────────────────────────────────

function u16be(n: number): number[] { return [(n >> 8) & 0xff, n & 0xff]; }
function u32be(n: number): number[] { return [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; }
function ascii(s: string): number[] { return [...s].map((c) => c.charCodeAt(0)); }

/** JPEG: SOI + optional APP segments + SOS + a byte of "scan data" + EOI. */
function buildJpeg(segments: number[][]): Uint8Array {
  const bytes = [0xff, 0xd8];
  for (const seg of segments) bytes.push(...seg);
  bytes.push(0xff, 0xda, ...u16be(2)); // SOS with empty header for the test
  bytes.push(0xaa, 0xbb);              // pretend entropy-coded data
  bytes.push(0xff, 0xd9);             // EOI
  return new Uint8Array(bytes);
}

/** APP1 segment carrying an "Exif\0\0" TIFF header with an IFD0 Make tag. */
function exifApp1(): number[] {
  // TIFF (little-endian) with one IFD0 entry: Make (0x010f), ASCII "AC\0\0".
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, // 'II' 42
    ...u32leArr(8),          // IFD0 at offset 8
  ];
  const ifd = [
    ...u16leArr(1),                          // 1 entry
    ...u16leArr(0x010f), ...u16leArr(2), ...u32leArr(3), ...ascii('AC').concat([0, 0]), // Make = "AC"
    ...u32leArr(0),                          // next IFD = 0
  ];
  const tiffBlock = [...tiff, ...ifd];
  const payload = [...ascii('Exif'), 0, 0, ...tiffBlock];
  return [0xff, 0xe1, ...u16be(payload.length + 2), ...payload];
}
function u16leArr(n: number): number[] { return [n & 0xff, (n >> 8) & 0xff]; }
function u32leArr(n: number): number[] { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]; }

/** APP0 JFIF segment — structural, must survive stripping. */
function jfifApp0(): number[] {
  const payload = [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return [0xff, 0xe0, ...u16be(payload.length + 2), ...payload];
}

/** PNG: signature + IHDR + given chunks + IEND. */
function buildPng(chunks: number[][]): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk('IHDR', [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
  const iend = pngChunk('IEND', []);
  return new Uint8Array([...sig, ...ihdr, ...chunks.flat(), ...iend]);
}
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, ...u32be(0)]; // CRC unchecked by our reader
}

/** WebP (extended): RIFF/WEBP + VP8X + given chunks. */
function buildWebp(chunks: number[][]): Uint8Array {
  const vp8x = webpChunk('VP8X', [0b0000_1100, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // EXIF+XMP flags set
  const body = [...vp8x, ...chunks.flat()];
  const riff = [...ascii('RIFF'), ...u32leArr(body.length + 4), ...ascii('WEBP')];
  return new Uint8Array([...riff, ...body]);
}
function webpChunk(fourcc: string, data: number[]): number[] {
  const padded = data.length & 1 ? [...data, 0] : data;
  return [...ascii(fourcc), ...u32leArr(data.length), ...padded];
}

// ── detectFormat ─────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('recognises JPEG, PNG and WebP magic bytes', () => {
    expect(detectFormat(buildJpeg([]))).toBe('jpeg');
    expect(detectFormat(buildPng([]))).toBe('png');
    expect(detectFormat(buildWebp([]))).toBe('webp');
  });
  it('returns unknown for other data', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
  });
});

// ── JPEG ─────────────────────────────────────────────────────────────────────

describe('processImage — JPEG', () => {
  it('detects and removes EXIF while keeping JFIF and scan data', () => {
    const file = buildJpeg([jfifApp0(), exifApp1()]);
    const res = processImage(file);

    expect(res.format).toBe('jpeg');
    expect(res.changed).toBe(true);
    expect(res.fields.some((f) => f.source === 'EXIF')).toBe(true);
    expect(res.fields.some((f) => f.label === 'Camera Make' && f.value === 'AC')).toBe(true);

    // Cleaned file: no APP1 marker (0xFFE1) left, JFIF (0xFFE0) still present, scan data intact.
    expect(indexOfMarker(res.cleaned, 0xe1)).toBe(-1);
    expect(indexOfMarker(res.cleaned, 0xe0)).toBeGreaterThan(-1);
    expect(res.cleaned).toContain(0xaa); // entropy-coded byte survived
    expect(detectFormat(res.cleaned)).toBe('jpeg');
  });

  it('is a no-op when there is no metadata', () => {
    const file = buildJpeg([jfifApp0()]);
    const res = processImage(file);
    expect(res.changed).toBe(false);
    expect(res.fields).toHaveLength(0);
    expect(res.cleaned).toBe(file); // same reference — unchanged
  });
});

// ── PNG ──────────────────────────────────────────────────────────────────────

describe('processImage — PNG', () => {
  it('strips tEXt/tIME chunks but keeps IHDR/IEND', () => {
    const text = pngChunk('tEXt', [...ascii('Software'), 0, ...ascii('Lightroom')]);
    const time = pngChunk('tIME', [0x07, 0xe8, 1, 1, 0, 0, 0]);
    const file = buildPng([text, time]);
    const res = processImage(file);

    expect(res.format).toBe('png');
    expect(res.changed).toBe(true);
    expect(res.fields.some((f) => f.label === 'Software' && f.value === 'Lightroom')).toBe(true);
    expect(res.fields.some((f) => f.category === 'timestamp')).toBe(true);
    expect(detectFormat(res.cleaned)).toBe('png');
    // No tEXt/tIME left in cleaned output.
    expect(hasAscii(res.cleaned, 'tEXt')).toBe(false);
    expect(hasAscii(res.cleaned, 'tIME')).toBe(false);
    expect(hasAscii(res.cleaned, 'IEND')).toBe(true);
  });

  it('is a no-op for a bare PNG', () => {
    const res = processImage(buildPng([]));
    expect(res.changed).toBe(false);
    expect(res.fields).toHaveLength(0);
  });
});

// ── WebP ─────────────────────────────────────────────────────────────────────

describe('processImage — WebP', () => {
  it('removes EXIF/XMP chunks and clears VP8X flags + fixes RIFF size', () => {
    const exif = webpChunk('EXIF', [1, 2, 3, 4]);
    const xmp = webpChunk('XMP ', ascii('<x:xmpmeta><GPS/></x:xmpmeta>'));
    const file = buildWebp([exif, xmp]);
    const res = processImage(file);

    expect(res.format).toBe('webp');
    expect(res.changed).toBe(true);
    expect(res.fields.some((f) => f.category === 'location')).toBe(true);
    expect(hasAscii(res.cleaned, 'EXIF')).toBe(false);
    expect(hasAscii(res.cleaned, 'XMP ')).toBe(false);
    expect(detectFormat(res.cleaned)).toBe('webp');

    // RIFF size field must equal file length - 8.
    const dv = new DataView(res.cleaned.buffer, res.cleaned.byteOffset, res.cleaned.byteLength);
    expect(dv.getUint32(4, true)).toBe(res.cleaned.length - 8);

    // VP8X flags byte (first data byte of VP8X, at offset 12+8=20) has EXIF/XMP bits cleared.
    expect(res.cleaned[20] & 0b0000_1100).toBe(0);
  });
});

// ── HEIC / AVIF (ISOBMFF, detect-only) ───────────────────────────────────────

/** An ISOBMFF box: [size:4][type:4][payload]. */
function box(type: string, payload: number[]): number[] {
  return [...u32be(payload.length + 8), ...ascii(type), ...payload];
}
/** infe v2 FullBox naming a 4-char item type with the given item_id. */
function infe(itemType: string, itemId: number): number[] {
  // version(1)=2, flags(3)=0, item_id(2), protection(2)=0, item_type(4)
  return box('infe', [2, 0, 0, 0, ...u16be(itemId), 0, 0, ...ascii(itemType)]);
}

/** A little-endian TIFF/EXIF block; includes a GPS IFD pointer when withGps. */
function exifTiff(withGps: boolean): number[] {
  const entries: number[] = [];
  const add = (tag: number, type: number, count: number, val: number[]) =>
    entries.push(...u16leArr(tag), ...u16leArr(type), ...u32leArr(count), ...val);
  // Make (ASCII "AC\0\0" inline).
  add(0x010f, 2, 3, [...ascii('AC'), 0, 0]);
  if (withGps) add(0x8825, 4, 1, u32leArr(0)); // GPS IFD pointer (offset value unused by reader)
  const nEntries = withGps ? 2 : 1;
  const tiff = [
    0x49, 0x49, 0x2a, 0x00,   // 'II' 42
    ...u32leArr(8),           // IFD0 at offset 8
    ...u16leArr(nEntries),    // entry count
    ...entries,
    ...u32leArr(0),           // next IFD = 0
  ];
  // Exif item payload = [tiff_header_offset:4 big-endian][TIFF block].
  return [...u32be(0), ...tiff];
}

/**
 * ftyp + meta(iinf + iloc + Exif payload). `mimeItem` adds an XMP "mime" item;
 * `exif` embeds a real Exif item located via iloc so the reader can parse it.
 */
function buildHeic(brand: string, opts: { exif?: 'gps' | 'nogps'; mimeItem?: boolean } = {}): Uint8Array {
  const items: Array<{ id: number; type: string }> = [];
  if (opts.exif) items.push({ id: 1, type: 'Exif' });
  if (opts.mimeItem) items.push({ id: 2, type: 'mime' });

  const infes = items.map((it) => infe(it.type, it.id)).flat();
  const iinf = box('iinf', [0, 0, 0, 0, ...u16be(items.length), ...infes]);

  // The Exif payload lives in an mdat after meta; we compute its absolute offset
  // once the header sizes are known. Build meta twice: first to size it, then to
  // fill the real offset. Simpler: place mdat first, then meta references it.
  const exifBytes = opts.exif ? exifTiff(opts.exif === 'gps') : [];
  const ftyp = box('ftyp', [...ascii(brand), 0, 0, 0, 0, ...ascii(brand)]);
  const mdat = box('mdat', exifBytes);
  // Exif payload offset = ftyp + mdat header(8) into the file.
  const exifOffset = ftyp.length + 8;

  // iloc v1 (big-endian, as all ISOBMFF fields are): offset_size=4, length_size=4,
  // base_offset_size=0, index_size=0, one item with one extent.
  const iloc = opts.exif
    ? box('iloc', [
        1, 0, 0, 0,                        // version=1, flags
        0x44,                              // offset_size=4, length_size=4
        0x00,                              // base_offset_size=0, index_size=0
        ...u16be(1),                       // item_count=1
        ...u16be(1),                       // item_id=1
        ...u16be(0),                       // construction_method=0 (reserved+method)
        ...u16be(0),                       // data_reference_index
        ...u16be(1),                       // extent_count=1
        ...u32be(exifOffset),              // extent_offset
        ...u32be(exifBytes.length),        // extent_length
      ])
    : [];

  const meta = box('meta', [0, 0, 0, 0, ...iinf, ...iloc]);
  return new Uint8Array([...ftyp, ...mdat, ...meta]);
}

describe('detectFormat — HEIC/AVIF', () => {
  it('distinguishes HEIC and AVIF by ftyp brand', () => {
    expect(detectFormat(buildHeic('heic'))).toBe('heic');
    expect(detectFormat(buildHeic('mif1'))).toBe('heic');
    expect(detectFormat(buildHeic('avif'))).toBe('avif');
  });
});

describe('processImage — HEIC/AVIF (detect-only)', () => {
  it('reads the real EXIF and reports GPS only when a GPS IFD is present', () => {
    const res = processImage(buildHeic('heic', { exif: 'gps', mimeItem: true }));
    expect(res.format).toBe('heic');
    expect(res.detectOnly).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.fields.some((f) => f.category === 'location')).toBe(true); // GPS present
    expect(res.fields.some((f) => f.source === 'XMP')).toBe(true);
  });

  it('does NOT report GPS when the EXIF has no GPS IFD', () => {
    const res = processImage(buildHeic('heic', { exif: 'nogps' }));
    expect(res.fields.some((f) => f.category === 'location')).toBe(false);
    // But it did read device info from the real EXIF (Make = "AC").
    expect(res.fields.some((f) => f.category === 'device')).toBe(true);
  });

  it('reports no fields for an ISOBMFF file with no metadata items', () => {
    const res = processImage(buildHeic('avif'));
    expect(res.format).toBe('avif');
    expect(res.detectOnly).toBe(true);
    expect(res.fields).toHaveLength(0);
  });
});

// ── grouping ─────────────────────────────────────────────────────────────────

describe('groupByCategory', () => {
  it('orders groups location→device→timestamp→software→other and drops empties', () => {
    const fields: MetaField[] = [
      { category: 'software', label: 'A', value: null, source: 's' },
      { category: 'location', label: 'B', value: null, source: 's' },
      { category: 'device', label: 'C', value: null, source: 's' },
    ];
    const groups = groupByCategory(fields);
    expect(groups.map((g) => g.category)).toEqual(['location', 'device', 'software']);
  });
});

// ── test helpers ─────────────────────────────────────────────────────────────

function indexOfMarker(bytes: Uint8Array, marker: number): number {
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === marker) return i;
  return -1;
}
function hasAscii(bytes: Uint8Array, s: string): boolean {
  const codes = [...s].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + codes.length <= bytes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return true;
  }
  return false;
}
