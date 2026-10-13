/**
 * Terms that must not be synonym-abbreviated.
 * Keep this list small: only words whose short forms often change meaning
 * in ordinary technical prose (not clear jargon like configuration → config).
 */
export const SYNONYM_PRESERVE = new Set<string>([
  // Auth / security — short forms collide with product jargon
  "token",
  "tokens",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwords",
  // Prose nouns that become cryptic one-offs
  "error",
  "errors",
  "message",
  "messages",
  "string",
  "strings",
  // Boolean / nullish literals — never useful to abbreviate
  "true",
  "false",
  "null",
  "undefined",
]);

/**
 * True when a word should keep its original form (no synonym swap).
 * - Explicit preserve list
 * - Proper-case tokens (likely proper nouns / titles), e.g. "PostgreSQL", "Auth0"
 * - ALL-CAPS tokens of length ≥ 2 (acronyms already short)
 */
export function shouldPreserveToken(token: string): boolean {
  if (!token) return true;
  const lower = token.toLowerCase();
  if (SYNONYM_PRESERVE.has(lower)) return true;
  // ALL-CAPS acronyms (HTTP, API, JWT) — already short; leave alone
  if (token.length >= 2 && token === token.toUpperCase() && /^[A-Z0-9_-]+$/.test(token)) {
    return true;
  }
  // Mixed / proper case, e.g. "PostgreSQL", "GraphQL", "OpenAI"
  if (/[A-Z]/.test(token.slice(1)) && token !== lower) {
    return true;
  }
  return false;
}
