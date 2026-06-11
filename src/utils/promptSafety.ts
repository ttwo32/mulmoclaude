// Neutralize structural prompt-injection vectors in a short, record-derived
// string before it rides into an LLM-facing prompt: strip angle brackets,
// defang backticks / `${` template openings, COLLAPSE WHITESPACE (so an
// embedded newline can't fabricate a pseudo-instruction on its own line), and
// clip to a small budget. Shared by the server (presentCollection validation →
// instructions) and the client (collection Repair button) so the two defangs
// can't drift (#1677).

/** Max chars kept — the first batch of a validation issue is enough to act on. */
const DEFANG_MAX_LEN = 200;

export function defangForPrompt(value: string): string {
  return value.replace(/[<>]/g, "").replace(/`/g, "'").replace(/\$\{/g, "$ {").replace(/\s+/g, " ").slice(0, DEFANG_MAX_LEN);
}
