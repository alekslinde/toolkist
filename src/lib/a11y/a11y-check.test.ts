import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { a11yCheck, astCheck, domCheck, mergeIssues, summarise, toJson } from './a11y-check.js';
import { RULES, type Issue, type RuleId } from './types.js';

const fixture = (n: string) =>
  readFileSync(join(__dirname, '__fixtures__', `a11y-${n}.html`), 'utf8');

const ids = (issues: Issue[]) => issues.map(i => i.ruleId);

/**
 * Each rule gets one markup sample that must trigger it and one that must not.
 * `both` rules are asserted against both engines.
 */
const CASES: Array<{
  rule: RuleId;
  bad: string;
  good: string;
}> = [
  {
    rule: 'img-alt',
    bad: '<img src="a.png">',
    good: '<img src="a.png" alt="A tabby cat asleep on a windowsill">',
  },
  {
    rule: 'form-label',
    bad: '<input type="text" name="q">',
    good: '<label for="q">Search</label><input id="q" type="text">',
  },
  {
    rule: 'button-name',
    bad: '<button></button>',
    good: '<button>Save changes</button>',
  },
  {
    rule: 'link-name',
    bad: '<a href="/x"></a>',
    good: '<a href="/x">Read the deployment guide</a>',
  },
  {
    rule: 'heading-order',
    bad: '<h1>Title</h1><h4>Jumped</h4>',
    good: '<h1>Title</h1><h2>Section</h2>',
  },
  {
    rule: 'html-lang',
    bad: '<html><head><title>T</title></head><body><p>x</p></body></html>',
    good: '<html lang="en"><head><title>T</title></head><body><p>x</p></body></html>',
  },
  {
    rule: 'title',
    bad: '<html lang="en"><head></head><body><p>x</p></body></html>',
    good: '<html lang="en"><head><title>Report</title></head><body><p>x</p></body></html>',
  },
  {
    rule: 'aria-valid',
    bad: '<div role="buton">x</div>',
    good: '<div role="button" tabindex="0">x</div>',
  },
  {
    rule: 'table-hdr',
    bad: '<table><tr><td>a</td></tr></table>',
    good: '<table><tr><th scope="col">Name</th></tr><tr><td>a</td></tr></table>',
  },
  {
    rule: 'captions',
    bad: '<video controls></video>',
    good: '<video controls><track kind="captions" src="c.vtt" srclang="en" label="English"></video>',
  },
  {
    rule: 'frame-title',
    bad: '<iframe src="x.html"></iframe>',
    good: '<iframe src="x.html" title="Pricing table"></iframe>',
  },
  {
    rule: 'dup-id',
    bad: '<p id="a">1</p><p id="a">2</p>',
    good: '<p id="a">1</p><p id="b">2</p>',
  },
  {
    rule: 'live-misuse',
    bad: '<div aria-live="shouty">x</div>',
    good: '<div aria-live="polite">x</div>',
  },
  {
    rule: 'tabindex-pos',
    bad: '<button tabindex="3">x</button>',
    good: '<button tabindex="0">x</button>',
  },
  {
    rule: 'dialog-name',
    bad: '<dialog><p>hi</p></dialog>',
    good: '<dialog aria-label="Confirm deletion"><p>hi</p></dialog>',
  },
];

describe.each(CASES)('rule: $rule', ({ rule, bad, good }) => {
  const meta = RULES.find(r => r.id === rule)!;

  it('flags the failing sample', () => {
    for (const eng of meta.engines) {
      const found = eng === 'ast' ? ids(astCheck(bad)) : ids(domCheck(bad));
      expect(found, `${eng} engine should flag ${rule}`).toContain(rule);
    }
  });

  it('passes the compliant sample', () => {
    for (const eng of meta.engines) {
      const found = eng === 'ast' ? ids(astCheck(good)) : ids(domCheck(good));
      expect(found, `${eng} engine should not flag ${rule}`).not.toContain(rule);
    }
  });
});

// Every registered rule must have a bad/good case above or a dedicated
// dom-only describe below — a rule without a test drifts silently.
describe('registry coverage', () => {
  it('covers every rule in RULES', () => {
    const domOnly: RuleId[] = ['landmarks', 'contrast', 'focus-ind', 'skip-link', 'hidden-focus'];
    const covered = new Set([...CASES.map(c => c.rule), ...domOnly]);
    for (const r of RULES) {
      expect(covered.has(r.id), `rule ${r.id} has no test case`).toBe(true);
    }
  });
});

// ── DOM-only rules ────────────────────────────────────────────────────────

