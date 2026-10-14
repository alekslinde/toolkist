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
 *     Includes paste-anywhere file upload plus pasted-link fetching
 *     (Copy Link Address → fetch → File), so every tool gets both for free.
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

export interface MultiDropZoneOptions {
  /** Called with the dropped/selected files (already filtered to a list). */
  onFiles: (files: File[]) => void;
}

/**
 * Extract files from a paste event (clipboardData.files or items).
 * Copy → Paste of an image from the browser arrives here as an
 * image/* item (Chrome names it "image.png", some browsers leave the
 * name empty) — both shapes are collected.
 */
function filesFromPaste(e: ClipboardEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/tif': 'tiff',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'tif', 'svg', 'heic', 'heif', 'ico',
]);

/** Derive a file extension from a MIME type. Empty string when unknown. */
function extFromMime(mime: string): string {
  const lower = mime.toLowerCase().split(';')[0].trim();
  if (!lower) return '';
  if (MIME_EXT[lower]) return MIME_EXT[lower];
  if (lower.startsWith('image/')) {
    const sub = lower.slice(6).split('+')[0].replace(/[^a-z0-9]/g, '');
    return sub || 'png';
  }
  if (lower.startsWith('text/')) return 'txt';
  const sub = lower.split('/')[1]?.split('+')[0].replace(/[^a-z0-9]/g, '') ?? '';
  return sub.length >= 1 && sub.length <= 10 ? sub : '';
}

/**
 * Pasted files often arrive unnamed (""). Downstream code uses the name for
 * the badge, the file list and the output filename, and `accepts()` checks
 * it — so give nameless pastes a sensible name derived from the MIME type
 * (`pasted-image-<ts>.png` for images, `pasted-file-<ts>.txt` otherwise).
 * Files that already have a name are returned untouched, except an
 * extensionless image (`blob`, type image/jpeg) which keeps its stem and
 * gains the MIME extension (`blob.jpg`) so the badge and `accepts()` see it.
 * Any other named file — `README`, `notes.markdown`, `.gitignore` — keeps
 * its name verbatim.
 */
export function ensurePastedNames(files: File[]): File[] {
  return files.map((f, i) => {
    const trimmed = (f.name || '').trim();
    const dot = trimmed.lastIndexOf('.');
    const hasExt = dot > 0 && dot < trimmed.length - 1;
    if (trimmed && hasExt) return f;
    const lower = (f.type || '').toLowerCase().split(';')[0].trim();
    const ext = extFromMime(lower) || 'png';
    if (trimmed && !hasExt) {
      const isImagePaste = lower.startsWith('image/') || lower === '' || IMAGE_EXTS.has(ext);
      const isPdf = lower === 'application/pdf';
      if (!isImagePaste && !isPdf) return f;
      try {
        return new File([f], `${trimmed}.${ext}`, { type: f.type || `image/${ext}` });
      } catch {
        return f;
      }
    }
    const isImage = !lower || lower.startsWith('image/') || IMAGE_EXTS.has(ext);
    const prefix = isImage ? 'pasted-image-' : 'pasted-file-';
    const suffix = files.length > 1 ? `-${i + 1}` : '';
    const name = `${prefix}${Date.now()}${suffix}.${ext}`;
    try {
      return new File([f], name, { type: f.type || (isImage ? `image/${ext}` : 'application/octet-stream') });
    } catch {
      return f;
    }
  });
}

interface ZoneEntry {
  root: HTMLElement;
  onFiles: (files: File[]) => void;
  lastActive: number;
}

const zones: ZoneEntry[] = [];
let docPasteWired = false;
let activeSeq = 0;

/** Input types that accept text paste — pasting files there must not steal the keystrokes. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'password', 'email', 'number',
]);

/** True when pasting into text — those keystrokes belong to the field. */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement) return true;
  // <select> and non-text inputs (range, checkbox, color, …) cannot take a
  // text paste, so an image paste while they are focused still routes to the zone.
  if (t instanceof HTMLSelectElement) return false;
  if (t instanceof HTMLInputElement) {
    if (t.type === 'file') return false;
    return TEXT_INPUT_TYPES.has(t.type.toLowerCase());
  }
  if (t.isContentEditable) return true;
  const closest = t.closest?.('input, textarea, select, [contenteditable="true"]');
  if (!closest) return false;
  if (closest instanceof HTMLTextAreaElement) return true;
  if (closest instanceof HTMLSelectElement) return false;
  if (closest instanceof HTMLInputElement) {
    if (closest.type === 'file') return false;
    return TEXT_INPUT_TYPES.has(closest.type.toLowerCase());
  }
  return true;
}

/** Remove zone entries whose roots left the DOM (page navigation, test teardown). */
function pruneZones(): void {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (!zones[i].root.isConnected) zones.splice(i, 1);
  }
}

/** Shown when a pasted link cannot be fetched at all. */
const LINK_FETCH_FAILED =
  'Couldn’t fetch that link — the site may block cross-site requests. Download the file and drop it instead.';

