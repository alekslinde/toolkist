/**
 * Live DOM engine.
 *
 * Parses markup with DOMParser and walks the real tree, so structure, inline
 * style and focusability resolve exactly. Everything it reports is
 * `confidence: 'exact'`.
 *
 * It still cannot see external stylesheets — pasted markup has no page context.
 * Rules that depend on computed style (contrast, focus indicators) say so with
 * `sev: 'notice'` rather than guessing. See roadmap §5.1.
 */

import type { Issue, RuleId, Severity } from './types.js';
import { contrastRatioRgb, parseCssColor, type RgbaColor } from '../color.js';
import {
  INTERACTIVE_ELEMENTS,
  INTERACTIVE_ROLES,
  IMPLICIT_ROLES,
  NATIVELY_FOCUSABLE,
  NON_DESCRIPTIVE_LINK_TEXT,
  PRESENTATIONAL_ROLES,
  ROLE_PERMITTED_ATTRS,
  UNLABELLABLE_INPUT_TYPES,
  VALID_ARIA_ATTRS,
  VALID_ROLES,
} from './aria-data.js';

/** Build a stable-ish CSS selector for an element. */
function selectorFor(el: Element): string {
  if (el.id) return `#${el.id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && parts.length < 4) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur!.tagName);
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(cur) + 1})` : tag);
    } else parts.unshift(tag);
    if (cur.id) { parts[0] = `#${cur.id}`; break; }
    cur = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.trim().split(/\s+/)[0].toLowerCase();
  return IMPLICIT_ROLES[el.tagName.toLowerCase()];
}

/** Inline-style visibility only; jsdom has no layout engine. */
function isVisuallyHidden(el: Element): boolean {
  const style = el.getAttribute('style') ?? '';
  return /display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style);
}

function isHiddenFromAT(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.getAttribute?.('aria-hidden') === 'true') return true;
    if (cur.hasAttribute?.('hidden')) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** Accessible name per roadmap §4.1: labelledby > label > text > alt|title|value. */
export function accessibleName(el: Element, doc: Document): string {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby.split(/\s+/)
      .map(id => doc.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean).join(' ');
    if (text) return text;
  }
  const label = el.getAttribute('aria-label');
  if (label?.trim()) return label.trim();

  // Visually-hidden text still counts as an accessible name.
  const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (text) return text;

  // An <svg><title> inside the element names it.
  const svgTitle = el.querySelector?.('svg > title')?.textContent?.trim();
  if (svgTitle) return svgTitle;

  for (const attr of ['alt', 'title', 'value']) {
    const v = el.getAttribute(attr);
    if (v?.trim()) return v.trim();
  }
  return '';
}

function isFocusable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const ti = el.getAttribute('tabindex');
  if (ti !== null && Number(ti) >= 0) return true;
  if (el.hasAttribute('disabled')) return false;
  if (tag === 'a') return el.hasAttribute('href');
  return NATIVELY_FOCUSABLE.has(tag);
}