describe('rule: landmarks (dom only)', () => {
  it('flags a document with no main landmark', () => {
    const html = '<html lang="en"><head><title>T</title></head><body><p>x</p></body></html>';
    expect(ids(domCheck(html))).toContain('landmarks');
  });

  it('passes a document with main and nav', () => {
    const html = '<html lang="en"><head><title>T</title></head><body>'
      + '<nav aria-label="Primary"><a href="/a">About</a></nav><main><h1>H</h1></main></body></html>';
    expect(ids(domCheck(html))).not.toContain('landmarks');
  });

  it('flags duplicate unlabelled landmarks', () => {
    const html = '<html lang="en"><head><title>T</title></head><body>'
      + '<nav><a href="/a">A</a></nav><nav><a href="/b">B</a></nav><main><h1>H</h1></main></body></html>';
    expect(ids(domCheck(html))).toContain('landmarks');
  });
});

describe('rule: contrast (dom only)', () => {
  it('flags text below the AA minimum', () => {
    const html = '<p style="color:#aaaaaa;background-color:#ffffff">faint</p>';
    const found = domCheck(html).filter(i => i.ruleId === 'contrast' && i.sev === 'err');
    expect(found.length).toBeGreaterThan(0);
  });

  it('passes text above the AA minimum', () => {
    const html = '<p style="color:#111111;background-color:#ffffff">solid</p>';
    const found = domCheck(html).filter(i => i.ruleId === 'contrast' && i.sev === 'err');
    expect(found).toHaveLength(0);
  });

  // Roadmap §5.1 — an unresolvable colour is a notice, never a computed ratio.
  it('emits a notice rather than a ratio when colour is unresolvable', () => {
    const html = '<p style="color:var(--brand);background-color:#fff">x</p>';
    const found = domCheck(html).filter(i => i.ruleId === 'contrast');
    expect(found.every(i => i.sev === 'notice')).toBe(true);
  });

  // The limitation is the same for every element, so it is stated once.
  it('emits at most one coverage notice per run', () => {
    const many = '<p style="color:var(--a)">1</p><p style="color:var(--b)">2</p>'
      + '<p style="color:var(--c)">3</p>';
    expect(domCheck(many).filter(i => i.ruleId === 'contrast')).toHaveLength(1);
  });

  it('scores a compliant document 100 despite the contrast notice', () => {
    const html = '<html lang="en"><head><title>T</title></head><body>'
      + '<a href="#m">Skip to content</a><nav aria-label="P"><a href="/a">About us</a></nav>'
      + '<main id="m"><h1>Heading</h1></main></body></html>';
    const r = a11yCheck(html);
    expect(r.summary.err).toBe(0);
    expect(r.summary.score).toBe(100);
  });

  it('emits a notice when alpha makes the ratio indeterminate', () => {
    const html = '<p style="color:rgba(0,0,0,0.4);background-color:#fff">x</p>';
    const found = domCheck(html).filter(i => i.ruleId === 'contrast');
    expect(found.every(i => i.sev === 'notice')).toBe(true);
  });

  it('applies the 3:1 threshold to large text', () => {
    // 3.5:1 — fails for body text, passes at 24px.
    const small = '<p style="color:#949494;background-color:#ffffff;font-size:16px">x</p>';
    const large = '<p style="color:#949494;background-color:#ffffff;font-size:26px">x</p>';
    expect(domCheck(small).filter(i => i.ruleId === 'contrast' && i.sev === 'err').length)
      .toBeGreaterThan(0);
    expect(domCheck(large).filter(i => i.ruleId === 'contrast' && i.sev === 'err'))
      .toHaveLength(0);
  });

  it('resolves relative font-size units against a 16px baseline', () => {
    // #949494 on white is ~3.5:1 — an err at body size, fine at 1.625em (26px).
    const small = '<p style="color:#949494;background-color:#ffffff;font-size:1em">x</p>';
    const large = '<p style="color:#949494;background-color:#ffffff;font-size:1.625em">x</p>';
    expect(domCheck(small).filter(i => i.ruleId === 'contrast' && i.sev === 'err').length)
      .toBeGreaterThan(0);
    expect(domCheck(large).filter(i => i.ruleId === 'contrast' && i.sev === 'err'))
      .toHaveLength(0);
  });
});

describe('rule: focus-ind (dom only)', () => {
  it('flags an inline outline:none', () => {
    expect(ids(domCheck('<a href="#x" style="outline:none">x</a>'))).toContain('focus-ind');
  });

  it('flags a :focus rule with no :focus-visible replacement', () => {
    const html = '<style>a:focus { outline: none; }</style><a href="#x">x</a>';
    expect(ids(domCheck(html))).toContain('focus-ind');
  });

  it('passes when :focus-visible provides a replacement', () => {
    const html = '<style>a:focus { outline: none; } a:focus-visible { outline: 2px solid; }</style>'
      + '<a href="#x">x</a>';
    expect(ids(domCheck(html))).not.toContain('focus-ind');
  });
});