const linkNotices = new WeakMap<HTMLElement, HTMLElement>();

/** Transient inline error under a zone. Best-effort — never throws. */
function showZoneNotice(root: HTMLElement, msg: string): void {
  try {
    linkNotices.get(root)?.remove();
    const note = root.ownerDocument.createElement('p');
    note.setAttribute('data-dz-notice', '');
    note.setAttribute('role', 'status');
    note.className = 'mt-2 text-center text-xs text-rose-500';
    note.textContent = msg;
    root.insertAdjacentElement('afterend', note);
    linkNotices.set(root, note);
    root.ownerDocument.defaultView?.setTimeout(() => {
      if (note.isConnected) note.remove();
    }, 6000);
  } catch { /* notice is best-effort */ }
}

/**
 * Accept a pasted link (Copy Link Address / Copy Image Address) when the
 * clipboard holds no files. Only a single http(s) URL or a data: URL
 * qualifies — anything else belongs to the focused field / default handling.
 */
export function pasteLinkFromText(text: string): string | null {
  const t = (text || '').trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch { /* invalid URL */ }
    return null;
  }
  if (t.startsWith('data:') && t.includes(',') && t.length < 8_000_000) return t;
  return null;
}

/** Read link text from a paste event. Never throws. */
function textFromPaste(e: ClipboardEvent): string {
  const dt = e.clipboardData;
  if (!dt) return '';
  try {
    const get = (type: string): string => {
      try { return dt.getData(type); } catch { return ''; }
    };
    const uriList = get('text/uri-list');
    if (uriList) {
      const first = uriList
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'))[0];
      if (first) return first;
    }
    return get('text/plain');
  } catch {
    return '';
  }
}

