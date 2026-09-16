import { bench, describe, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// @ts-ignore
import compress   from 'wawoff2/compress';
// @ts-ignore
import decompress from 'wawoff2/decompress';

import {
  buildWOFF,
  buildEOT,
  inspectSfnt,
  unwrapWOFF,
} from '@/lib/font-converter';

// Prefer the fixture committed to the repo so these benchmarks measure real
// work on any machine. The system path is a fallback for hosts that have it.
//
// Previously this pointed only at the Linux system path. Where that was absent
// every bench body hit an early return and timed an empty function, reporting
// ~35,000,000 ops/sec for conversion of a ~400 KB font while the suite still
// exited 0. A missing fixture now fails instead of inventing a number.
const FONT_CANDIDATES = [
  join(import.meta.dirname, '../../public/bench-fixtures/fonts/sample.ttf'),
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];
const FONT_PATH = FONT_CANDIDATES.find(existsSync);

let ttfBuf: ArrayBuffer;
let woffBuf: ArrayBuffer;
let woff2Buf: ArrayBuffer;

function magic32(ab: ArrayBuffer): number {
  return new DataView(ab).getUint32(0);
}

// Build all fixture variants once; WOFF2 compression takes ~3 s for a 400 KB font.
beforeAll(async () => {
  if (!FONT_PATH) {
    throw new Error(
      'No TTF fixture found. Expected one of:\n  ' + FONT_CANDIDATES.join('\n  '),
    );
  }
  const raw = readFileSync(FONT_PATH);
  ttfBuf   = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  woffBuf  = buildWOFF(ttfBuf);
  const w2 = await compress(new Uint8Array(ttfBuf));
  woff2Buf = w2.buffer.slice(w2.byteOffset, w2.byteOffset + w2.byteLength);
}, 60_000);

// ── inspectSfnt ───────────────────────────────────────────────────────────────

describe('inspectSfnt', () => {
  bench('validate sample.ttf (~401 KB)', () => {
    const { issues } = inspectSfnt(ttfBuf);
    expect(issues).toHaveLength(0);
  });
});

// ── buildWOFF ─────────────────────────────────────────────────────────────────

describe('buildWOFF', () => {
  bench('TTF → WOFF (~401 KB input)', () => {
    const woff = buildWOFF(ttfBuf);
    expect(magic32(woff)).toBe(0x774F4646);
  });
});

// ── buildEOT ──────────────────────────────────────────────────────────────────

describe('buildEOT', () => {
  bench('TTF → EOT (~401 KB input)', () => {
    const eot = buildEOT(ttfBuf);
    // EOTSize (LE uint32) must equal total file size
    expect(new DataView(eot).getUint32(0, true)).toBe(eot.byteLength);
  });
});

// ── unwrapWOFF ────────────────────────────────────────────────────────────────

describe('unwrapWOFF', () => {
  bench('WOFF → sfnt (~401 KB)', async () => {
    const sfnt = await unwrapWOFF(woffBuf);
    const m = magic32(sfnt);
    const SFNT_MAGICS = new Set([0x00010000, 0x4F54544F, 0x74727565, 0x74797031]);
    expect(SFNT_MAGICS.has(m)).toBe(true);
  });
});

// ── wawoff2 compress / decompress ─────────────────────────────────────────────

describe('wawoff2', () => {
  bench('compress   TTF → WOFF2 (~401 KB)', async () => {
    const out = await compress(new Uint8Array(ttfBuf));
    // WOFF2 magic
    expect(out[0]).toBe(0x77);
    expect(out[1]).toBe(0x4F);
    expect(out[2]).toBe(0x46);
    expect(out[3]).toBe(0x32);
  }, { time: 5000 });

  bench('decompress WOFF2 → sfnt (~160 KB)', async () => {
    const out = await decompress(new Uint8Array(woff2Buf));
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