describe('rule: skip-link (dom only)', () => {
  it('flags a full document with no skip link', () => {
    const html = '<html lang="en"><head><title>T</title></head><body>'
      + '<nav aria-label="P"><a href="/a">About</a></nav><main><h1>H</h1></main></body></html>';
    expect(ids(domCheck(html))).toContain('skip-link');
  });

  it('passes when a skip link is present', () => {
    const html = '<html lang="en"><head><title>T</title></head><body>'
      + '<a href="#main">Skip to content</a><nav aria-label="P"><a href="/a">About</a></nav>'
      + '<main id="main"><h1>H</h1></main></body></html>';
    expect(ids(domCheck(html))).not.toContain('skip-link');
  });
});

describe('rule: hidden-focus (dom only)', () => {
  it('flags a focusable element inside an aria-hidden ancestor', () => {
    expect(ids(domCheck('<div aria-hidden="true"><button>x</button></div>')))
      .toContain('hidden-focus');
  });

  it('flags an aria-hidden element that is itself focusable', () => {
    expect(ids(domCheck('<a href="/x" aria-hidden="true">x</a>'))).toContain('hidden-focus');
  });

  it('passes aria-hidden content with nothing focusable inside', () => {
    expect(ids(domCheck('<div aria-hidden="true"><span>decor</span></div>')))
      .not.toContain('hidden-focus');
  });

  // jsdom has no layout engine, so visibility-derived focusability is out of
  // scope here; the aria-hidden relationship is what this rule actually tests.
  it('resolves the ancestor relationship, not computed visibility', () => {
    const deep = '<div aria-hidden="true"><section><p><a href="/x">deep</a></p></section></div>';
    expect(ids(domCheck(deep))).toContain('hidden-focus');
  });
});

// ── False-positive guards (roadmap §8) ────────────────────────────────────

describe('false-positive guards', () => {
  it('accepts decorative images marked presentational', () => {
    expect(ids(astCheck('<img src="s.gif" alt="" role="presentation">'))).not.toContain('img-alt');
    expect(ids(domCheck('<img src="s.gif" alt="" role="presentation">'))).not.toContain('img-alt');
    expect(ids(astCheck('<img src="s.gif" alt="" aria-hidden="true">'))).not.toContain('img-alt');
  });

  it('accepts a visually-hidden label as a real label', () => {
    const html = '<label><span style="position:absolute;left:-9999px">Search</span>'
      + '<input type="search"></label>';
    expect(ids(domCheck(html))).not.toContain('form-label');
  });

  it('accepts a wrapping <label> with no for/id pair', () => {
    const html = '<label>Email address <input type="email"></label>';
    expect(ids(astCheck(html))).not.toContain('form-label');
    expect(ids(domCheck(html))).not.toContain('form-label');
  });

  it('matches labels to ids containing selector syntax', () => {
    const html = '<label for="a.b:c">Name</label><input id="a.b:c" type="text">';
    expect(ids(astCheck(html))).not.toContain('form-label');
    expect(ids(domCheck(html))).not.toContain('form-label');
  });

  it('still flags a control that has left the wrapping label', () => {
    const html = '<label>Email <input type="email"></label><input type="text">';
    expect(ids(astCheck(html))).toContain('form-label');
    expect(ids(domCheck(html))).toContain('form-label');
  });

  it('does not treat a dialog\'s body text as its accessible name', () => {
    expect(ids(domCheck('<dialog><p>Are you sure?</p></dialog>'))).toContain('dialog-name');
    expect(ids(domCheck('<div role="dialog"><h2>Settings</h2></div>'))).toContain('dialog-name');
  });

  it('accepts a dialog named by aria-labelledby', () => {
    const html = '<dialog aria-labelledby="dt"><h2 id="dt">Confirm deletion</h2></dialog>';
    expect(ids(domCheck(html))).not.toContain('dialog-name');
  });

  it('accepts an svg <title> as a button name', () => {
    const html = '<button><svg aria-hidden="true"><title>Download</title></svg></button>';
    expect(ids(domCheck(html))).not.toContain('button-name');
  });

  it('accepts aria-label on a button whose visible content is decorative', () => {
    const html = '<button aria-label="Close panel"><span aria-hidden="true">x</span></button>';
    expect(ids(domCheck(html))).not.toContain('button-name');
  });

  it('ignores layout tables marked presentational', () => {
    const html = '<table role="presentation"><tr><td>a</td></tr></table>';
    expect(ids(astCheck(html))).not.toContain('table-hdr');
    expect(ids(domCheck(html))).not.toContain('table-hdr');
  });

  it('ignores input types that take no label', () => {
    const html = '<input type="hidden" name="csrf"><input type="submit" value="Go">';
    expect(ids(astCheck(html))).not.toContain('form-label');
    expect(ids(domCheck(html))).not.toContain('form-label');
  });

  // Truncated pastes and JSX fragments are normal input for this tool; an
  // unterminated element must not be reported as having no accessible name.
  it('does not flag unclosed elements as unnamed', () => {
    expect(ids(astCheck('<button>Save'))).not.toContain('button-name');
    expect(ids(astCheck('<h1>Quarterly report'))).not.toContain('heading-order');
    expect(ids(astCheck('<a href="/x">Read the deployment guide')))
      .not.toContain('link-name');
  });

  it('still flags genuinely empty elements', () => {
    expect(ids(astCheck('<button></button>'))).toContain('button-name');
    expect(ids(astCheck('<a href="/x"></a>'))).toContain('link-name');
  });

  it('ignores markup inside script and style blocks', () => {
    expect(astCheck('<script>var s = "<img src=x>";</script>')).toHaveLength(0);
    expect(astCheck('<style>/* <img src=x> */</style>')).toHaveLength(0);
  });

  it('does not flag aria-* attributes valid for the implicit role', () => {
    expect(ids(astCheck('<button aria-pressed="true">x</button>'))).not.toContain('aria-valid');
    expect(ids(domCheck('<button aria-pressed="true">x</button>'))).not.toContain('aria-valid');
  });

  it('reports an invalid role once, without a permit-table follow-up', () => {
    for (const issues of [astCheck('<div role="buton" aria-pressed="true">x</div>'), domCheck('<div role="buton" aria-pressed="true">x</div>')]) {
      expect(issues.filter(i => i.ruleId === 'aria-valid')).toHaveLength(1);
    }
  });
});

