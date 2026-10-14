import { describe, it, expect, afterEach, vi } from 'vitest';
import { extBadge, truncateMiddle, wireDropZone, wireMultiDropZone, ensurePastedNames, pasteLinkFromText, dataUrlToFile } from './file-dropzone.js';

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

function fileNamed(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

/** Paste whose clipboard payload is set directly — jsdom's ClipboardEvent
 *  constructor does not populate clipboardData. */
function dispatchPaste(
  target: EventTarget,
  clipboard: {
    files?: File[];
    items?: { kind: string; getAsFile: () => File | null }[];
    text?: string;
  } | null,
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  if (clipboard) {
    const text = clipboard.text ?? '';
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: clipboard.files ?? [],
        items: clipboard.items ?? [],
        getData: (type: string) => (type === 'text/plain' || type === 'text/uri-list' ? text : ''),
      },
    });
  }
  target.dispatchEvent(event);
  return event;
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function mountMulti(id: string): { root: HTMLDivElement; input: HTMLInputElement } {
  const root = document.createElement('div');
  root.id = id;
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('data-dz-input', '');
  root.append(input);
  document.body.append(root);
  return { root, input };
}

function mountSingle(id: string): { root: HTMLDivElement; input: HTMLInputElement } {
  const root = document.createElement('div');
  root.id = id;
  root.innerHTML = `
    <div data-dz-empty></div>
    <div data-dz-filled hidden>
      <span data-dz-badge data-dz-base="badge"></span>
      <span data-dz-name></span>
      <span data-dz-meta></span>
      <button type="button" data-dz-clear>Clear</button>
    </div>
    <input type="file" data-dz-input />
  `;
  document.body.append(root);
  const input = root.querySelector<HTMLInputElement>('[data-dz-input]')!;
  return { root, input };
}

describe('focused-zone paste', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('does not add a tab stop on the zone root, and pointer focus stays on the input', () => {
    const a = mountMulti('zone-a');
    const b = mountMulti('zone-b');
    wireMultiDropZone('zone-a', { onFiles: () => {} });
    wireMultiDropZone('zone-b', { onFiles: () => {} });

    expect(a.root.hasAttribute('tabindex')).toBe(false);
    expect(b.root.hasAttribute('tabindex')).toBe(false);

    a.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.activeElement).toBe(a.input);
    expect(document.activeElement).not.toBe(a.root);

    b.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.activeElement).toBe(b.input);
  });

  it('delivers clipboardData.files only to the focused zone', () => {
    const gotA: string[] = [];
    const gotB: string[] = [];
    const a = mountMulti('zone-a');
    const b = mountMulti('zone-b');
    wireMultiDropZone('zone-a', { onFiles: (files) => gotA.push(...files.map(f => f.name)) });
    wireMultiDropZone('zone-b', { onFiles: (files) => gotB.push(...files.map(f => f.name)) });

    a.input.focus();
    const pasted = dispatchPaste(a.input, {
      files: [fileNamed('from-files.png'), fileNamed('second.png')],
      // Present so a regression that prefers items over files would fail.
      items: [{ kind: 'file', getAsFile: () => fileNamed('from-items.png') }],
    });

    expect(pasted.defaultPrevented).toBe(true);
    expect(gotA).toEqual(['from-files.png', 'second.png']);
    expect(gotB).toEqual([]);
  });

  it('falls back to items/getAsFile when clipboardData.files is empty', () => {
    const gotA: string[] = [];
    const gotB: string[] = [];
    const a = mountMulti('zone-a');
    const b = mountMulti('zone-b');
    wireMultiDropZone('zone-a', { onFiles: (files) => gotA.push(...files.map(f => f.name)) });
    wireMultiDropZone('zone-b', { onFiles: (files) => gotB.push(...files.map(f => f.name)) });

    b.input.focus();
    const pasted = dispatchPaste(b.input, {
      files: [],
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => fileNamed('shot.png') },
        { kind: 'file', getAsFile: () => null },
      ],
    });

    expect(pasted.defaultPrevented).toBe(true);
    expect(gotB).toEqual(['shot.png']);
    expect(gotA).toEqual([]);
  });

  it('ignores a non-file paste', () => {
    const got: string[] = [];
    const a = mountMulti('zone-a');
    wireMultiDropZone('zone-a', { onFiles: (files) => got.push(...files.map(f => f.name)) });
    a.input.focus();

    const text = dispatchPaste(a.input, {
      items: [{ kind: 'string', getAsFile: () => fileNamed('should-not-count.png') }],
    });
    const empty = dispatchPaste(a.input, null);

    expect(text.defaultPrevented).toBe(false);
    expect(empty.defaultPrevented).toBe(false);
    expect(got).toEqual([]);
  });

  it('accepts only the first pasted file on a single-file zone', () => {
    const got: string[] = [];
    const zone = mountSingle('zone-single');
    wireDropZone('zone-single', { onFile: (file) => { got.push(file.name); } });

    expect(zone.root.hasAttribute('tabindex')).toBe(false);
    zone.input.focus();
    dispatchPaste(zone.input, {
      files: [fileNamed('first.png'), fileNamed('second.png')],
    });

    expect(got).toEqual(['first.png']);
  });
});

