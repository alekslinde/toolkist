/**
 * Defluffer — phrase collapse, synonym swap, code-block protection.
 */
import type { CoreDictionaries } from "./token-saver-dicts";

// ─── DEFLUFFER ───────────────────────────────────────────────────────────────
export class Defluffer {
  private compiledPhrases: Array<[RegExp, string]>;
  private synonyms: Record<string, string>;
  private blacklist: Set<string>;
  private multiBlacklist: Array<RegExp>;

  constructor(dicts: CoreDictionaries, extraPhrases: Record<string, string> = {}) {
    const merged = { ...dicts.phrases, ...dicts.logic, ...extraPhrases };
    this.synonyms = dicts.synonyms;
    this.blacklist = new Set(dicts.blacklist);

    // Phase 2a+2b: pre-compile regexes, sorted longest-key-first to prevent
    // shorter phrases stealing prefix matches (e.g. "in order to" vs "in order to prevent")
    this.compiledPhrases = Object.entries(merged)
      .filter(([k]) => k.length > 0)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([phrase, replacement]) => {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return [new RegExp(`\\b${escaped}\\b`, 'gi'), replacement];
      });

    // Phase 1a: multi-word blacklist entries pre-compiled, applied AFTER phrase collapse
    this.multiBlacklist = dicts.blacklist
      .filter((e) => e.includes(' '))
      .map((e) => new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  }

  // Phase 3: strip structural boilerplate before the main compression passes
  private structuralPass(text: string): string {
    return (
      text
        // collapse 3+ blank lines → 2
        .replace(/\n{3,}/g, '\n\n')
        // strip XML wrapper tags only when they appear on their own line
        .replace(
          /^[ \t]*<(task|context|instructions?|system|prompt|input|output)>[ \t]*\n([\s\S]*?)\n[ \t]*<\/\1>[ \t]*$/gim,
          '$2'
        )
        // remove freestanding label-only lines that add no content
        .replace(
          /^[ \t]*(here (is|are) (the )?(task|context|instructions?|prompt):?|your instructions are:?|please follow these instructions:?|additional context:?)\s*$/gim,
          ''
        )
        // deduplicate adjacent identical sentences
        .replace(/([^.!?]+[.!?])\s+\1/g, '$1')
        // collapse resulting blank lines from removals
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  compress(prompt: string): string {
    // Phase 3: structural cleanup first
    let text = this.structuralPass(prompt);

    const protectedItems: string[] = [];

    // 1. Extract and protect code blocks
    text = text.replace(/(```[\s\S]*?```|`[^`]+`)/g, (match) => {
      protectedItems.push(match);
      return `PROT${protectedItems.length - 1}PROT`;
    });

    // 2. Phrase + logic collapsing (pre-compiled, longest first)
    for (const [regex, replacement] of this.compiledPhrases) {
      text = text.replace(regex, () => {
        if (!replacement || replacement.trim() === '') return ' ';
        protectedItems.push(replacement);
        return `PROT${protectedItems.length - 1}PROT`;
      });
    }

    // 3. Multi-word blacklist removal — AFTER phrase collapse
    for (const re of this.multiBlacklist) {
      text = text.replace(re, '');
    }

    // 4. Tokenize
    let tokens = text.split(/(\b[a-zA-Z0-9_'-]+\b)/);

    // 5. Per-token: single-word blacklist + synonyms
    tokens = tokens.map((token) => {
      if (!/^[a-zA-Z0-9_'-]+$/.test(token)) return token;
      if (/^PROT\d+PROT$/.test(token)) return token;
      const lower = token.toLowerCase();
      if (this.blacklist.has(lower)) return '';
      if (this.synonyms[lower]) return this.synonyms[lower];
      return token;
    });

    text = tokens
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,?!;:])/g, '$1')
      .trim();

    // 6. Restore protected items — arrow fn prevents $-interpolation
    protectedItems.forEach((item, index) => {
      text = text.replaceAll(`PROT${index}PROT`, () => item);
    });

    return text
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,?!;:])/g, '$1')
      .trim();
  }
}
