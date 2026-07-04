import { extOf, fmtBytes } from './utils.js';

/**
 * Shared file drop-zone helpers.
 *
 * Two concerns live here:
 *  1. `extBadge(name)` — pure mapping from a filename to a coloured extension
 *     chip (label + Tailwind classes), keyed by file family. Testable.
 *  2. `wireDropZone(id, opts)` — DOM wiring that turns a `<FileDropZone id=…>`
 *     instance into a working single-file picker. Framework-agnostic: works
 *     for both Alpine and vanilla-JS tools by driving the markup imperatively.
 */

export interface ExtBadge {
  /** Uppercase extension label shown in the chip, e.g. "PNG". */
  label: string;
  /** Tailwind classes for the chip background/text, keyed by family. */
  classes: string;
}

type Family = 'image' | 'doc' | 'code' | 'font' | 'other';

// Extension → family. Anything unlisted falls back to 'other'.
const FAMILY: Record<string, Family> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  avif: 'image', svg: 'image', heic: 'image', heif: 'image', ico: 'image',
  bmp: 'image', tiff: 'image', tif: 'image',
  // documents
  pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', rtf: 'doc',
  // code / web
  html: 'code', htm: 'code', css: 'code', scss: 'code', sass: 'code',
  js: 'code', ts: 'code', json: 'code', xml: 'code',
  // fonts
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
};

// One colour per family. Purple stays the brand accent for images (the most
// common upload); other families get distinct-but-muted hues.
const FAMILY_CLASSES: Record<Family, string> = {
  image: 'bg-purple-100 text-purple-700',
  doc:   'bg-rose-100 text-rose-700',
  code:  'bg-sky-100 text-sky-700',
  font:  'bg-amber-100 text-amber-700',
  other: 'bg-slate-100 text-slate-600',
};

/** Map a filename to its coloured extension badge. */
export function extBadge(name: string): ExtBadge {
  // extOf returns the whole name when there's no dot — treat that as no ext.
  const ext = name.includes('.') ? extOf(name) : '';
  const family = FAMILY[ext] ?? 'other';
  return {
    label: (ext || 'FILE').toUpperCase(),
    classes: FAMILY_CLASSES[family],
  };
}

/**
 * Truncate a long filename in the *middle*, preserving the extension, so the
 * user can always see what type of file loaded: "very-long-report…final.pdf".
 */
export function truncateMiddle(name: string, max = 40): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? extOf(name) : '';
  const dotExt = ext ? '.' + ext : '';
  const stem = ext ? name.slice(0, -dotExt.length) : name;
  const keep = max - dotExt.length - 1; // 1 for the ellipsis
  if (keep < 4) return name.slice(0, max - 1) + '…';
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return stem.slice(0, head) + '…' + stem.slice(stem.length - tail) + dotExt;
}

export interface DropZoneOptions {
  /** Called with the picked File. Return false to reject (keeps empty state). */
  onFile: (file: File) => boolean | void;
  /** Called when the user clears the current file. */
  onClear?: () => void;
  /** Human file-type label shown next to the size, e.g. "PNG image". */
  typeLabel?: (file: File) => string;
}

export interface DropZoneHandle {
  /** Force the filled state (e.g. after async validation elsewhere). */
  setFile: (file: File) => void;
  /** Reset to the empty state without invoking onClear. */
  reset: () => void;
}

/**
 * Wire a `<FileDropZone id={id}>` instance. Expects the component's markup
 * (empty prompt, filled card, hidden input, clear button, all tagged with
 * `data-dz-*` attributes). Handles drag/drop, click-to-browse, replace, and
 * the empty↔filled swap. The tool supplies validation via `onFile`.
 */
export function wireDropZone(id: string, opts: DropZoneOptions): DropZoneHandle {
  const root = document.getElementById(id);
  if (!root) throw new Error(`FileDropZone #${id} not found`);

  const input = root.querySelector<HTMLInputElement>('[data-dz-input]')!;
  const empty = root.querySelector<HTMLElement>('[data-dz-empty]')!;
  const filled = root.querySelector<HTMLElement>('[data-dz-filled]')!;
  const badge = root.querySelector<HTMLElement>('[data-dz-badge]')!;
  const nameEl = root.querySelector<HTMLElement>('[data-dz-name]')!;
  const metaEl = root.querySelector<HTMLElement>('[data-dz-meta]')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('[data-dz-clear]')!;

  const render = (file: File) => {
    const b = extBadge(file.name);
    badge.textContent = b.label;
    badge.className = `${badge.dataset.dzBase ?? ''} ${b.classes}`.trim();
    nameEl.textContent = truncateMiddle(file.name);
    nameEl.title = file.name;
    const type = opts.typeLabel ? opts.typeLabel(file) : b.label;
    metaEl.textContent = `${fmtBytes(file.size)} · ${type}`;
    empty.hidden = true;
    filled.hidden = false;
  };

  const toEmpty = () => {
    empty.hidden = false;
    filled.hidden = true;
    input.value = '';
    nameEl.textContent = '';
    metaEl.textContent = '';
    badge.textContent = '';
  };

  const accept = (file: File | undefined) => {
    if (!file) return;
    const ok = opts.onFile(file);
    if (ok !== false) render(file);
  };

  // Click anywhere on the zone (empty or filled) opens the picker — except the
  // clear button, which stops propagation below.
  root.addEventListener('click', () => input.click());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => accept(input.files?.[0]));

  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.dataset.dzOver = 'true';
  });
  root.addEventListener('dragleave', () => { delete root.dataset.dzOver; });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    delete root.dataset.dzOver;
    accept(e.dataTransfer?.files[0]);
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't trigger the browse click
    toEmpty();
    opts.onClear?.();
  });

  return {
    setFile: (file: File) => render(file),
    reset: () => toEmpty(),
  };
}