/** Parse a `style` attribute into declarations. */
function inlineStyle(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

/** Nearest ancestor background colour declared inline, if any. */
function inheritedBackground(el: Element): RgbaColor | null {
  let cur: Element | null = el;
  while (cur) {
    const s = inlineStyle(cur);
    const raw = s['background-color'] ?? s['background'];
    if (raw) {
      const c = parseCssColor(raw.split(/\s+/)[0]);
      if (c && c.a === 1) return c;
      if (c && c.a === 0) { cur = cur.parentElement; continue; }
      if (c) return null; // partial alpha — unresolvable, see roadmap §5.1
    }
    cur = cur.parentElement;
  }
  return null;
}

export function domCheck(source: string, parser?: DOMParser): Issue[] {
  const p = parser ?? new DOMParser();
  const isFullDoc = /<html[\s>]/i.test(source);
  const doc = p.parseFromString(
    isFullDoc ? source : `<html><body>${source}</body></html>`, 'text/html',
  );
  const issues: Issue[] = [];
  const add = (ruleId: RuleId, sev: Severity, msg: string, fix: string, sel: string) => {
    issues.push({ ruleId, engine: 'dom', sev, confidence: 'exact', msg, fix, sel });
  };

  // ── 1. img-alt ──────────────────────────────────────────────────────────
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const alt = img.getAttribute('alt');
    const presentational = PRESENTATIONAL_ROLES.has(img.getAttribute('role') ?? '')
      || img.getAttribute('aria-hidden') === 'true';
    if (alt === null) {
      if (accessibleName(img, doc)) continue;
      add('img-alt', 'err',
        'Image has no alt attribute, so assistive technology announces the filename or nothing.',
        'Add alt text describing the image\'s purpose, or alt="" plus aria-hidden="true" if purely decorative.',
        selectorFor(img));
    } else if (alt === '' && !presentational) {
      add('img-alt', 'warn',
        'Image has an empty alt but is not marked decorative.',
        'Add aria-hidden="true" or role="presentation" to confirm it is decorative, or supply alt text.',
        selectorFor(img));
    }
  }

  // ── 2. form-label ───────────────────────────────────────────────────────
  for (const ctl of Array.from(doc.querySelectorAll('input, select, textarea'))) {
    const tag = ctl.tagName.toLowerCase();
    const type = (ctl.getAttribute('type') ?? 'text').toLowerCase();
    if (tag === 'input' && UNLABELLABLE_INPUT_TYPES.has(type)) continue;
    if (isHiddenFromAT(ctl)) continue;
    const wrapped = ctl.closest('label');
    const forLabel = ctl.id
      ? doc.querySelector(`label[for="${CSS_escape(ctl.id)}"]`)
      : null;
    const named = !!(ctl.getAttribute('aria-label')?.trim())
      || !!(ctl.getAttribute('aria-labelledby')?.trim())
      || !!(ctl.getAttribute('title')?.trim())
      || !!wrapped || !!forLabel;
    if (!named) {
      add('form-label', 'err',
        `<${tag}> has no associated label, so its purpose is unannounced.`,
        'Add a <label for="…">, aria-label, or aria-labelledby.',
        selectorFor(ctl));
    }
  }

  // ── 3. button-name ──────────────────────────────────────────────────────
  for (const btn of Array.from(doc.querySelectorAll('button, [role="button"]'))) {
    if (isHiddenFromAT(btn)) continue;
    if (!accessibleName(btn, doc)) {
      add('button-name', 'err',
        'Button has no accessible name, so it is announced only as "button".',
        'Add visible text, aria-label, or aria-labelledby.',
        selectorFor(btn));
    }
  }
  for (const el of Array.from(doc.querySelectorAll('div[onclick], span[onclick]'))) {
    const missing: string[] = [];
    if (el.getAttribute('role') !== 'button') missing.push('role="button"');
    if (!el.hasAttribute('tabindex')) missing.push('tabindex="0"');
    if (!el.hasAttribute('onkeydown') && !el.hasAttribute('onkeyup')
      && !el.hasAttribute('onkeypress')) missing.push('a keyboard handler');
    if (missing.length) {
      add('button-name', 'err',
        `Clickable <${el.tagName.toLowerCase()}> is not keyboard operable (missing ${missing.join(', ')}).`,
        'Use a real <button>, or add role="button", tabindex="0" and a key handler.',
        selectorFor(el));
    }
  }

  // ── 4. link-name ────────────────────────────────────────────────────────
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    if (isHiddenFromAT(a)) continue;
    const name = accessibleName(a, doc);
    if (!name) {
      add('link-name', 'err', 'Link has no accessible name.',
        'Add link text, aria-label, or aria-labelledby.', selectorFor(a));
      continue;
    }
    if (!a.hasAttribute('href') && !a.hasAttribute('role')) {
      add('link-name', 'warn',
        'Anchor has no href, so it is not reachable by keyboard.',
        'Add an href, or use a <button> if it performs an action.', selectorFor(a));
    }
    const plain = name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    if (NON_DESCRIPTIVE_LINK_TEXT.includes(plain)) {
      add('link-name', 'warn',
        `Link text "${name}" does not describe its destination out of context.`,
        'Describe the target, e.g. "Read the accessibility guide".', selectorFor(a));
    }
  }

  // ── 5. heading-order ────────────────────────────────────────────────────
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
    .map(el => {
      const m = /^h([1-6])$/.exec(el.tagName.toLowerCase());
      const lvl = m ? Number(m[1]) : Number(el.getAttribute('aria-level') ?? NaN);
      return { el, lvl };
    })
    .filter(h => h.lvl >= 1 && h.lvl <= 6);
  const h1s = headings.filter(h => h.lvl === 1);
  for (const h of h1s.slice(1)) {
    add('heading-order', 'warn',
      `Document has ${h1s.length} <h1> elements; one top-level heading is expected.`,
      'Demote the extra headings to <h2> or lower.', selectorFor(h.el));
  }
  let prev = 0;
  for (const h of headings) {
    if (prev && h.lvl > prev + 1) {
      add('heading-order', 'err',
        `Heading level jumps from h${prev} to h${h.lvl}, breaking the outline.`,
        `Use h${prev + 1} here, or restructure the section.`, selectorFor(h.el));
    }
    if (!accessibleName(h.el, doc)) {
      add('heading-order', 'err',
        'Heading is empty, so it contributes nothing to the outline.',
        'Add heading text, or remove the element.', selectorFor(h.el));
    }
    prev = h.lvl;
  }

  // ── 6. landmarks (dom only) ─────────────────────────────────────────────
  if (isFullDoc) {
    if (!doc.querySelector('main, [role="main"]')) {
      add('landmarks', 'err',
        'Page has no <main> landmark, so users cannot jump to the primary content.',
        'Wrap the primary content in <main>.', 'body');
    }
    if (!doc.querySelector('nav, [role="navigation"]')) {
      add('landmarks', 'notice',
        'Page has no <nav> landmark.',
        'If the page has navigation, wrap it in <nav>.', 'body');
    }
    for (const sel of ['nav', 'main', 'aside', 'form[role="search"]']) {
      const found = Array.from(doc.querySelectorAll(sel));
      if (found.length < 2) continue;
      const unlabelled = found.filter(
        el => !el.getAttribute('aria-label')?.trim() && !el.getAttribute('aria-labelledby')?.trim(),
      );
      if (unlabelled.length > 1) {
        for (const el of unlabelled) {
          add('landmarks', 'warn',
            `Multiple <${sel}> landmarks with no distinguishing label.`,
            'Give each an aria-label, e.g. aria-label="Primary".', selectorFor(el));
        }
      }
    }
  }

  // ── 7. html-lang ────────────────────────────────────────────────────────
  if (isFullDoc) {
    const html = doc.documentElement;
    const lang = html.getAttribute('lang');
    if (!lang) {
      add('html-lang', 'err',
        'The <html> element has no lang attribute, so screen readers may use the wrong pronunciation.',
        'Add a language code, e.g. lang="en".', 'html');
    } else if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(lang)) {
      add('html-lang', 'err', `lang="${lang}" is not a valid BCP 47 language tag.`,
        'Use a valid code such as "en", "en-GB" or "pt-BR".', 'html');
    }
  }

  // ── 8. title ────────────────────────────────────────────────────────────
  if (isFullDoc) {
    const title = doc.querySelector('title');
    if (!title) {
      add('title', 'err',
        'Document has no <title>, so it is unidentifiable in tabs and history.',
        'Add a descriptive <title> in <head>.', 'head');
    } else if (!title.textContent?.trim()) {
      add('title', 'err', 'Document <title> is empty.',
        'Give the page a unique, descriptive title.', 'title');
    }
  }

  // ── 9. aria-valid ───────────────────────────────────────────────────────
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const rawRole = el.getAttribute('role');
    if (rawRole) {
      for (const r of rawRole.trim().split(/\s+/)) {
        if (!VALID_ROLES.has(r.toLowerCase())) {
          add('aria-valid', 'err', `role="${r}" is not a valid ARIA role.`,
            'Use a role from the ARIA specification, or remove the attribute.', selectorFor(el));
        }
      }
    }
    const effectiveRole = roleOf(el);
    for (const attr of Array.from(el.attributes)) {
      const nm = attr.name.toLowerCase();
      if (!nm.startsWith('aria-')) continue;
      if (!VALID_ARIA_ATTRS.has(nm)) {
        add('aria-valid', 'err', `${nm} is not a valid ARIA attribute.`,
          'Check the spelling against the ARIA specification.', selectorFor(el));
        continue;
      }
      const permitted = ROLE_PERMITTED_ATTRS[nm];
      if (permitted && effectiveRole && !permitted.has(effectiveRole)) {
        add('aria-valid', 'warn',
          `${nm} is not supported on role="${effectiveRole}" and will be ignored.`,
          `Move it to an element with a role that supports it (${[...permitted].slice(0, 3).join(', ')}…).`,
          selectorFor(el));
      }
    }
  }

  // ── 10. contrast (inline style only — roadmap §5.1) ─────────────────────
  let contrastUnresolved = 0;
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const s = inlineStyle(el);
    if (!s.color) continue;
    if (!el.textContent?.trim()) continue;
    const fg = parseCssColor(s.color);
    if (!fg) { contrastUnresolved++; continue; }
    if (fg.a < 1) { contrastUnresolved++; continue; }
    const bg = inheritedBackground(el);
    if (!bg) { contrastUnresolved++; continue; }

    const ratio = contrastRatioRgb(fg, bg);
    const fontSize = parseFloat(s['font-size'] ?? '16');
    const bold = /bold|[7-9]00/.test(s['font-weight'] ?? '');
    const large = fontSize >= 24 || (bold && fontSize >= 18.66);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      add('contrast', 'err',
        `Text contrast is ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${min}:1 for this size.`,
        'Darken the text or lighten the background until the ratio meets the minimum.',
        selectorFor(el));
    }
  }
  // One notice covers the whole limitation. Reporting per-element would bury
  // real findings under a caveat that is the same for every element.
  const contrastChecked = doc.querySelectorAll('[style*="color"]').length > 0;
  if (contrastUnresolved > 0) {
    add('contrast', 'notice',
      `${contrastUnresolved} element(s) declare colours that cannot be resolved from markup alone (variables, partial transparency, or an unstated background).`,
      'Run the full-page audit, which computes colour against the rendered page.',
      'document');
  } else if (!contrastChecked) {
    add('contrast', 'notice',
      'Contrast was not checked: this markup carries no inline colours, so text colour comes from a stylesheet that is not visible here.',
      'Run the full-page audit to check contrast against the rendered stylesheet.',
      'document');
  }

  // ── 11. focus-ind (dom only) ────────────────────────────────────────────
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const s = inlineStyle(el);
    if (/^\s*(none|0)\b/.test(s.outline ?? '') || s['outline-width'] === '0') {
      add('focus-ind', 'err',
        'Focus outline is removed inline, leaving keyboard users with no visible focus.',
        'Remove outline:none, or provide a :focus-visible style with equivalent visibility.',
        selectorFor(el));
    }
  }
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const css = style.textContent ?? '';
    const killsOutline = /(?:^|[,{}])\s*[^{}]*:focus\b[^{}]*\{[^}]*outline\s*:\s*(none|0)/i.test(css);
    if (killsOutline && !/:focus-visible/i.test(css)) {
      add('focus-ind', 'err',
        'A :focus rule removes the outline with no :focus-visible replacement.',
        'Add a :focus-visible rule with a visible outline.', 'style');
    }
  }

  // ── 12. skip-link (dom only, full documents) ────────────────────────────
  if (isFullDoc) {
    const first = Array.from(doc.querySelectorAll('a[href^="#"]')).slice(0, 3);
    const hasSkip = first.some(a => /skip|jump/i.test(a.textContent ?? ''));
    if (!hasSkip) {
      add('skip-link', 'warn',
        'No skip link found, so keyboard users must tab through the header on every page.',
        'Add a "Skip to content" link as the first focusable element.', 'body');
    }
  }

  // ── 13. table-hdr ───────────────────────────────────────────────────────
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const role = table.getAttribute('role');
    if (role === 'presentation' || role === 'none') continue;
    const ths = Array.from(table.querySelectorAll('th'));
    if (ths.length === 0) {
      add('table-hdr', 'err',
        'Table has no <th> cells, so its data has no announced headers.',
        'Mark header cells with <th> and add scope="col" or scope="row".', selectorFor(table));
    } else if (!ths.some(th => th.hasAttribute('scope'))) {
      add('table-hdr', 'warn',
        'Table headers have no scope attribute, so header-to-cell association is ambiguous.',
        'Add scope="col" or scope="row" to each <th>.', selectorFor(table));
    }
  }

  // ── 14. captions ────────────────────────────────────────────────────────
  for (const v of Array.from(doc.querySelectorAll('video'))) {
    const ok = Array.from(v.querySelectorAll('track')).some(
      t => ['captions', 'subtitles'].includes(t.getAttribute('kind') ?? ''),
    );
    if (!ok) {
      add('captions', 'err',
        'Video has no captions track, so its audio is inaccessible to deaf users.',
        'Add <track kind="captions" src="…" srclang="…" label="…">.', selectorFor(v));
    }
  }

  // ── 15. frame-title ─────────────────────────────────────────────────────
  for (const f of Array.from(doc.querySelectorAll('iframe, frame'))) {
    if (f.getAttribute('title')?.trim()) continue;
    if (f.getAttribute('aria-hidden') === 'true') continue;
    add('frame-title', 'err',
      `<${f.tagName.toLowerCase()}> has no title, so it is announced only as "frame".`,
      'Add title="…" describing the frame\'s content.', selectorFor(f));
  }

  // ── 16. dup-id ──────────────────────────────────────────────────────────
  const seen = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('[id]'))) {
    const id = el.id;
    if (!id) continue;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) {
      add('dup-id', 'err',
        `id="${id}" is used more than once; label and ARIA references resolve to the first only.`,
        'Make every id unique within the document.', selectorFor(el));
    }
  }

  // ── 17. live-misuse ─────────────────────────────────────────────────────
  const liveEls = Array.from(doc.querySelectorAll(
    '[aria-live], [role="status"], [role="alert"], [role="log"]',
  ));
  for (const el of liveEls) {
    if (isHiddenFromAT(el) || isVisuallyHidden(el)) {
      add('live-misuse', 'err',
        'Live region is hidden from assistive technology, so its updates are never announced.',
        'Remove aria-hidden/hidden, or use a visually-hidden class instead.', selectorFor(el));
    }
    const live = el.getAttribute('aria-live');
    if (live && !['polite', 'assertive', 'off'].includes(live)) {
      add('live-misuse', 'err', `aria-live="${live}" is not a valid value.`,
        'Use "polite", "assertive" or "off".', selectorFor(el));
    }
    if (live === 'assertive' && el.getAttribute('role') !== 'alert') {
      add('live-misuse', 'warn',
        'aria-live="assertive" interrupts the user immediately; it is rarely warranted.',
        'Use aria-live="polite" unless the message is genuinely urgent.', selectorFor(el));
    }
  }
  const assertive = liveEls.filter(
    el => el.getAttribute('aria-live') === 'assertive' || el.getAttribute('role') === 'alert',
  );
  if (assertive.length > 1) {
    add('live-misuse', 'warn',
      `${assertive.length} assertive live regions compete to interrupt the user.`,
      'Keep a single assertive region, or demote the rest to polite.', 'document');
  }

  // ── 18. tabindex-pos ────────────────────────────────────────────────────
  for (const el of Array.from(doc.querySelectorAll('[tabindex]'))) {
    const n = Number(el.getAttribute('tabindex'));
    if (Number.isNaN(n)) continue;
    if (n > 0) {
      add('tabindex-pos', 'err',
        `tabindex="${n}" forces this element ahead of the natural tab order.`,
        'Use tabindex="0" and place the element where it belongs in the DOM.', selectorFor(el));
    } else if (n === 0) {
      const tag = el.tagName.toLowerCase();
      const role = roleOf(el);
      const interactive = INTERACTIVE_ELEMENTS.has(tag)
        || (role !== undefined && INTERACTIVE_ROLES.has(role));
      if (!interactive) {
        add('tabindex-pos', 'warn',
          `tabindex="0" on a non-interactive <${tag}> adds a tab stop that does nothing.`,
          'Remove the tabindex, or give the element an interactive role and behaviour.',
          selectorFor(el));
      }
    }
  }

  // ── 19. dialog-name ─────────────────────────────────────────────────────
  for (const d of Array.from(doc.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]'))) {
    // A dialog is not named by its own body text, so accessibleName's
    // textContent fallback does not apply here.
    const labelledby = d.getAttribute('aria-labelledby')?.trim();
    const named = !!d.getAttribute('aria-label')?.trim()
      || !!d.getAttribute('title')?.trim()
      || !!(labelledby && labelledby.split(/\s+/).some(id => doc.getElementById(id)?.textContent?.trim()));
    if (!named) {
      add('dialog-name', 'err',
        'Dialog has no accessible name, so its purpose is unannounced on open.',
        'Add aria-label, or aria-labelledby pointing at the dialog heading.', selectorFor(d));
    }
  }

  // ── 20. hidden-focus (dom only) ─────────────────────────────────────────
  for (const host of Array.from(doc.querySelectorAll('[aria-hidden="true"]'))) {
    const focusables = [
      ...(isFocusable(host) ? [host] : []),
      ...Array.from(host.querySelectorAll('*')).filter(isFocusable),
    ];
    for (const f of focusables) {
      add('hidden-focus', 'err',
        f === host
          ? 'Element is aria-hidden but still focusable, so keyboard users land on content screen readers ignore.'
          : 'Focusable element sits inside an aria-hidden ancestor, so it is reachable by keyboard but invisible to screen readers.',
        'Remove aria-hidden, or make the element unfocusable with tabindex="-1" (and disable it).',
        selectorFor(f));
    }
  }

  return issues;
}

/** CSS.escape is not available in every parser host; this covers id syntax. */
function CSS_escape(s: string): string {
  return s.replace(/["\\\]]/g, '\\$&');
}
