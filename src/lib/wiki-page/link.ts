// Pure helpers for `[[wiki-link]]` syntax. Used by the lint
// (`server/api/routes/wiki.ts`), the page resolver, and the
// frontend renderer (`src/plugins/wiki/helpers.ts`) — before this
// module the three sites each had their own implementation and
// none of them handled the `[[target|display]]` form, producing
// false-positive "broken link" warnings on slug-aliased links
// (issue #1297).
//
// All functions are pure string operations; safe to import from
// browser bundles. No `node:*` imports anywhere in this file.

/** Inline `[[...]]` link pattern. The capture group is the raw
 *  text between the brackets — the caller is expected to feed it
 *  through `parseWikiLink` to split off any `|display` suffix.
 *
 *  Body length is capped at 200 chars to keep the regex linear:
 *  catastrophic backtracking isn't possible (no nested
 *  alternation), but a malicious page with thousands of
 *  unmatched `[[` could still pin the CPU. 200 is well above the
 *  longest legitimate title we've seen and matches the cap the
 *  server-side `WIKI_LINK_PATTERN` constant has carried since the
 *  original implementation in #951. */
export const WIKI_LINK_PATTERN = /\[\[([^\][\r\n]{1,200})\]\]/g;

/** The structural shape of an inline `[[target|display]]` link.
 *  `target` is what the resolver / lint compares against page
 *  slugs; `display` is what the renderer shows to the user.
 *  When the user writes `[[foo]]` (no pipe), both fields hold
 *  `foo`. */
export interface WikiLink {
  target: string;
  display: string;
}

/** Split the raw text inside `[[...]]` into target + display.
 *
 *  - `[[foo|Bar Baz]]` → `{ target: "foo", display: "Bar Baz" }`
 *  - `[[foo]]`         → `{ target: "foo", display: "foo" }`
 *  - `[[|empty target]]` → `{ target: "", display: "empty target" }`
 *    (caller decides whether an empty target is meaningful;
 *    typically lint flags it, renderer shows the display text raw)
 *  - `[[foo|]]`        → `{ target: "foo", display: "" }`
 *    (same — caller decides)
 *
 *  Whitespace around the pipe is preserved on the display side
 *  (so the user can write `[[foo| ある記事 ]]` and get the
 *  spacing intentionally) but TRIMMED on the target side, since
 *  a slug-comparable target with leading/trailing whitespace is
 *  always a typo.
 *
 *  Only the FIRST pipe splits. `[[a|b|c]]` becomes
 *  `{ target: "a", display: "b|c" }` so display strings can
 *  legitimately contain a literal `|`. */
export function parseWikiLink(inner: string): WikiLink {
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx === -1) {
    return { target: inner, display: inner };
  }
  const target = inner.slice(0, pipeIdx).trim();
  const display = inner.slice(pipeIdx + 1);
  return { target, display };
}
