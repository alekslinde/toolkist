/**
 * Shared contract for the accessibility checker's two engines.
 *
 * `ast-check` analyses source text (regex/attribute scanning — works on JSX and
 * Astro templates that never render). `dom-check` analyses a parsed DOM. Both
 * emit `Issue`, and `a11y-check` merges them.
 */

/** Which engine produced a finding. */
export type Engine = 'ast' | 'dom';

export type Severity = 'err' | 'warn' | 'notice';

/**
 * Whether the engine resolved the finding or inferred it.
 *
 * `approx` means structure could not be resolved — regex against JSX, chiefly,
 * where conditionals, `.map()` loops and spread props hide the real tree. The
 * UI badges these; consumers must not present them as verified.
 */
export type Confidence = 'exact' | 'approx';

export type RuleId =
  | 'img-alt'
  | 'form-label'
  | 'button-name'
  | 'link-name'
  | 'heading-order'
  | 'landmarks'
  | 'html-lang'
  | 'title'
  | 'aria-valid'
  | 'contrast'
  | 'focus-ind'
  | 'skip-link'
  | 'table-hdr'
  | 'captions'
  | 'frame-title'
  | 'dup-id'
  | 'live-misuse'
  | 'tabindex-pos'
  | 'dialog-name'
  | 'hidden-focus';

export interface Issue {
  ruleId: RuleId;
  engine: Engine;
  sev: Severity;
  confidence: Confidence;
  /** What is wrong, in plain language. */
  msg: string;
  /** What to do about it. */
  fix: string;
  /** CSS selector or source locator for the offending node. */
  sel: string;
}

export interface RuleMeta {
  id: RuleId;
  /** WCAG success criterion, e.g. '1.1.1'. */
  wcag: string;
  title: string;
  /** Engines that implement this rule. */
  engines: Engine[];
}

/** Rule registry — the single source of truth for WCAG mapping and UI labels. */
export const RULES: readonly RuleMeta[] = [
  { id: 'img-alt',       wcag: '1.1.1', title: 'Images need alternative text',        engines: ['ast', 'dom'] },
  { id: 'form-label',    wcag: '3.3.2', title: 'Form controls need labels',           engines: ['ast', 'dom'] },
  { id: 'button-name',   wcag: '4.1.2', title: 'Buttons need accessible names',       engines: ['ast', 'dom'] },
  { id: 'link-name',     wcag: '2.4.4', title: 'Links need descriptive text',         engines: ['ast', 'dom'] },
  { id: 'heading-order', wcag: '1.3.1', title: 'Headings form a valid outline',       engines: ['ast', 'dom'] },
  { id: 'landmarks',     wcag: '1.3.1', title: 'Page defines landmark regions',       engines: ['dom'] },
  { id: 'html-lang',     wcag: '3.1.1', title: 'Document declares a language',        engines: ['ast', 'dom'] },
  { id: 'title',         wcag: '2.4.2', title: 'Document has a title',                engines: ['ast', 'dom'] },
  { id: 'aria-valid',    wcag: '4.1.2', title: 'ARIA roles and attributes are valid', engines: ['ast', 'dom'] },
  { id: 'contrast',      wcag: '1.4.3', title: 'Text meets contrast minimums',        engines: ['dom'] },
  { id: 'focus-ind',     wcag: '2.4.7', title: 'Focus is visibly indicated',          engines: ['dom'] },
  { id: 'skip-link',     wcag: '2.4.1', title: 'Document offers a skip link',         engines: ['dom'] },
  { id: 'table-hdr',     wcag: '1.3.1', title: 'Data tables have headers',            engines: ['ast', 'dom'] },
  { id: 'captions',      wcag: '1.2.2', title: 'Video has captions',                  engines: ['ast', 'dom'] },
  { id: 'frame-title',   wcag: '4.1.2', title: 'Frames have titles',                  engines: ['ast', 'dom'] },
  { id: 'dup-id',        wcag: '4.1.1', title: 'IDs are unique',                      engines: ['ast', 'dom'] },
  { id: 'live-misuse',   wcag: '4.1.3', title: 'Live regions are used correctly',     engines: ['ast', 'dom'] },
  { id: 'tabindex-pos',  wcag: '2.4.3', title: 'Tab order follows document order',    engines: ['ast', 'dom'] },
  { id: 'dialog-name',   wcag: '4.1.2', title: 'Dialogs have accessible names',       engines: ['ast', 'dom'] },
  { id: 'hidden-focus',  wcag: '4.1.2', title: 'Hidden content is not focusable',     engines: ['dom'] },
] as const;

export const RULE_BY_ID: Record<RuleId, RuleMeta> = Object.fromEntries(
  RULES.map(r => [r.id, r]),
) as Record<RuleId, RuleMeta>;

/** Sort weight for grouping output: errors first, notices last. */
export const SEVERITY_ORDER: Record<Severity, number> = { err: 0, warn: 1, notice: 2 };

/** Score weights — an error costs more than a notice. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { err: 3, warn: 2, notice: 1 };

export interface Summary {
  err: number;
  warn: number;
  notice: number;
  total: number;
  /** 0–100. Always shown alongside the raw counts, never as the only number. */
  score: number;
}

export interface CheckResult {
  issues: Issue[];
  summary: Summary;
}

/** Input mode — decides which engines can run and how confident they can be. */
export type SourceKind = 'html' | 'jsx';

export interface CheckOptions {
  kind?: SourceKind;
  /** Which engines to run. Defaults to both. */
  engines?: Engine[];
}
