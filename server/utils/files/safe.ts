// Wrappers that swallow ENOENT/EACCES so callers branch on `result === null` instead of try/catch.
// resolveWithinRoot is the realpath-based traversal check used by every endpoint serving workspace files.

import { Dirent, Stats, promises, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { isErrorWithCode } from "../types.js";

export function isEnoent(err: unknown): boolean {
  return isErrorWithCode(err) && err.code === "ENOENT";
}

export function readBinarySafeSync(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

export async function readTextSafe(absPath: string): Promise<string | null> {
  try {
    return await promises.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

export function readTextSafeSync(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

export function statSafe(absPath: string): Stats | null {
  try {
    return statSync(absPath);
  } catch {
    return null;
  }
}

export async function statSafeAsync(absPath: string): Promise<Stats | null> {
  try {
    return await promises.stat(absPath);
  } catch {
    return null;
  }
}

export function readDirSafe(absPath: string): Dirent[] {
  try {
    return readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readDirSafeAsync(absPath: string): Promise<Dirent[]> {
  try {
    return await promises.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await promises.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

// True if any segment of `relPath` (split on either `/` or `\`)
// starts with a dot — the same policy `express.static({ dotfiles:
// "deny" })` applies. Splits on both separators because
// `decodeURIComponent` of `%5C` produces a literal `\`, and on
// Windows `path.normalize` (used downstream by `resolveWithinRoot`)
// treats `\` as a separator. Without the dual split, a request like
// `/dir%5C.hidden.html` decodes to `dir\.hidden.html` → splits on
// `/` as one segment `dir\.hidden.html` (no leading dot) → bypasses
// the guard on Windows even though `path.normalize` later resolves
// it to `dir/.hidden.html`. (Codex review on PR #1082.)
export function containsDotfileSegment(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((segment) => segment.startsWith("."));
}

// `rootReal` MUST already be a realpath. Returns null on traversal or if either path doesn't exist on disk.
export function resolveWithinRoot(rootReal: string, relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(rootReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = realpathSync(resolved);
  } catch {
    return null;
  }
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(rootReal + path.sep)) {
    return null;
  }
  return resolvedReal;
}

// `C:foo`, `c:relative\path` — Windows drive-qualified RELATIVE paths.
// `path.isAbsolute` returns false (they're relative to the drive's CWD,
// not absolute), but `path.resolve(rootReal, "C:foo")` resolves onto
// drive C: instead of staying under `rootReal`. POSIX-only repros
// cannot trigger it, so it has to be caught at the string-validation
// stage explicitly.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

// Write-time sibling of `resolveWithinRoot`. `resolveWithinRoot`
// runs `realpathSync` on the full path which throws `ENOENT` for a
// leaf that does not exist yet — fine for reads, but the swallowed
// ENOENT is indistinguishable from a traversal escape, so callers
// pre-validating a not-yet-written path get a false "rejected".
//
// Algorithm:
//   1. String-validate `relPath` (NUL / absolute / Windows drive
//      relative / empty / "."/"..").
//   2. Walk the parent's ancestors from `rootReal` downward; at every
//      already-existing ancestor, realpath it and confirm it is still
//      inside `rootReal`. Reject as soon as an ancestor escapes —
//      BEFORE `mkdir -p` creates any directory, so a symlinked
//      intermediate component cannot cause writes outside root.
//   3. `mkdir -p` the parent (now provably safe — the unbuilt portion
//      sits under a confirmed-in-root ancestor).
//   4. Realpath the parent one more time as a defense-in-depth check.
//
// Returns `null` ONLY when the input itself is unsafe (string
// validation failed or a verified ancestor escapes root). Filesystem
// errors that are NOT security-related (`EACCES`, `EROFS`, …) are
// propagated so the caller sees the real failure mode instead of a
// misleading "path traversal rejected".
export async function resolveWriteWithinRoot(rootReal: string, relPath: string): Promise<string | null> {
  if (!relPath || relPath.includes("\0") || path.isAbsolute(relPath) || WINDOWS_DRIVE_RE.test(relPath)) return null;
  const segments = relPath.split(/[/\\]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const leaf = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parentAbs = path.resolve(rootReal, parentSegments.join(path.sep));

  // Walk root → parent, realpath-checking every existing ancestor.
  // The first ancestor that does not exist marks the "all directories
  // below this point will be created by us under verified-in-root
  // soil" boundary.
  let cursor = rootReal;
  for (const segment of parentSegments) {
    cursor = path.join(cursor, segment);
    let cursorReal: string;
    try {
      cursorReal = await promises.realpath(cursor);
    } catch (err) {
      if (isEnoent(err)) break;
      throw err;
    }
    if (cursorReal !== rootReal && !cursorReal.startsWith(rootReal + path.sep)) return null;
    cursor = cursorReal;
  }

  await promises.mkdir(parentAbs, { recursive: true });

  const parentReal = await promises.realpath(parentAbs);
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) return null;
  return path.join(parentReal, leaf);
}
