import { describe, it, expect } from 'vitest';
import {
  isPng,
  parsePngInfo,
  wouldLosslessReencodeGrow,
  PNG_COLOR_TYPE,
} from './png-info.js';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Minimal PNG byte-buffer builder for tests. Chunks: [len][type][data][crc(0)].
function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  const lenBytes = [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
  const typeBytes = [...type].map(c => c.charCodeAt(0));
  return [...lenBytes, ...typeBytes, ...data, 0, 0, 0, 0]; // CRC unchecked by parser
}

function ihdr(w: number, h: number, bitDepth: number, colorType: number, interlace = 0): number[] {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return chunk('IHDR', [...u32(w), ...u32(h), bitDepth, colorType, 0, 0, interlace]);
}

function buildPng(...chunks: number[][]): Uint8Array {
  return new Uint8Array([...SIG, ...chunks.flat(), ...chunk('IEND', [])]);
}

describe('isPng', () => {
  it('accepts the PNG signature', () => {
    expect(isPng(new Uint8Array([...SIG, 0, 0]))).toBe(true);
  });
  it('rejects non-PNG / short buffers', () => {
    expect(isPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false); // JPEG SOI
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe('parsePngInfo', () => {
  it('reads IHDR for a truecolor+alpha PNG', () => {
    const info = parsePngInfo(buildPng(ihdr(640, 480, 8, PNG_COLOR_TYPE.TRUECOLOR_ALPHA)));
    expect(info).not.toBeNull();
    expect(info!.width).toBe(640);
    expect(info!.height).toBe(480);
    expect(info!.bitDepth).toBe(8);
    expect(info!.colorType).toBe(6);
    expect(info!.isPalette).toBe(false);
    expect(info!.interlaced).toBe(false);
  });

  it('detects a palette PNG and counts PLTE entries', () => {
    const plte = chunk('PLTE', new Array(64 * 3).fill(0)); // 64 colours
    const info = parsePngInfo(buildPng(ihdr(32, 32, 8, PNG_COLOR_TYPE.PALETTE), plte));
    expect(info!.isPalette).toBe(true);
    expect(info!.paletteColors).toBe(64);
  });

  it('flags tRNS transparency', () => {
    const info = parsePngInfo(buildPng(
      ihdr(16, 16, 8, PNG_COLOR_TYPE.PALETTE),
      chunk('PLTE', [0, 0, 0]),
      chunk('tRNS', [0]),
    ));
    expect(info!.hasTransparency).toBe(true);
  });

  it('reads a tEXt Software entry', () => {
    const text = [...'Software'].map(c => c.charCodeAt(0));
    text.push(0);
    text.push(...[...'pngquant'].map(c => c.charCodeAt(0)));
    const info = parsePngInfo(buildPng(ihdr(8, 8, 8, PNG_COLOR_TYPE.TRUECOLOR), chunk('tEXt', text)));
    expect(info!.software).toBe('pngquant');
  });

  it('reads interlace flag', () => {
    const info = parsePngInfo(buildPng(ihdr(8, 8, 8, PNG_COLOR_TYPE.TRUECOLOR, 1)));
    expect(info!.interlaced).toBe(true);
  });

  it('returns null for non-PNG input', () => {
    expect(parsePngInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it('returns null for a truncated header', () => {
    expect(parsePngInfo(new Uint8Array([...SIG, 0, 0, 0, 13]))).toBeNull();
  });

  it('stops safely on a chunk claiming a length past EOF', () => {
    // IHDR then a bogus chunk with a huge length — parser must not throw.
    const bogus = [0x7f, 0xff, 0xff, 0xff, ...[...'tEXt'].map(c => c.charCodeAt(0))];
    const bytes = new Uint8Array([...SIG, ...ihdr(8, 8, 8, PNG_COLOR_TYPE.TRUECOLOR), ...bogus]);
    const info = parsePngInfo(bytes);
    expect(info).not.toBeNull();
    expect(info!.software).toBeNull();
  });
});

describe('wouldLosslessReencodeGrow', () => {
  const base = { width: 8, height: 8, interlaced: false, paletteColors: null, hasTransparency: false, software: null };
  it('true for palette PNGs', () => {
    expect(wouldLosslessReencodeGrow({ ...base, bitDepth: 8, colorType: 3, isPalette: true })).toBe(true);
  });
  it('true for grayscale', () => {
    expect(wouldLosslessReencodeGrow({ ...base, bitDepth: 8, colorType: 0, isPalette: false })).toBe(true);
  });
  it('true for sub-byte bit depth', () => {
    expect(wouldLosslessReencodeGrow({ ...base, bitDepth: 4, colorType: 2, isPalette: false })).toBe(true);
  });
  it('false for 8-bit truecolor', () => {
    expect(wouldLosslessReencodeGrow({ ...base, bitDepth: 8, colorType: 2, isPalette: false })).toBe(false);
  });
  it('false for truecolor+alpha', () => {
    expect(wouldLosslessReencodeGrow({ ...base, bitDepth: 8, colorType: 6, isPalette: false })).toBe(false);
  });
});
