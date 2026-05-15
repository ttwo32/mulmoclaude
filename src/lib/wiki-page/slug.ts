// Pure wiki-page slug helpers — string-only, no Node / browser
// dependencies, importable from any bundle.
//
// Used by:
//   - server/workspace/wiki-pages/io.ts (the write chokepoint)
//   - server/workspace/hooks/handlers/wikiSnapshot.ts (the
//     PostToolUse handler that fires on Write/Edit of a wiki page)
//   - server/api/routes/wiki.ts (page resolver + lint)
//   - server/api/routes/wiki/history.ts (history slug guard)
//   - src/plugins/wiki/route.ts (router slug guard — replaces the
//     local `isSafeWikiSlug` duplicate that existed before the
//     pure-lib refactor)
//   - src/plugins/wiki/helpers.ts (renderer slugify for [[…]] links)
//
// Any helper that needs `node:path` lives in `./paths.ts` so that
// importing this file from frontend code never pulls in Node
// builtins.

/** Reject slugs that would escape `data/wiki/pages/` once
 *  joined back into a path, or that are otherwise invalid as
 *  page filenames. The chokepoint must defend itself even when
 *  callers derive the slug from a trusted source — a typo or
 *  future caller mistake should fail loud, not silently write
 *  outside the wiki tree.
 *
 *  The rule is intentionally narrow — separators / `..` / NUL /
 *  empty — so it only rejects unambiguous violations. Aesthetic
 *  concerns (e.g. dot-prefixed filenames) are out of scope: a
 *  pre-existing `data/wiki/pages/.foo.md` should remain writable
 *  through the chokepoint (codex review iter-2 #883). */
export function isSafeSlug(slug: string): boolean {
  if (slug.length === 0) return false;
  if (slug === "." || slug === "..") return false;
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  return true;
}

/** Slug rules for `[[wiki link]]` text → slug derivation:
 *  lowercase, spaces collapsed to hyphens, every non-ASCII /
 *  non-alphanumeric / non-hyphen character stripped.
 *
 *  Pure: no normalisation, no transliteration — this is the
 *  same shape the index parser, page resolver, and frontend
 *  renderer all need to agree on. Non-ASCII titles (e.g.
 *  Japanese) collapse to an empty string here; callers fall back
 *  to other strategies (title-match in the index, or the agent
 *  pre-resolving to a slug-form target via `[[slug|display]]`). */
export function wikiSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
