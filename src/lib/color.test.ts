import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  relativeLuminance,
  contrastRatio,
  isLight,
  isValidHex,
  mixColors,
  parseCssColor,
  contrastRatioRgb,
} from './color.js';

describe('hexToRgb', () => {
  it('parses a 6-digit hex color', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('expands a 3-digit shorthand', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('works without leading hash', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#FF8800')).toEqual(hexToRgb('#ff8800'));
  });

  it('throws on invalid hex instead of returning NaN channels', () => {
    expect(() => hexToRgb('#xyz')).toThrow();
    expect(() => hexToRgb('#12')).toThrow();
    expect(() => hexToRgb('nonsense')).toThrow();
  });
});

describe('rgbToHex', () => {
  it('converts RGB to lowercase hex with leading #', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(254.6, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(254.4, 0, 0)).toBe('#fe0000');
  });

  it('clamps out-of-range and non-finite channels to valid hex', () => {
    expect(rgbToHex(300, 10, 5)).toBe('#ff0a05');
    expect(rgbToHex(-5, 0, 0)).toBe('#000000');
    expect(rgbToHex(NaN, 0, 0)).toBe('#000000');
  });

  it('round-trips with hexToRgb', () => {
    const original = '#1a2b3c';
    const { r, g, b } = hexToRgb(original);
    expect(rgbToHex(r, g, b)).toBe(original);
  });
});

