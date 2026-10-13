/**
 * Prompt Token Saver — public API.
 * All logic is client-side; no network calls.
 */
export type { CoreDictionaries } from "./token-saver-dicts";
export { coreDictionaries } from "./token-saver-dicts";
export { domainPacks } from "./token-saver-packs";
export { Defluffer } from "./token-saver-engine";
export { BENCHMARK_PROMPTS } from "./token-saver-benchmarks";
export { SYNONYM_PRESERVE, shouldPreserveToken } from "./token-saver-preserve";
export { wordDiff, wordDiffHtml } from "./token-saver-diff";
export type { DiffSeg } from "./token-saver-diff";

import { coreDictionaries } from "./token-saver-dicts";
import { domainPacks } from "./token-saver-packs";
import { Defluffer } from "./token-saver-engine";
import { encode as gptEncode } from "gpt-tokenizer/encoding/o200k_base";

/** Merge selected domain packs into a single extra-phrases map. */
export function getActivePackPhrases(activePackIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of activePackIds) {
    const pack = domainPacks[id];
    if (pack) Object.assign(out, pack);
  }
  return out;
}

/** Fallback chars-per-token when a heuristic is needed. */
export const CHARS_PER_TOKEN = 3.5;

/**
 * Count tokens with the o200k_base encoding (GPT-4o / GPT-4.1 / o-series).
 * Falls back to chars÷3.5 only if encoding throws (should not happen in normal use).
 */
export function estimateTokens(text: string, charsPerToken = CHARS_PER_TOKEN): number {
  if (!text) return 0;
  try {
    return gptEncode(text).length;
  } catch {
    return Math.max(0, Math.round(text.length / charsPerToken));
  }
}

export type CompressResult = {
  original: string;
  compressed: string;
  charsSaved: number;
  pctSaved: number;
  tokensOriginal: number;
  tokensCompressed: number;
  tokensSaved: number;
};

export function compressPrompt(
  prompt: string,
  options: { packIds?: string[] } = {}
): CompressResult {
  const extra = getActivePackPhrases(options.packIds ?? []);
  const engine = new Defluffer(coreDictionaries, extra);
  const compressed = engine.compress(prompt);
  const charsSaved = Math.max(0, prompt.length - compressed.length);
  const pctSaved = prompt.length === 0 ? 0 : (charsSaved / prompt.length) * 100;
  const tokensOriginal = estimateTokens(prompt);
  const tokensCompressed = estimateTokens(compressed);
  return {
    original: prompt,
    compressed,
    charsSaved,
    pctSaved: Math.round(pctSaved * 10) / 10,
    tokensOriginal,
    tokensCompressed,
    tokensSaved: Math.max(0, tokensOriginal - tokensCompressed),
  };
}

/** Simple term-overlap similarity (0–1). Cheap meaning-preservation signal. */
export function termOverlapSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}
