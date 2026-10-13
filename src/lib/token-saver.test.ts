import { describe, it, expect } from 'vitest';
import {
  Defluffer,
  coreDictionaries,
  compressPrompt,
  estimateTokens,
  termOverlapSimilarity,
  BENCHMARK_PROMPTS,
  getActivePackPhrases,
  domainPacks,
  shouldPreserveToken,
  wordDiff,
  wordDiffHtml,
} from './token-saver';

describe('Defluffer / compressPrompt', () => {
  it('never increases length on benchmark prompts', () => {
    const engine = new Defluffer(coreDictionaries);
    for (const p of BENCHMARK_PROMPTS) {
      const out = engine.compress(p);
      expect(out.length).toBeLessThanOrEqual(p.length);
    }
  });

  it('protects fenced and inline code blocks', () => {
    const engine = new Defluffer(coreDictionaries);
    const input =
      'Could you please explain this:\n```\nfunction authentication() { return configuration; }\n```\nand also `authentication` here.';
    const out = engine.compress(input);
    expect(out).toContain('```\nfunction authentication() { return configuration; }\n```');
    expect(out).toContain('`authentication`');
  });

  it('collapses common filler phrases', () => {
    const r = compressPrompt('Could you please help me with implementing authentication?');
    expect(r.compressed.toLowerCase()).not.toMatch(/could you please/);
    expect(r.charsSaved).toBeGreaterThan(0);
  });

  it('applies domain packs when requested', () => {
    const without = compressPrompt('Please use the use state hook in this react component.');
    const withPack = compressPrompt('Please use the use state hook in this react component.', {
      packIds: ['pack-react'],
    });
    expect(withPack.compressed).not.toEqual(without.compressed);
    expect(getActivePackPhrases(['pack-react'])['use state hook']).toBe('useState');
  });

  it('exposes all domain packs', () => {
    expect(Object.keys(domainPacks).length).toBeGreaterThanOrEqual(4);
  });

  it('preserves ambiguous nouns that would become cryptic abbreviations', () => {
    const engine = new Defluffer(coreDictionaries);
    // "token", "error", "message" are on the preserve list — must not become tok/err/msg
    const out = engine.compress('Validate the token and report every error in the message.');
    expect(out.toLowerCase()).toMatch(/\btoken\b/);
    expect(out.toLowerCase()).toMatch(/\berror\b/);
    expect(out.toLowerCase()).toMatch(/\bmessage\b/);
  });

  it('still abbreviates high-value jargon (not on preserve list)', () => {
    const engine = new Defluffer(coreDictionaries);
    const out = engine.compress(
      'Update the configuration and authentication for the application environment.'
    );
    const lower = out.toLowerCase();
    // These synonym targets should still fire after the preserve-list trim
    expect(lower).toMatch(/\bconfig\b/);
    expect(lower).toMatch(/\bauth\b/);
    expect(lower).toMatch(/\bapp\b/);
    expect(lower).toMatch(/\benv\b/);
  });

  it('preserves proper-case and acronyms', () => {
    expect(shouldPreserveToken('PostgreSQL')).toBe(true);
    expect(shouldPreserveToken('GraphQL')).toBe(true);
    expect(shouldPreserveToken('HTTP')).toBe(true);
    expect(shouldPreserveToken('authentication')).toBe(false);
    expect(shouldPreserveToken('configuration')).toBe(false);
  });
});

describe('estimateTokens (o200k)', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns a positive count for ordinary text', () => {
    const n = estimateTokens('Hello world, how many tokens is this?');
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(20);
  });

  it('scales roughly with longer input', () => {
    const short = estimateTokens('hello');
    const long = estimateTokens('hello world this is a longer sentence with more words');
    expect(long).toBeGreaterThan(short);
  });
});

describe('wordDiff', () => {
  it('marks removals and keeps equals', () => {
    const segs = wordDiff('please help me implement auth', 'help implement auth');
    const types = segs.map((s) => s.type);
    expect(types).toContain('remove');
    expect(types).toContain('equal');
  });

  it('renders HTML with del/ins tags and escapes markup', () => {
    const html = wordDiffHtml('could you please help <script>', 'help <script>');
    expect(html).toContain('<del');
    expect(html).toContain('help');
    expect(html).toContain('<script>');
    expect(html).not.toContain('<script>');
  });
});

describe('termOverlapSimilarity', () => {
  it('is 1 for identical text', () => {
    expect(termOverlapSimilarity('hello world test', 'hello world test')).toBe(1);
  });

  it('is low for unrelated text', () => {
    expect(termOverlapSimilarity('authentication configuration', 'banana pineapple')).toBeLessThan(0.2);
  });

  it('stays reasonably high after mild compression', () => {
    const original =
      'Could you please help me implement authentication and configuration for the application?';
    const { compressed } = compressPrompt(original);
    const sim = termOverlapSimilarity(original, compressed);
    expect(sim).toBeGreaterThan(0.3);
  });
});