describe('rgbToHsl', () => {
  it('converts pure red', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('converts pure green', () => {
    expect(rgbToHsl(0, 255, 0)).toEqual({ h: 120, s: 100, l: 50 });
  });

  it('converts pure blue', () => {
    expect(rgbToHsl(0, 0, 255)).toEqual({ h: 240, s: 100, l: 50 });
  });

  it('converts white', () => {
    expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('converts black', () => {
    expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('converts a mid-grey', () => {
    const { h, s, l } = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(50, 0);
  });
});

describe('hslToRgb', () => {
  it('converts pure red', () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('converts pure green', () => {
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('converts pure blue', () => {
    expect(hslToRgb(240, 100, 50)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('converts white', () => {
    expect(hslToRgb(0, 0, 100)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('converts black', () => {
    expect(hslToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('round-trips with rgbToHsl within rounding tolerance', () => {
    const r = 100, g = 150, b = 200;
    const { h, s, l } = rgbToHsl(r, g, b);
    const back = hslToRgb(h, s, l);
    expect(back.r).toBeCloseTo(r, -1);
    expect(back.g).toBeCloseTo(g, -1);
    expect(back.b).toBeCloseTo(b, -1);
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1);
  });

  it('is in [0, 1] range for arbitrary colors', () => {
    const l = relativeLuminance(128, 64, 200);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
  });
});

describe('contrastRatio', () => {
  it('returns ~21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1);
  });

  it('is symmetric (order of arguments does not matter)', () => {
    const a = contrastRatio('#123456', '#abcdef');
    const b = contrastRatio('#abcdef', '#123456');
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns a value >= 1', () => {
    expect(contrastRatio('#336699', '#99ccff')).toBeGreaterThanOrEqual(1);
  });

  it('meets WCAG AA for black on white (>= 4.5)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('isLight', () => {
  it('identifies white as light', () => {
    expect(isLight(255, 255, 255)).toBe(true);
  });

  it('identifies black as dark', () => {
    expect(isLight(0, 0, 0)).toBe(false);
  });

  it('identifies a light yellow as light', () => {
    expect(isLight(255, 255, 0)).toBe(true);
  });

  it('identifies a dark navy as dark', () => {
    expect(isLight(0, 0, 128)).toBe(false);
  });
});

describe('isValidHex', () => {
  it('accepts 6-digit hex with hash', () => {
    expect(isValidHex('#ff0000')).toBe(true);
    expect(isValidHex('#AABBCC')).toBe(true);
    expect(isValidHex('#123456')).toBe(true);
  });

  it('accepts 3-digit shorthand', () => {
    expect(isValidHex('#f00')).toBe(true);
    expect(isValidHex('#ABC')).toBe(true);
  });

  it('rejects hex without hash', () => {
    expect(isValidHex('ff0000')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidHex('#ff00')).toBe(false);
    expect(isValidHex('#ff00000')).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidHex('#gggggg')).toBe(false);
    expect(isValidHex('#xyz')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHex('')).toBe(false);
  });
});

describe('mixColors', () => {
  it('returns first color at t=0', () => {
    expect(mixColors('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('returns second color at t=1', () => {
    expect(mixColors('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('returns midpoint at t=0.5', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('interpolates correctly for a known value', () => {
    // #ff0000 → #0000ff at 0.25: r=191, g=0, b=64 (Math.round(255*0.25)=64)
    expect(mixColors('#ff0000', '#0000ff', 0.25)).toBe('#bf0040');
  });
});

describe('parseCssColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses 3-digit hex', () => {
    expect(parseCssColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    expect(parseCssColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
  });

  it('parses 4-digit hex with alpha', () => {
    expect(parseCssColor('#f00f')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses rgb() with commas', () => {
    expect(parseCssColor('rgb(18, 52, 86)')).toEqual({ r: 18, g: 52, b: 86, a: 1 });
  });

  it('parses rgba() with alpha', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('parses space-separated rgb with slash alpha', () => {
    expect(parseCssColor('rgb(255 0 0 / 0.25)')).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });
  });

  it('parses percentage rgb components', () => {
    expect(parseCssColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses hsl()', () => {
    expect(parseCssColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses hsl() with deg and normalises hue past 360', () => {
    expect(parseCssColor('hsl(360deg, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('parses hsla() with alpha', () => {
    expect(parseCssColor('hsla(0, 100%, 50%, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('parses named colours', () => {
    expect(parseCssColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('rebeccapurple')).toEqual({ r: 102, g: 51, b: 153, a: 1 });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseCssColor('  #FF0000  ')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor('WHITE')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('treats transparent as fully transparent black', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('clamps out-of-range components', () => {
    expect(parseCssColor('rgb(300, -20, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  // Null means "needs page context" — callers must not treat it as a pass.
  it('returns null for context-dependent keywords', () => {
    expect(parseCssColor('currentColor')).toBeNull();
    expect(parseCssColor('inherit')).toBeNull();
    expect(parseCssColor('var(--brand)')).toBeNull();
  });

  it('returns null for gradients and unknown names', () => {
    expect(parseCssColor('linear-gradient(red, blue)')).toBeNull();
    expect(parseCssColor('notacolour')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('#12345')).toBeNull();
    expect(parseCssColor('#gggggg')).toBeNull();
    expect(parseCssColor('rgb(1, 2)')).toBeNull();
    expect(parseCssColor('rgb()')).toBeNull();
  });

  // Mixed comma/space syntax and slash-less space alpha are invalid CSS that
  // browsers drop — resolving them would report contrast for unrendered colour.
  it('returns null for mixed comma/space syntax', () => {
    expect(parseCssColor('rgb(255, 0 0)')).toBeNull();
    expect(parseCssColor('rgb(255 0, 0)')).toBeNull();
    expect(parseCssColor('rgb(255 0 0 0.5)')).toBeNull();
    expect(parseCssColor('rgb(255, 0, 0 / 50%)')).toBeNull();
  });
});

describe('contrastRatioRgb', () => {
  it('returns 21 for black on white', () => {
    const r = contrastRatioRgb({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(r).toBeCloseTo(21, 5);
  });

  it('returns 1 for identical colours', () => {
    const r = contrastRatioRgb({ r: 120, g: 120, b: 120 }, { r: 120, g: 120, b: 120 });
    expect(r).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    const a = contrastRatioRgb({ r: 0, g: 0, b: 0 }, { r: 200, g: 200, b: 200 });
    const b = contrastRatioRgb({ r: 200, g: 200, b: 200 }, { r: 0, g: 0, b: 0 });
    expect(a).toBeCloseTo(b, 10);
  });

  it('agrees with the hex-based contrastRatio', () => {
    const viaHex = contrastRatio('#1a1a1a', '#f5f5f5');
    const viaRgb = contrastRatioRgb({ r: 26, g: 26, b: 26 }, { r: 245, g: 245, b: 245 });
    expect(viaRgb).toBeCloseTo(viaHex, 10);
  });
});
