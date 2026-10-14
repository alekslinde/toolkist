import { describe, it, expect, afterEach } from 'vitest';
import { extBadge, truncateMiddle, wireDropZone, wireMultiDropZone } from './file-dropzone.js';

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
  } | null,
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  if (clipboard) {
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: clipboard.files ?? [],
        items: clipboard.items ?? [],
      },
    });
  }
  target.dispatchEvent(event);
  return event;
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