describe('ensurePastedNames', () => {
  it('keeps files that already have an extension', () => {
    const f = fileNamed('photo.jpg');
    expect(ensurePastedNames([f])[0].name).toBe('photo.jpg');
  });

  it('keeps long extensions and dotfiles verbatim', () => {
    expect(ensurePastedNames([fileNamed('notes.markdown')])[0].name).toBe('notes.markdown');
    const dotfile = new File(['x'], '.gitignore', { type: 'text/plain' });
    expect(ensurePastedNames([dotfile])[0].name).toBe('.gitignore');
    const readme = new File(['x'], 'README', { type: 'text/plain' });
    expect(ensurePastedNames([readme])[0].name).toBe('README');
  });

  it('names an extensionless Copy-Image paste from its MIME type', () => {
    const unnamed = new File(['x'], '', { type: 'image/png' });
    const out = ensurePastedNames([unnamed])[0];
    expect(out.name).toMatch(/^pasted-image-\d+\.png$/);
    expect(out.type).toBe('image/png');
  });

  it('names an extensionless text paste as pasted-file', () => {
    const unnamed = new File(['x'], '', { type: 'text/plain' });
    const out = ensurePastedNames([unnamed])[0];
    expect(out.name).toMatch(/^pasted-file-\d+\.txt$/);
  });

  it('keeps the stem of an extensionless image and appends the MIME extension', () => {
    const b = new File(['x'], 'blob', { type: 'image/jpeg' });
    expect(ensurePastedNames([b])[0].name).toBe('blob.jpg');
  });

  it('falls back to png for unknown types and numbers multi-pastes', () => {
    const a = new File(['x'], '', { type: '' });
    const b = new File(['x'], '', { type: 'image/jpeg' });
    const out = ensurePastedNames([a, b]);
    expect(out[0].name).toMatch(/^pasted-image-\d+-1\.png$/);
    expect(out[1].name).toMatch(/^pasted-image-\d+-2\.jpg$/);
  });
});

describe('paste-anywhere fallback', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('delivers a document-level paste to the zone when nothing is focused', () => {
    const got: string[] = [];
    mountMulti('zone-any');
    wireMultiDropZone('zone-any', { onFiles: (files) => got.push(...files.map(f => f.name)) });

    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.focus?.();
    const pasted = dispatchPaste(document.body, {
      files: [fileNamed('anywhere.png')],
    });

    expect(pasted.defaultPrevented).toBe(true);
    expect(got).toEqual(['anywhere.png']);
  });

  it('ignores paste when typing in a text field', () => {
    const got: string[] = [];
    mountMulti('zone-text');
    wireMultiDropZone('zone-text', { onFiles: (files) => got.push(...files.map(f => f.name)) });
    const ta = document.createElement('textarea');
    document.body.append(ta);
    ta.focus();

    const pasted = dispatchPaste(ta, {
      files: [fileNamed('should-not-land.png')],
    });

    expect(pasted.defaultPrevented).toBe(false);
    expect(got).toEqual([]);
  });

  it('routes to the most recently touched zone with several zones', () => {
    const gotA: string[] = [];
    const gotB: string[] = [];
    const a = mountMulti('zone-a');
    const b = mountMulti('zone-b');
    wireMultiDropZone('zone-a', { onFiles: (files) => gotA.push(...files.map(f => f.name)) });
    wireMultiDropZone('zone-b', { onFiles: (files) => gotB.push(...files.map(f => f.name)) });

    a.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    b.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    dispatchPaste(document.body, { files: [fileNamed('routed.png')] });

    expect(gotB).toEqual(['routed.png']);
    expect(gotA).toEqual([]);
  });

  it('still routes paste while a slider or select is focused', () => {
    const got: string[] = [];
    mountMulti('zone-slider');
    wireMultiDropZone('zone-slider', { onFiles: (files) => got.push(...files.map(f => f.name)) });
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(range);
    range.focus();

    const pasted = dispatchPaste(range, { files: [fileNamed('from-slider.png')] });

    expect(pasted.defaultPrevented).toBe(true);
    expect(got).toEqual(['from-slider.png']);
  });
});

