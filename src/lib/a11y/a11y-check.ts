/**
 * Public entry point: runs both engines and reconciles their findings.
 *
 * Where both engines report the same rule on the same element, the live DOM
 * wins — it resolved the real tree, so its result supersedes the static guess.
 */

import { astCheck } from './ast-check.js';
import { domCheck } from './dom-check.js';
import {
  RULES,
  SEVERITY_ORDER,
  SEVERITY_WEIGHT,
  type CheckOptions,
  type CheckResult,
  type Engine,
  type Issue,
  type Summary,
} from './types.js';

/** Rule order for stable output within a severity band. */
const RULE_INDEX = new Map(RULES.map((r, i) => [r.id, i]));

/**
 * Normalise a selector for cross-engine comparison. The two engines describe
 * the same element differently (`img#hero (line 4)` vs `#hero`), so dedupe on
 * the id when there is one and fall back to the tag name otherwise.
 */
function dedupeKey(i: Issue): string {
  const id = /#([A-Za-z0-9_-]+)/.exec(i.sel)?.[1];
  if (id) return `${i.ruleId}|#${id}`;
  const tag = /^([a-z][a-z0-9]*)/i.exec(i.sel)?.[1]?.toLowerCase();
  // Without an id the selectors are not comparable; keep the message so two
  // genuinely different findings on the same tag are not collapsed into one.
  return `${i.ruleId}|${tag ?? i.sel}|${i.msg}`;
}

export function mergeIssues(astIssues: Issue[], domIssues: Issue[]): Issue[] {
  const byKey = new Map<string, Issue>();
  // DOM first so it claims the key; AST only fills gaps.
  for (const i of domIssues) byKey.set(dedupeKey(i), i);
  for (const i of astIssues) {
    const k = dedupeKey(i);
    if (!byKey.has(k)) byKey.set(k, i);
  }
  return sortIssues([...byKey.values()]);
}

export function sortIssues(issues: Issue[]): Issue[] {
  return issues.slice().sort((a, b) =>
    SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev]
    || (RULE_INDEX.get(a.ruleId) ?? 99) - (RULE_INDEX.get(b.ruleId) ?? 99)
    || a.sel.localeCompare(b.sel),
  );
}

export function summarise(issues: Issue[]): Summary {
  const err = issues.filter(i => i.sev === 'err').length;
  const warn = issues.filter(i => i.sev === 'warn').length;
  const notice = issues.filter(i => i.sev === 'notice').length;
  // Notices report what could not be checked, not what is wrong, so they carry
  // no penalty — a clean document scores 100 even though contrast needs a full
  // page render. Counting them would make the score unreachable by design.
  const penalty = issues
    .filter(i => i.sev !== 'notice')
    .reduce((n, i) => n + SEVERITY_WEIGHT[i.sev], 0);
  // Weighted penalty against the rule count — a rough health signal, always
  // displayed next to the raw counts rather than on its own.
  const worst = RULES.length * SEVERITY_WEIGHT.err;
  const score = Math.max(0, Math.round((1 - Math.min(penalty, worst) / worst) * 100));
  return { err, warn, notice, total: issues.length, score };
}

export function a11yCheck(source: string, opts: CheckOptions = {}): CheckResult {
  const kind = opts.kind ?? 'html';
  const engines: Engine[] = opts.engines ?? ['ast', 'dom'];

  const ast = engines.includes('ast') ? astCheck(source, kind) : [];
  // The DOM engine needs DOMParser and meaningful markup; JSX would parse into
  // nonsense, so it only runs on HTML.
  const canRunDom = engines.includes('dom')
    && kind === 'html'
    && typeof DOMParser !== 'undefined';
  const dom = canRunDom ? domCheck(source) : [];

  const issues = engines.length === 1 ? sortIssues([...ast, ...dom]) : mergeIssues(ast, dom);
  return { issues, summary: summarise(issues) };
}

/** Stable JSON export for the UI download and the VS Code extension. */
export function toJson(result: CheckResult, meta: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tool: 'toolkist-accessibility-checker',
    generated: new Date().toISOString(),
    ...meta,
    summary: result.summary,
    issues: result.issues,
  }, null, 2);
}

export { astCheck, domCheck };
export * from './types.js';