// ── JSX confidence (roadmap §4.2) ─────────────────────────────────────────

describe('jsx mode', () => {
  it('marks structural findings approx', () => {
    const jsx = '<h1>A</h1><h3>B</h3>';
    const issue = astCheck(jsx, 'jsx').find(i => i.ruleId === 'heading-order');
    expect(issue?.confidence).toBe('approx');
  });

  it('keeps non-structural findings exact', () => {
    const issue = astCheck('<iframe src="x" />', 'jsx').find(i => i.ruleId === 'frame-title');
    expect(issue?.confidence).toBe('exact');
  });

  it('does not flag attributes whose values are dynamic expressions', () => {
    expect(ids(astCheck('<img src={src} alt={caption} />', 'jsx'))).not.toContain('img-alt');
    expect(ids(astCheck('<iframe src={u} title={t} />', 'jsx'))).not.toContain('frame-title');
  });

  it('reads string literals inside JSX braces', () => {
    expect(ids(astCheck('<img src={a} alt={"A cat"} />', 'jsx'))).not.toContain('img-alt');
  });

  it('does not run the DOM engine on jsx input', () => {
    const r = a11yCheck('<img src={x} />', { kind: 'jsx' });
    expect(r.issues.every(i => i.engine === 'ast')).toBe(true);
  });
});

// ── Merge, summary, export ────────────────────────────────────────────────

