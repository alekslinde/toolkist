import { bench, describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { cssToSass } from '@/lib/scss-converter';

const FX = join(import.meta.dirname, '../fixtures');

const cssSmall  = readFileSync(join(FX, 'css/small.css'),   'utf8');
const cssMedium = readFileSync(join(FX, 'css/medium.css'),  'utf8');
const cssForSass = readFileSync(join(FX, 'css/for-sass.css'), 'utf8');

// cssToSass is line-based: it unwraps a brace only when the line ends with `{`
// or is exactly `}`. A single-line rule (`h1 { font-size: 2rem; }`) is passed
// through untouched, braces intact. small.css and medium.css both contain such
// rules, so "output has no braces" holds only for fixtures written without
// them — for-sass.css is the one that qualifies.
//
// Correctness lives here rather than inside the bench bodies: a throw inside a
// bench discards every sample and reports the case as `NaNx`, so a wrong
// assertion reads as a mysteriously absent result instead of a failure. Work
// asserted per-iteration is also measured, inflating the figure.
test('cssToSass output shape', () => {
  for (const [name, css] of [
    ['small', cssSmall], ['medium', cssMedium], ['for-sass', cssForSass],
  ] as const) {
    const out = cssToSass(css);
    expect(out.length, `${name}: produced no output`).toBeGreaterThan(0);
    expect(out, `${name}: indentation lost`).toContain('\n  ');
  }

  // Fully brace-free output is only expected where no single-line rules exist.
  const nested = cssToSass(cssForSass);
  expect(nested).not.toContain('{');
  expect(nested).not.toContain('}');
});

describe('cssToSass', () => {
  bench('small CSS  (~3 KB)',  () => { cssToSass(cssSmall); });
  bench('medium CSS (~14 KB)', () => { cssToSass(cssMedium); });
  bench('for-sass CSS (~4 KB) — multi-level nesting', () => { cssToSass(cssForSass); });
});
