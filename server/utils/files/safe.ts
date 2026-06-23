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

// Write-time sibling of `resolveWithinRoot`. `resolveWithinRoot`
// runs `realpathSync` on the full path which throws `ENOENT` for a
// leaf that does not exist yet — fine for reads, but the swallowed
// ENOENT is indistinguishable from a traversal escape, so callers
// pre-validating a not-yet-written path get a false "rejected".
//
// This variant string-validates `relPath` first, mkdir-p's the
// parent inside `rootReal`, then realpath-checks the parent (the
// existing dir) instead of the leaf. Returns the absolute write
// path or null on any unsafe input. Caller still does the actual
// write (typically `writeFileAtomic`).
export async function resolveWriteWithinRoot(rootReal: string, relPath: string): Promise<string | null> {
  if (!relPath || relPath.includes("\0") || path.isAbsolute(relPath)) return null;
  const segments = relPath.split(/[/\\]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const leaf = segments[segments.length - 1];
  const parentRel = segments.slice(0, -1).join(path.sep);
  const parentAbs = path.resolve(rootReal, parentRel);
  try {
    await promises.mkdir(parentAbs, { recursive: true });
  } catch {
    return null;
  }
  let parentReal: string;
  try {
    parentReal = await promises.realpath(parentAbs);
  } catch {
    return null;
  }
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) return null;
  return path.join(parentReal, leaf);
}
