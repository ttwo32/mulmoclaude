// Node-only wiki-page helpers — anything that needs `node:path`
// lives here so the rest of `src/lib/wiki-page/` stays pure
// (string-only, importable from both browser and Node bundles).
// Frontend code MUST NOT import this file directly; use the pure
// modules instead.

import path from "node:path";
import { isSafeSlug } from "./slug.js";

/** Given an absolute path and the absolute `pagesDir`, return the
 *  slug if `absPath` is a direct `.md` child of `pagesDir`, else
 *  null. Pure path-string math — no fs IO, no symlink resolution.
 *
 *  Caller responsibility: pass already-realpath'd values for both
 *  arguments. Mixing a realpath'd `absPath` with a symlinked
 *  `pagesDir` (or vice versa) silently mismatches because
 *  `path.relative` is plain string arithmetic. The trap caused
 *  #883 review-iter-1 — a symlinked workspace silently routed
 *  wiki writes through the generic writer. */
export function wikiSlugFromAbsPath(absPath: string, pagesDir: string): string | null {
  const rel = path.relative(pagesDir, absPath);
  if (rel.length === 0) return null;
  if (path.isAbsolute(rel)) return null;
  // Direct child only — no nested layout today. Any separator
  // means the path either escapes (`../secret.md`) or descends
  // (`subdir/foo.md`). A literal page name like `..foo.md` is a
  // single segment without a separator and is allowed (codex
  // iter-3 #883 — the prior `startsWith("..")` rule wrongly
  // rejected it).
  if (rel.includes(path.sep)) return null;
  if (!rel.endsWith(".md")) return null;
  const slug = rel.slice(0, -".md".length);
  if (!isSafeSlug(slug)) return null;
  return slug;
}
