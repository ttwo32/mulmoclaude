// Shared factory for the `is{Domain}Path(value)` validators each file
// store carries (attachment, image, markdown, html, spreadsheet, svg).
// Each store used to roll its own validator with two diverging
// traversal-check strategies — `hasTraversalSegment` in
// attachment/image, `path.posix.normalize !== value` + `.includes("..")`
// in the other four. Both are individually sound; having two for the
// same intent is the smell (#1761).
//
// `makePathValidator` applies all five defenses:
//
//   1. Prefix gate — value must start with `dirPrefix + "/"`.
//   2. Optional extension gate — value must end with the configured
//      extension if one is given (attachments omit it because they
//      cover many MIME types).
//   3. Canonical-form gate — `path.posix.normalize(value) === value`
//      (rejects empty / `.` / non-canonical segments).
//   4. No `..` substring anywhere — even inside a single segment
//      (`foo..md`, `v1..2.json`). The pre-refactor markdown / html /
//      spreadsheet / svg validators had this guard; it was lost when
//      the factory only inherited `hasTraversalSegment` (which checks
//      segments-equal-`..` only). Re-added so legitimate filenames in
//      our domain (server-generated shortIds + standard extensions)
//      stay accepted while pathological `..`-bearing names are not.
//      See #1764.
//   5. Traversal gate — `hasTraversalSegment(value)` (defense-in-depth
//      against literal `.` / `..` segments).

import path from "path";
import { hasTraversalSegment } from "./safe.js";

export interface PathValidatorOptions {
  /** Workspace-relative directory prefix (e.g. `WORKSPACE_DIRS.attachments`). */
  prefix: string;
  /** Required extension including the leading dot (e.g. `.png`).
   *  Omit to accept any extension. */
  ext?: string;
}

export function makePathValidator({ prefix, ext }: PathValidatorOptions): (value: string) => boolean {
  const prefixWithSlash = `${prefix}/`;
  return (value: string): boolean => {
    if (!value.startsWith(prefixWithSlash)) return false;
    if (ext && !value.endsWith(ext)) return false;
    if (path.posix.normalize(value) !== value) return false;
    if (value.includes("..")) return false;
    if (hasTraversalSegment(value)) return false;
    return true;
  };
}
