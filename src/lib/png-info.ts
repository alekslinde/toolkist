// Lightweight PNG header/chunk reader — parses the encoder choices baked into a
// PNG file without decompressing pixel data. Used to predict whether a lossless
// re-encode (e.g. via Canvas) would enlarge the file, so the UI can warn up front.

export const PNG_COLOR_TYPE = {
  GRAYSCALE: 0,
  TRUECOLOR: 2,
  PALETTE: 3,
  GRAYSCALE_ALPHA: 4,
  TRUECOLOR_ALPHA: 6,
} as const;

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  /** IHDR colour type: 0 gray · 2 truecolor · 3 palette · 4 gray+α · 6 truecolor+α */
  colorType: number;
  interlaced: boolean;
  /** true when colorType === 3 (indexed / "PNG-8") */
  isPalette: boolean;
  /** Number of PLTE entries, if a palette is present. */
  paletteColors: number | null;
  /** True if a tRNS chunk is present (palette or colour-key transparency). */
  hasTransparency: boolean;
  /** Value of a tEXt/iTXt "Software" entry, if present (often names the encoder). */
  software: string | null;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Returns true if the bytes begin with the 8-byte PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false;
  return true;
}

/**
 * Parse a PNG's IHDR plus a few informative chunks (PLTE, tRNS, tEXt/iTXt).
 * Only reads chunk headers and small ancillary chunks — never decompresses IDAT.
 * Returns null if the input is not a valid PNG or the header is truncated.
 */
export function parsePngInfo(bytes: Uint8Array): PngInfo | null {
  if (!isPng(bytes) || bytes.length < 33) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // IHDR must be the first chunk: length(4)+type(4) start at offset 8, data at 16.
  if (dv.getUint32(8) !== 13) return null;                 // IHDR length must be 13
  if (readType(bytes, 12) !== 'IHDR') return null;

  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlaced = bytes[28] === 1;

  let paletteColors: number | null = null;
  let hasTransparency = false;
  let software: string | null = null;

  // Walk remaining chunks: [length:4][type:4][data:length][crc:4].
  let off = 8 + 12 + 13; // past IHDR (data starts at 16, len 13, +4 crc) = offset 33
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = readType(bytes, off + 4);
    const dataOff = off + 8;
    if (dataOff + len > bytes.length) break; // truncated chunk — stop safely

    if (type === 'PLTE') {
      paletteColors = Math.floor(len / 3);
    } else if (type === 'tRNS') {
      hasTransparency = true;
    } else if (type === 'tEXt' || type === 'iTXt') {
      const parsed = readSoftware(bytes, dataOff, len, type === 'iTXt');
      if (parsed) software = parsed;
    } else if (type === 'IEND') {
      break;
    }

    off = dataOff + len + 4; // + CRC
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    interlaced,
    isPalette: colorType === PNG_COLOR_TYPE.PALETTE,
    paletteColors,
    hasTransparency,
    software,
  };
}

/**
 * Heuristic: would a lossless truecolor re-encode (e.g. canvas.toBlob) likely
 * enlarge this PNG? True for indexed/palette PNGs and low-bit-depth images,
 * whose per-pixel storage is smaller than the 32-bit RGBA Canvas produces.
 */
export function wouldLosslessReencodeGrow(info: PngInfo): boolean {
  if (info.isPalette) return true;                    // indexed → truecolor always grows
  if (info.colorType === PNG_COLOR_TYPE.GRAYSCALE ||
      info.colorType === PNG_COLOR_TYPE.GRAYSCALE_ALPHA) return true; // gray → RGBA grows
  if (info.bitDepth < 8) return true;                 // sub-byte depth expands to 8-bit
  return false;
}

function readType(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

// tEXt: keyword\0text (Latin-1). iTXt: keyword\0 compFlag compMethod lang\0 transKeyword\0 text (UTF-8).
function readSoftware(bytes: Uint8Array, dataOff: number, len: number, isIntl: boolean): string | null {
  const end = dataOff + len;
  let i = dataOff;
  let keyword = '';
  while (i < end && bytes[i] !== 0) keyword += String.fromCharCode(bytes[i++]);
  if (keyword !== 'Software') return null;
  i++; // skip the null after keyword
  if (isIntl) {
    // iTXt: skip compFlag, compMethod, then lang\0, then transKeyword\0.
    const compFlag = bytes[i++];
    i++; // compMethod
    while (i < end && bytes[i] !== 0) i++; i++; // language tag
    while (i < end && bytes[i] !== 0) i++; i++; // translated keyword
    if (compFlag === 1) return null; // compressed text — skip (would need inflate)
    return utf8Slice(bytes, i, end).trim() || null;
  }
  return latin1Slice(bytes, i, end).trim() || null;
}

function latin1Slice(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function utf8Slice(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
}