describe('pasteLinkFromText', () => {
  it('accepts a single http(s) URL', () => {
    expect(pasteLinkFromText('https://example.com/photo.png')).toBe('https://example.com/photo.png');
    expect(pasteLinkFromText('  http://example.com/a.jpg  ')).toBe('http://example.com/a.jpg');
  });

  it('rejects non-link text, multi-token text and dangerous schemes', () => {
    expect(pasteLinkFromText('')).toBeNull();
    expect(pasteLinkFromText('just some words')).toBeNull();
    expect(pasteLinkFromText('https://example.com/a.png and more')).toBeNull();
    expect(pasteLinkFromText('javascript:alert(1)')).toBeNull();
    expect(pasteLinkFromText('file:///etc/passwd')).toBeNull();
  });

  it('accepts data: URLs', () => {
    const d = 'data:image/png;base64,iVBORw0KGgo=';
    expect(pasteLinkFromText(d)).toBe(d);
  });
});

describe('dataUrlToFile', () => {
  it('decodes a base64 image data URL with a png name', () => {
    const d = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const f = dataUrlToFile(d);
    expect(f).not.toBeNull();
    expect(f!.type).toBe('image/png');
    expect(f!.name).toMatch(/^pasted-data-\d+\.png$/);
    expect(f!.size).toBeGreaterThan(0);
  });

  it('returns null for malformed input', () => {
    expect(dataUrlToFile('not-a-data-url')).toBeNull();
    expect(dataUrlToFile('data:image/png;base64,!!!not-base64!!!')).toBeNull();
  });
});

describe('pasted-link fetching', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('fetches a pasted http(s) link into the zone, named from the URL', async () => {
    const got: File[] = [];
    mountMulti('zone-link');
    wireMultiDropZone('zone-link', { onFiles: (files) => got.push(...files) });
    vi.stubGlobal('fetch', async () =>
      ({ ok: true, blob: async () => new Blob(['imagedata'], { type: 'image/png' }) }) as Response,
    );

    dispatchPaste(document.body, { text: 'https://example.com/photo.png' });

    await waitFor(() => got.length > 0);
    expect(got[0].name).toBe('photo.png');
    expect(got[0].type).toBe('image/png');
  });

  it('decodes a pasted data: URL without any fetch', async () => {
    const got: File[] = [];
    mountMulti('zone-data');
    wireMultiDropZone('zone-data', { onFiles: (files) => got.push(...files) });
    const fetchSpy = vi.fn(async () => ({ ok: false, blob: async () => new Blob([]) }) as Response);
    vi.stubGlobal('fetch', fetchSpy);
    const d = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    dispatchPaste(document.body, { text: d });

    await waitFor(() => got.length > 0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(got[0].name).toMatch(/^pasted-data-\d+\.png$/);
  });

  it('does not hijack link text pasted into a text field', async () => {
    const got: File[] = [];
    mountMulti('zone-link-text');
    wireMultiDropZone('zone-link-text', { onFiles: (files) => got.push(...files) });
    const fetchSpy = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as Response);
    vi.stubGlobal('fetch', fetchSpy);
    const ta = document.createElement('textarea');
    document.body.append(ta);
    ta.focus();

    const pasted = dispatchPaste(ta, { text: 'https://example.com/photo.png' });

    expect(pasted.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(got).toEqual([]);
  });

  it('shows an inline notice when the link cannot be fetched', async () => {
    mountMulti('zone-link-fail');
    wireMultiDropZone('zone-link-fail', { onFiles: () => {} });
    vi.stubGlobal('fetch', async () => { throw new TypeError('blocked'); });

    dispatchPaste(document.body, { text: 'https://example.com/photo.png' });

    await waitFor(() => document.querySelector('[data-dz-notice]') !== null);
    expect(document.querySelector('[data-dz-notice]')!.textContent).toContain('Couldn’t fetch');
  });
});

