# Benchmark baseline — pre-rebrand fixtures

Snapshot captured immediately **before** the `html/medium.html` fixture was
rebranded, so post-rebrand runs have a comparison point.

Captured: 2026-09-17 · Node 22 · vitest bench (`--outputJson`)

Fixture state at capture:

| Fixture | Bytes | SHA-256 |
|---|---|---|
| `html/medium.html` | 20612 | `3f229b9cac2a0ea822b2bf98da45dc4fad4dd4d84481ec558706d271496bdb42` |

`bench/fixtures/html/medium.html` and `public/bench-fixtures/html/medium.html`
were byte-identical at capture.

## Trustworthy numbers

Only the code-minifier group measures real work on this machine. These are the
figures to compare against; `minifyHTML` is the one the HTML fixture affects.

| Group | Case | ops/sec | mean (ms) | samples |
|---|---|---|---|---|
| `minifyJS`   | small  (~4 KB)  | 11554.90 | 0.0865 | 5778 |
| `minifyJS`   | medium (~16 KB) | 9367.43 | 0.1068 | 4684 |
| `minifyCSS`  | small  (~3 KB)  | 26404.00 | 0.0379 | 13202 |
| `minifyCSS`  | medium (~14 KB) | 6788.79 | 0.1473 | 3395 |
| `minifyHTML` | small  (~4 KB)  | 32186.41 | 0.0311 | 16094 |
| `minifyHTML` | medium (~18 KB) | 12304.06 | 0.0813 | 6153 |
| `cssToSass`  | for-sass (~4 KB) | 37024.71 | 0.0270 | 18513 |

Absolute ops/sec are machine- and load-specific. Compare ratios between cases
in the same run, not raw figures across machines.

## Corrected figures (after fixing the two measurement bugs)

Both bugs described below are now fixed, so these supersede the fake numbers.
This is the set to compare future runs against.

| Group | Case | ops/sec | mean (ms) |
|---|---|---|---|
| `inspectSfnt` | validate sample.ttf (~401 KB) | 104025 | 0.0096 |
| `buildWOFF` | TTF → WOFF | 66540 | 0.0150 |
| `buildEOT` | TTF → EOT | 72714 | 0.0138 |
| `unwrapWOFF` | WOFF → sfnt | 67243 | 0.0149 |
| `wawoff2` | compress TTF → WOFF2 | 1 | 790.31 |
| `wawoff2` | decompress WOFF2 → sfnt | 396 | 2.52 |
| `cssToSass` | small CSS (~3 KB) | 56901 | 0.0176 |
| `cssToSass` | medium CSS (~14 KB) | 17958 | 0.0557 |
| `cssToSass` | for-sass CSS (~4 KB) | 64761 | 0.0154 |

WOFF2 compression at ~790 ms for a ~400 KB font is the sanity check: the file's
own comment predicted seconds, while the pre-fix figure claimed 18 million
ops/sec.

`cssToSass` for-sass moved 38342 → 64761 with no change to the converter. The
per-iteration `expect` calls were being timed along with the work; hoisting them
out of the bench body removed that overhead. Do not read it as a speedup.

## The two bugs (fixed)

Recorded so the superseded numbers above are not mistaken for real results.

**`font-converter.bench.ts` — all cases.** Every benchmark guarded on a font at
a hardcoded Linux system path. Where absent, the guard returned early and the
benchmark timed an empty return — ~35,000,000 ops/sec for work on a ~401 KB
font — while the suite still exited 0. A valid `sample.ttf` was already tracked
in the repo at `public/bench-fixtures/fonts/`; the benchmark now prefers it and
throws if no candidate resolves, rather than silently reporting a fake figure.

**`cssToSass` — `small CSS` and `medium CSS`.** Both threw. The bench body
asserted the output contains no `{` or `}`, but `cssToSass` is line-based: it
unwraps a brace only when a line ends with `{` or is exactly `}`. A single-line
rule (`h1 { font-size: 2rem; }`) passes through with braces intact, and both
fixtures contain such rules — 11 lines in `small.css`, 79 in `medium.css`,
0 in `for-sass.css`, which is why only that case ever reported. A throw inside
a bench discards every sample, so this surfaced as `NaNx` rather than a failure.
Correctness now lives in a `test` that runs once, and asserts brace-free output
only for the fixture that has no single-line rules.

This is a real limitation of `cssToSass`, not just a bad assertion — the
converter does not handle single-line rules. The benchmark now documents that
rather than failing on it.

Neither issue related to the fixture rebrand; both predated it.

## Post-rebrand comparison

Re-run on the rebranded fixtures. `html/medium.html` went 20612 → 20617 bytes
(+5, +0.02%); `html/small.html` was also rebranded.

| Case | baseline | post | delta |
|---|---|---|---|
| `minifyJS` small | 11555 | 11874 | +2.8% |
| `minifyJS` medium | 9367 | 9557 | +2.0% |
| `minifyCSS` small | 26404 | 25976 | −1.6% |
| `minifyCSS` medium | 6789 | 6368 | −6.2% |
| `minifyHTML` small | 32186 | 31641 | −1.7% |
| `minifyHTML` medium | 12304 | 12104 | −1.6% |

The JS and CSS fixtures were not edited, yet they move by +2.8% to −6.2% across
the two runs. That band is this suite's run-to-run noise. Both `minifyHTML`
deltas fall inside it, so the fixture edit has no measurable effect — as the
+0.02% size change would predict. Treat a single-digit-percent difference here
as noise unless it reproduces across several runs.

## Reproducing

```bash
npx vitest bench --config vitest.bench.config.ts \
  --reporter=default --outputJson=bench/results/<name>.json
```

`npm run bench:node` prints to the terminal but writes no file: it pins
`--reporter=verbose`, and the `benchmark.outputFile` setting in
`vitest.bench.config.ts` does not apply to it. `--outputJson` is the flag that
persists a run.

`bench/results/*.json` is gitignored; this Markdown summary is committed
deliberately so the baseline survives.