/** Decode a data: URL into a File. Null when malformed. */
export function dataUrlToFile(url: string): File | null {
  const m = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mime = (m[1] || 'application/octet-stream').toLowerCase();
  try {
    let bytes: Uint8Array;
    if (m[2]) {
      const bin = atob(m[3].replace(/\s/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    }
    const ext = extFromMime(mime) || 'bin';
    return new File([bytes], `pasted-data-${Date.now()}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

/** Derive a filename from a URL path, appending a MIME-based extension when missing. */
function fileNameFromUrl(url: string, mime: string): string {
  const ext = extFromMime(mime);
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    let clean = '';
    try { clean = decodeURIComponent(last); } catch { clean = last; }
    clean = clean.replace(/[^\w.\-() ]/g, '_').trim();
    if (clean) {
      const dot = clean.lastIndexOf('.');
      if (dot > 0 && dot < clean.length - 1) return clean;
      return ext ? `${clean}.${ext}` : clean;
    }
  } catch { /* fall through to generated name */ }
  return `pasted-link-${Date.now()}.${ext || 'bin'}`;
}

// Raw-byte CORS proxies for binary fetching (same services brand-extract
// uses; the JSON-wrapping /get endpoint cannot carry binary).
const RAW_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/**
 * Turn a pasted link into Files: data: URLs decode locally, http(s) tries a
 * direct fetch first then the raw CORS proxies. Empty array on total failure.
 */
export async function fetchLinkToFiles(url: string): Promise<File[]> {
  if (url.startsWith('data:')) {
    const f = dataUrlToFile(url);
    return f ? [f] : [];
  }
  // Never forward embedded credentials (user:pass@host) — the proxy
  // fallback would leak them to a third party.
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    url = u.href;
  } catch {
    return [];
  }
  let urlExt = '';
  try { urlExt = (new URL(url).pathname.split('.').pop() ?? '').toLowerCase(); } catch { /* ignore */ }
  const targets = [url, ...RAW_PROXIES.map((p) => p(url))];
  for (const target of targets) {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob || blob.size === 0) continue;
      // A proxy error page for a file-looking URL is a failure, not a file.
      // Generic bytes are accepted (the URL name carries the type); anything
      // else claiming to be an image/pdf must actually look like one.
      const fileLike = IMAGE_EXTS.has(urlExt) || urlExt === 'pdf';
      const expected = urlExt === 'pdf' ? 'application/pdf' : 'image/';
      if (
        target !== url && fileLike && blob.type &&
        blob.type !== 'application/octet-stream' && !blob.type.startsWith(expected)
      ) continue;
      const name = fileNameFromUrl(url, blob.type);
      return [new File([blob], name, { type: blob.type })];
    } catch { /* try next */ }
  }
  return [];
}

/**
 * Document-level paste fallback so Ctrl+V works anywhere on the page —
 * the user does not have to focus the (sr-only) file input first.
 * Skipped when the event was already handled by a focused zone
 * (defaultPrevented) or when pasting into a text field.
 * With several zones (e.g. File Diff A/B) the most recently interacted
 * visible zone wins; otherwise the first visible zone.
 */
function ensureDocPaste(): void {
  if (docPasteWired || typeof document === 'undefined') return;
  docPasteWired = true;
  document.addEventListener('paste', (e) => {
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    pruneZones();
    const connected = zones.filter((z) => z.root.isConnected);
    if (!connected.length) return;
    const pick = (): ZoneEntry | null => {
      // Hidden zones (e.g. inactive single/batch tab) have no rects. In jsdom
      // everything has no rects, so fall back to all connected zones there.
      const withRects = connected.filter(
        (z) => z.root.getClientRects().length > 0 || z.root.offsetWidth + z.root.offsetHeight > 0,
      );
      const pool = withRects.length ? withRects : connected;
      let best = pool[0];
      for (const z of pool) if (z.lastActive > best.lastActive) best = z;
      return best ?? null;
    };
    const raw = filesFromPaste(e as ClipboardEvent);
    if (raw.length) {
      const files = ensurePastedNames(raw);
      if (!files.length) return;
      const best = pick();
      if (!best) return;
      e.preventDefault();
      best.onFiles(files);
      return;
    }
    const link = pasteLinkFromText(textFromPaste(e as ClipboardEvent));
    if (!link) return;
    const best = pick();
    if (!best) return;
    e.preventDefault();
    best.lastActive = ++activeSeq;
    const target = best;
    void fetchLinkToFiles(link).then((fetched) => {
      if (!target.root.isConnected) return;
      if (fetched.length) target.onFiles(fetched);
      else showZoneNotice(target.root, LINK_FETCH_FAILED);
    });
  });
}

/**
 * Shared drag/click/paste wiring for a `<FileDropZone>` root. Toggles the
 * `data-dz-over` highlight and forwards clicks to the labelled input.
 * Paste is listened for on the root and arrives when the file input — the
 * real keyboard control — is focused, because the event bubbles. A shared
 * document-level fallback (see ensureDocPaste) covers paste anywhere else
 * on the page. The zone root is not given a tabindex: a plain div with
 * tabindex="0" is a non-interactive tab stop. Multiple zones neither leak
 * (disconnected roots are pruned) nor race (handled events set
 * defaultPrevented, and the document fallback routes to one zone only).
 */
function bindZone(root: HTMLElement, onFiles: (files: File[]) => void): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('[data-dz-input]')!;
  pruneZones();
  const entry: ZoneEntry = { root, onFiles, lastActive: 0 };
  zones.push(entry);
  ensureDocPaste();
  const markActive = () => { entry.lastActive = ++activeSeq; };

  root.addEventListener('click', () => input.click());
  // Pointer users land on the input, not the zone, so a following paste
  // bubbles here without an extra keyboard stop.
  root.addEventListener('pointerdown', () => {
    markActive();
    input.focus({ preventScroll: true });
  });
  root.addEventListener('focusin', markActive);
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.dataset.dzOver = 'true';
  });
  root.addEventListener('dragleave', () => { delete root.dataset.dzOver; });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    delete root.dataset.dzOver;
    // Drops keep OS filenames verbatim — never rename (README, .gitignore,
    // notes.markdown must survive). Paste-only normalization lives in the
    // paste handlers.
    const list = e.dataTransfer?.files;
    if (list?.length) onFiles(Array.from(list));
  });
  root.addEventListener('paste', (e) => {
    const files = ensurePastedNames(filesFromPaste(e));
    if (files.length) {
      e.preventDefault();
      onFiles(files);
      return;
    }
    const link = pasteLinkFromText(textFromPaste(e));
    if (!link) return;
    e.preventDefault();
    void fetchLinkToFiles(link).then((fetched) => {
      if (!root.isConnected) return;
      if (fetched.length) onFiles(fetched);
      else showZoneNotice(root, LINK_FETCH_FAILED);
    });
  });

  return input;
}

/**
 * Wire a `<FileDropZone variant="multi" id={id}>`. The zone shows a permanent
 * prompt (no filled card) — the tool renders its own list/grid + count bar.
 * Dropping or selecting files appends via `onFiles`, so it doubles as the
 * "add more" affordance.
 */
export function wireMultiDropZone(id: string, opts: MultiDropZoneOptions): void {
  const root = document.getElementById(id);
  if (!root) throw new Error(`FileDropZone #${id} not found`);

  const emit = (files: File[]) => {
    if (files.length) opts.onFiles(files);
  };

  const input = bindZone(root, emit);
  input.addEventListener('change', () => {
    emit(Array.from(input.files ?? []));
    input.value = ''; // allow re-selecting the same files
  });
}

/**
 * Wire a `<FileDropZone id={id}>` instance. Expects the component's markup
 * (empty prompt, filled card, hidden input, clear button, all tagged with
 * `data-dz-*` attributes). Handles drag/drop, click-to-browse, paste, replace,
 * and the empty↔filled swap. The tool supplies validation via `onFile`.
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

  bindZone(root, (files) => accept(files[0]));
  input.addEventListener('change', () => accept(input.files?.[0]));

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
