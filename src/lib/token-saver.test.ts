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
});

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with length', () => {
    expect(estimateTokens('a'.repeat(35))).toBe(10);
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
