export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid hex colour: "${hex}"`);
  }
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => {
    const n = Math.round(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0;
  };
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100; h /= 360;
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t++; if (t > 1) t--;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function linearize(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export interface RgbaColor { r: number; g: number; b: number; a: number }

/** CSS named colours, per CSS Color Module Level 4. */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
  deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
  firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
  gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080',
  honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
  ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899',
  lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0',
  lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
  maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
  mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
  mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
  oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
  orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
  paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5',
  peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
  rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
  silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
  slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
  tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
  turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** Parse a number that may carry a `%` suffix, scaling percentages to `max`. */
function parseComponent(tok: string, max: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(tok.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === '%' ? (n / 100) * max : n;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parse any CSS colour the accessibility checker can resolve without a render:
 * hex (3/4/6/8), `rgb()`/`rgba()`, `hsl()`/`hsla()`, named colours, `transparent`.
 *
 * Returns null for anything that needs page context — `currentColor`, `var()`,
 * gradients, `inherit`. Callers must treat null as unknown, never as a pass.
 */
export function parseCssColor(input: string): RgbaColor | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const named = NAMED_COLORS[s];
  if (named) return { ...hexToRgb(named), a: 1 };

  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    // 4- and 8-digit forms carry alpha in the trailing digit(s).
    if (h.length === 4 || h.length === 8) {
      const half = h.length / 2;
      const rgb = h.slice(0, half === 2 ? 3 : 6);
      const alphaHex = h.slice(half === 2 ? 3 : 6);
      const a = half === 2
        ? parseInt(alphaHex + alphaHex, 16) / 255
        : parseInt(alphaHex, 16) / 255;
      return { ...hexToRgb(rgb), a };
    }
    if (h.length === 3 || h.length === 6) return { ...hexToRgb(h), a: 1 };
    return null;
  }

  // Accept both legacy comma syntax and CSS Color 4 space syntax with a `/` alpha.
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const name = fn[1];
  const body = fn[2].trim();
  if (!body) return null;

  const [main, altAlpha] = body.split('/');
  const parts = main.trim().split(/[\s,]+/).filter(Boolean);
  const alphaTok = altAlpha !== undefined ? altAlpha.trim() : parts[3];
  if (parts.length < 3 || (altAlpha === undefined && parts.length > 4)) return null;

  let a = 1;
  if (alphaTok !== undefined) {
    const parsed = parseComponent(alphaTok, 1);
    if (parsed === null) return null;
    a = Math.max(0, Math.min(1, parsed));
  }

  if (name === 'rgb' || name === 'rgba') {
    const comps = parts.slice(0, 3).map(t => parseComponent(t, 255));
    if (comps.some(c => c === null)) return null;
    const [r, g, b] = comps as number[];
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a };
  }

  // hsl: hue is an unbounded angle, saturation and lightness are percentages.
  const hTok = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg)?$/.exec(parts[0].trim());
  if (!hTok) return null;
  const hue = ((parseFloat(hTok[1]) % 360) + 360) % 360;
  const sat = parseComponent(parts[1], 100);
  const light = parseComponent(parts[2], 100);
  if (sat === null || light === null) return null;
  const rgb = hslToRgb(hue, Math.max(0, Math.min(100, sat)), Math.max(0, Math.min(100, light)));
  return { ...rgb, a };
}

/** WCAG contrast ratio between two opaque colours, 1–21. */
export function contrastRatioRgb(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
): number {
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function isLight(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

export function isValidHex(h: string): boolean {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h);
}

export function mixColors(hex1: string, hex2: string, t: number): string {
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  return rgbToHex(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t,
  );
}
