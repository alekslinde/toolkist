/**
 * ARIA reference data shared by both engines.
 *
 * Deliberately a subset of the full ARIA 1.2 spec: roles and attributes that
 * appear in real markup and whose misuse is unambiguous. An unknown name here
 * is reported as unknown, not guessed at.
 */

/** Valid ARIA role names (ARIA 1.2, abstract roles excluded). */
export const VALID_ROLES: ReadonlySet<string> = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote',
  'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
  'complementary', 'contentinfo', 'definition', 'deletion', 'dialog',
  'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic',
  'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list',
  'listbox', 'listitem', 'log', 'main', 'mark', 'marquee', 'math', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter',
  'navigation', 'none', 'note', 'option', 'paragraph', 'presentation',
  'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
  'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
  'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch',
  'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer',
  'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

/** Valid `aria-*` attribute names (ARIA 1.2 states and properties). */
export const VALID_ARIA_ATTRS: ReadonlySet<string> = new Set([
  'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-braillelabel',
  'aria-brailleroledescription', 'aria-busy', 'aria-checked', 'aria-colcount',
  'aria-colindex', 'aria-colindextext', 'aria-colspan', 'aria-controls',
  'aria-current', 'aria-describedby', 'aria-description', 'aria-details',
  'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-expanded',
  'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
  'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live',
  'aria-modal', 'aria-multiline', 'aria-multiselectable', 'aria-orientation',
  'aria-owns', 'aria-placeholder', 'aria-posinset', 'aria-pressed', 'aria-readonly',
  'aria-relevant', 'aria-required', 'aria-roledescription', 'aria-rowcount',
  'aria-rowindex', 'aria-rowindextext', 'aria-rowspan', 'aria-selected',
  'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow',
  'aria-valuetext',
]);

/**
 * Attributes only meaningful on particular roles — the "role-permit table" of
 * the spec. Listed by attribute because that is the direction we check.
 */
export const ROLE_PERMITTED_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  'aria-checked': new Set(['checkbox', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'switch', 'treeitem']),
  'aria-selected': new Set(['gridcell', 'option', 'row', 'tab', 'columnheader', 'rowheader', 'treeitem']),
  'aria-expanded': new Set(['application', 'button', 'checkbox', 'combobox', 'gridcell', 'link', 'listbox', 'menuitem', 'row', 'rowheader', 'tab', 'treeitem', 'columnheader', 'menuitemcheckbox', 'menuitemradio']),
  'aria-pressed': new Set(['button']),
  'aria-level': new Set(['heading', 'listitem', 'row', 'treeitem', 'comment']),
  'aria-required': new Set(['checkbox', 'combobox', 'gridcell', 'listbox', 'radiogroup', 'spinbutton', 'textbox', 'tree', 'searchbox', 'switch', 'slider', 'columnheader', 'rowheader']),
  'aria-valuenow': new Set(['meter', 'progressbar', 'scrollbar', 'slider', 'spinbutton', 'separator']),
  'aria-valuemin': new Set(['meter', 'progressbar', 'scrollbar', 'slider', 'spinbutton', 'separator']),
  'aria-valuemax': new Set(['meter', 'progressbar', 'scrollbar', 'slider', 'spinbutton', 'separator']),
  'aria-multiselectable': new Set(['grid', 'listbox', 'tablist', 'tree', 'treegrid']),
  'aria-sort': new Set(['columnheader', 'rowheader']),
  'aria-posinset': new Set(['article', 'listitem', 'menuitem', 'option', 'radio', 'tab', 'treeitem', 'comment', 'menuitemcheckbox', 'menuitemradio', 'row']),
  'aria-setsize': new Set(['article', 'listitem', 'menuitem', 'option', 'radio', 'tab', 'treeitem', 'comment', 'menuitemcheckbox', 'menuitemradio', 'row']),
};

/**
 * Implicit roles for native elements. Used so an `aria-*` attribute on a native
 * control is not flagged just because no explicit `role` is present.
 */
export const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  a: 'link', article: 'article', aside: 'complementary', button: 'button',
  dialog: 'dialog', footer: 'contentinfo', form: 'form', h1: 'heading',
  h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  header: 'banner', hr: 'separator', img: 'img', li: 'listitem', main: 'main',
  nav: 'navigation', ol: 'list', option: 'option', output: 'status',
  progress: 'progressbar', section: 'region', select: 'listbox', table: 'table',
  tbody: 'rowgroup', td: 'cell', textarea: 'textbox', tfoot: 'rowgroup',
  th: 'columnheader', thead: 'rowgroup', tr: 'row', ul: 'list',
};

/** Elements focusable without an explicit tabindex. */
export const NATIVELY_FOCUSABLE: ReadonlySet<string> = new Set([
  'a', 'area', 'audio', 'button', 'details', 'embed', 'iframe', 'input',
  'object', 'select', 'summary', 'textarea', 'video',
]);

/** Elements that are interactive, for the tabindex-on-non-interactive check. */
export const INTERACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'area', 'button', 'details', 'input', 'select', 'summary', 'textarea',
  'audio', 'video', 'iframe', 'embed', 'object', 'label', 'option',
]);

/** Roles that imply interactivity, so tabindex on them is expected. */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  'button', 'checkbox', 'combobox', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton',
  'switch', 'tab', 'textbox', 'treeitem', 'gridcell', 'scrollbar',
]);

/** `<input type>` values that take no label (not user-facing controls). */
export const UNLABELLABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'hidden', 'submit', 'reset', 'button', 'image',
]);

/** Link text that describes nothing out of context. */
export const NON_DESCRIPTIVE_LINK_TEXT: readonly string[] = [
  'click here', 'here', 'read more', 'more', 'link', 'this', 'this link',
  'learn more', 'details', 'continue', 'go', 'download',
];

/** Roles that make an element presentational, so `alt=""` is legitimate. */
export const PRESENTATIONAL_ROLES: ReadonlySet<string> = new Set(['presentation', 'none']);
