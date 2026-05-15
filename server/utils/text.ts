// Shared text helpers. Use these instead of re-implementing the
// same operation per file (#1306).
//
// Why not in `format/`: these are general string operations, not
// presentation-layer formatters. Reserve `format/` for locale-aware
// or unit-aware display helpers.

/** Truncate `text` to at most `max` characters, appending `ellipsis`
 *  when the input is too long.
 *
 *  The ellipsis is part of the budget: `truncate("hello world", 8)`
 *  yields `"hello w…"` (7 chars of the original + the ellipsis = 8
 *  total). This avoids the off-by-one bug where naive
 *  `slice(0, max) + "…"` overshoots `max`.
 *
 *  Edge cases:
 *  - `text.length <= max` → return `text` unchanged.
 *  - `max <= 0` → return the empty string (callers asking for "no
 *    output" should get "no output", not a stray ellipsis).
 *  - If `ellipsis.length > max`, the ellipsis itself is truncated
 *    to fit `max` rather than throwing — keeps callers safe from
 *    surprising errors when they pick a tiny max with a multi-char
 *    ellipsis. */
export function truncate(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (ellipsis.length >= max) return ellipsis.slice(0, max);
  return text.slice(0, max - ellipsis.length) + ellipsis;
}
