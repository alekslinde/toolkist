/**
 * Core dictionaries for Prompt Token Saver.
 */
import { phrases } from "./token-saver-dict-phrases";
import { logic } from "./token-saver-dict-logic";
import { synonyms } from "./token-saver-dict-synonyms";
import { blacklist } from "./token-saver-dict-blacklist";

export type CoreDictionaries = {
  phrases: Record<string, string>;
  logic: Record<string, string>;
  synonyms: Record<string, string>;
  blacklist: string[];
};

export const coreDictionaries: CoreDictionaries = {
  phrases,
  logic,
  synonyms,
  blacklist,
};
