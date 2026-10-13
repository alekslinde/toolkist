# Accessibility checker — design roadmap

Working notes for the two engines in this directory (`ast-check` scans source
text, `dom-check` walks a parsed DOM, `a11y-check` merges them). Section
numbers are cited from code comments.

## 4. Accessible-name computation

### 4.1 Order: labelledby > label > text > alt|title|value

`aria-labelledby` wins over `aria-label`; both win over visible text; the
`alt`/`title`/`value` attributes are last resorts. A `<dialog>` is the
exception: its own body text never names it, so only `aria-label`,
`aria-labelledby` or `title` count. An `<svg><title>` inside the element
names it. Visually-hidden text still counts — screen readers announce it.

## 4.2 JSX confidence

JSX and Astro templates never render here, so structure is inferred from
source order: conditionals, `.map()` loops and spread props can hide the
real tree. Findings that depend on structure (heading order, duplicate ids,
table scope, live regions, tab order) are therefore `confidence: 'approx'`
on `jsx` input — badged in the UI, never presented as verified. Findings
about a single element's own attributes (missing `alt`, bad `role`) stay
`exact`. Attribute values that are dynamic expressions (`alt={caption}`)
are unknowable: plain `{expr}` is treated as "assumed present" (fewer false
positives), while string literals inside braces (`alt={"A cat"}`) are read.
The DOM engine never runs on `jsx` input — JSX would parse into nonsense.

## 5. What a snippet cannot see

### 5.1 Computed style is out of scope

Pasted markup carries no stylesheets, no layout and no cascade. Rules that
need the rendered page say so with `sev: 'notice'` instead of guessing:

- **Contrast** resolves only fully-opaque inline colours with a resolvable
  inline background. `var()`, `currentColor`, gradients, partial alpha and
  missing backgrounds are counted once per run in a single coverage notice,
  never per element (the caveat is identical everywhere and would bury real
  findings). Notices never reduce the score, so a compliant page can reach
  100 despite the unchecked rule.
- **Focus indicators** flag only `outline: none` that is visible in the
  markup (inline style or an in-snippet `<style>` block without a
  `:focus-visible` replacement). Anything from an external stylesheet is
  invisible by construction.
- **Visibility** is inline-style only (`display:none`, `visibility:hidden`);
  jsdom has no layout engine, so computed visibility is untestable. The
  `hidden-focus` rule therefore covers the `aria-hidden` relationship
  (which is semantic, not visual) and deliberately ignores `display:none`
  containers. Likewise a `hidden` attribute removes the element from the
  tab order in real browsers, so focusable content inside `hidden` is not
  flagged — unlike `aria-hidden`, which keeps keyboard reachability.

## 8. False-positive guards

Every rule ships with a guard test in `a11y-check.test.ts` plus two fixture
documents: `good-doc` (must produce zero errors) and `fp-guards` (patterns
that naive checkers flag — presentational tables, wrapping labels,
`aria-labelledby` dialogs, `svg <title>` names). A good sample must pass on
*every* engine that implements the rule. Truncated pastes are normal input:
an unterminated element reads to end of source, so `<button>Save` is never
reported as unnamed, while `<button></button>` still is. Markup inside
`<script>`/`<style>` is blanked before scanning.
