import { describe, it, expect } from 'vitest';
import { extBadge, truncateMiddle } from './file-dropzone.js';

describe('extBadge', () => {
  it('labels the extension in uppercase', () => {
    expect(extBadge('photo.png').label).toBe('PNG');
    expect(extBadge('report.PDF').label).toBe('PDF');
  });

  it('colours by file family', () => {
    expect(extBadge('a.png').classes).toContain('purple');   // image
    expect(extBadge('a.jpg').classes).toContain('purple');
    expect(extBadge('a.pdf').classes).toContain('rose');     // doc
    expect(extBadge('a.css').classes).toContain('sky');      // code
    expect(extBadge('a.woff2').classes).toContain('amber');  // font
  });

  it('falls back to a neutral badge for unknown extensions', () => {
    const b = extBadge('archive.xyz');
    expect(b.label).toBe('XYZ');
    expect(b.classes).toContain('slate');
  });

  it('handles a filename with no extension', () => {
    const b = extBadge('README');
    expect(b.label).toBe('FILE');
    expect(b.classes).toContain('slate');
  });
});

describe('truncateMiddle', () => {
  it('leaves short names untouched', () => {
    expect(truncateMiddle('short.png')).toBe('short.png');
  });

  it('truncates the middle and keeps the extension', () => {
    const out = truncateMiddle('a-very-long-descriptive-filename-here-final.pdf', 24);
    expect(out).toContain('…');
    expect(out.endsWith('.pdf')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it('keeps the head and tail of the stem', () => {
    const out = truncateMiddle('abcdefghijklmnop.png', 14);
    expect(out.startsWith('abc')).toBe(true);
    expect(out.endsWith('.png')).toBe(true);
  });
});