describe('merge', () => {
  it('prefers the DOM finding when both engines flag the same element', () => {
    const src = '<img id="hero" src="a.png">';
    const merged = mergeIssues(astCheck(src), domCheck(src));
    const imgIssues = merged.filter(i => i.ruleId === 'img-alt');
    expect(imgIssues).toHaveLength(1);
    expect(imgIssues[0].engine).toBe('dom');
    expect(imgIssues[0].confidence).toBe('exact');
  });

  it('merges nested id-less findings on the same element', () => {
    const src = '<main><section><img src="a.png"></section></main>';
    const merged = mergeIssues(astCheck(src), domCheck(src));
    const imgIssues = merged.filter(i => i.ruleId === 'img-alt');
    expect(imgIssues).toHaveLength(1);
    expect(imgIssues[0].engine).toBe('dom');
  });

  it('keeps static-only findings the DOM engine cannot reach', () => {
    const merged = mergeIssues(
      [{ ruleId: 'img-alt', engine: 'ast', sev: 'err', confidence: 'approx', msg: 'm', fix: 'f', sel: '#only-ast' }],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].engine).toBe('ast');
  });

  it('does not collapse two different findings on the same tag', () => {
    const merged = mergeIssues([], [
      { ruleId: 'link-name', engine: 'dom', sev: 'warn', confidence: 'exact', msg: 'no href', fix: 'f', sel: 'a' },
      { ruleId: 'link-name', engine: 'dom', sev: 'warn', confidence: 'exact', msg: 'vague text', fix: 'f', sel: 'a' },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('sorts errors before warnings before notices', () => {
    const sorted = mergeIssues([], [
      { ruleId: 'contrast', engine: 'dom', sev: 'notice', confidence: 'exact', msg: 'n', fix: 'f', sel: 'x' },
      { ruleId: 'img-alt', engine: 'dom', sev: 'err', confidence: 'exact', msg: 'e', fix: 'f', sel: 'y' },
      { ruleId: 'link-name', engine: 'dom', sev: 'warn', confidence: 'exact', msg: 'w', fix: 'f', sel: 'z' },
    ]);
    expect(sorted.map(i => i.sev)).toEqual(['err', 'warn', 'notice']);
  });
});

describe('summary', () => {
  it('counts each severity', () => {
    const s = summarise([
      { ruleId: 'img-alt', engine: 'dom', sev: 'err', confidence: 'exact', msg: '', fix: '', sel: '' },
      { ruleId: 'link-name', engine: 'dom', sev: 'warn', confidence: 'exact', msg: '', fix: '', sel: '' },
      { ruleId: 'contrast', engine: 'dom', sev: 'notice', confidence: 'exact', msg: '', fix: '', sel: '' },
    ]);
    expect(s).toMatchObject({ err: 1, warn: 1, notice: 1, total: 3 });
  });

  it('scores a clean result 100', () => {
    expect(summarise([]).score).toBe(100);
  });

  // A notice says "not checked", not "broken" — it must not cost score, or a
  // fully compliant page could never reach 100.
  it('does not penalise notices', () => {
    const s = summarise([
      { ruleId: 'contrast', engine: 'dom', sev: 'notice', confidence: 'exact', msg: '', fix: '', sel: '' },
      { ruleId: 'landmarks', engine: 'dom', sev: 'notice', confidence: 'exact', msg: '', fix: '', sel: '' },
    ]);
    expect(s.score).toBe(100);
    expect(s.notice).toBe(2);
  });

  it('never scores below zero', () => {
    const many: Issue[] = Array.from({ length: 200 }, () => ({
      ruleId: 'img-alt' as RuleId, engine: 'dom' as const, sev: 'err' as const,
      confidence: 'exact' as const, msg: '', fix: '', sel: '',
    }));
    expect(summarise(many).score).toBe(0);
  });
});

describe('json export', () => {
  it('produces parseable output carrying summary and confidence', () => {
    const result = a11yCheck('<img src="a.png">');
    const parsed = JSON.parse(toJson(result));
    expect(parsed.tool).toBe('toolkist-accessibility-checker');
    expect(parsed.summary.total).toBeGreaterThan(0);
    expect(parsed.issues[0]).toHaveProperty('confidence');
  });
});

// ── Fixture-level behaviour ───────────────────────────────────────────────

describe('fixtures', () => {
  it('finds no errors in the compliant document', () => {
    const r = a11yCheck(fixture('good-doc'));
    const errors = r.issues.filter(i => i.sev === 'err');
    expect(errors, `unexpected errors: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0);
  });

  it('finds no errors in the false-positive guard document', () => {
    const r = a11yCheck(fixture('fp-guards'));
    const errors = r.issues.filter(i => i.sev === 'err');
    expect(errors, `unexpected errors: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0);
  });

  it('finds a broad spread of rules in the failing document', () => {
    const r = a11yCheck(fixture('bad-doc'));
    const found = new Set(r.issues.map(i => i.ruleId));
    // Every rule this fixture was written to trip.
    for (const rule of [
      'img-alt', 'form-label', 'button-name', 'link-name', 'heading-order',
      'html-lang', 'title', 'aria-valid', 'table-hdr', 'captions', 'frame-title',
      'dup-id', 'live-misuse', 'tabindex-pos', 'dialog-name', 'hidden-focus',
      'landmarks', 'contrast', 'focus-ind', 'skip-link',
    ] satisfies RuleId[]) {
      expect(found, `expected ${rule} in bad fixture`).toContain(rule);
    }
  });

  it('scores the bad document well below the good one', () => {
    expect(a11yCheck(fixture('bad-doc')).summary.score)
      .toBeLessThan(a11yCheck(fixture('good-doc')).summary.score);
  });
});
