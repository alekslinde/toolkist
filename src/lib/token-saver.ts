/**
 * Prompt Token Saver — pure compression engine.
 * All logic is client-side; no network calls.
 *
 * Extracted from the tool page so it can be unit-tested and reused.
 */

export type CoreDictionaries = {
  phrases: Record<string, string>;
  logic: Record<string, string>;
  synonyms: Record<string, string>;
  blacklist: string[];
};

// SEE REPO FOR FULL CONTENT - TEMP
export const coreDictionaries: CoreDictionaries = { phrases: {}, logic: {}, synonyms: {}, blacklist: [] };
export class Defluffer {
  constructor(_d: CoreDictionaries, _e: Record<string, string> = {}) {}
  compress(prompt: string): string { return prompt; }
}
export const domainPacks: Record<string, Record<string, string>> = {};
export const BENCHMARK_PROMPTS: string[] = [];
export function getActivePackPhrases(_ids: string[]): Record<string, string> { return {}; }
export const CHARS_PER_TOKEN = 3.5;
export function estimateTokens(text: string, charsPerToken = CHARS_PER_TOKEN): number {
  if (!text) return 0;
  return Math.max(0, Math.round(text.length / charsPerToken));
}
export type CompressResult = {
  original: string; compressed: string; charsSaved: number; pctSaved: number;
  tokensOriginal: number; tokensCompressed: number; tokensSaved: number;
};
export function compressPrompt(prompt: string, options: { packIds?: string[] } = {}): CompressResult {
  return {
    original: prompt, compressed: prompt, charsSaved: 0, pctSaved: 0,
    tokensOriginal: estimateTokens(prompt), tokensCompressed: estimateTokens(prompt), tokensSaved: 0,
  };
}
export function termOverlapSimilarity(a: string, b: string): number {
  return a === b ? 1 : 0;
}
