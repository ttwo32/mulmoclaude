// Shared factory for the `is{Domain}Path(value)` validators each file
// store carries (attachment, image, markdown, html, spreadsheet, svg).
// Each store used to roll its own validator with two diverging
// traversal-check strategies — `hasTraversalSegment` in
// attachment/image, `path.posix.normalize !== value` + `.includes("..")`
// in the other four. Both are individually sound; having two for the
// same intent is the smell (#1761).
//
// `makePathValidator` applies BOTH defenses:
//
//   1. Prefix gate — value must start with `dirPrefix + "/"`.
//   2. Optional extension gate — value must end with the configured
//      extension if one is given (attachments omit it because they
//      cover many MIME types).
//   3. Canonical-form gate — `path.posix.normalize(value) === value`
//      (rejects empty / `.` / non-canonical segments).
//   4. Traversal gate — `hasTraversalSegment(value)` (defense-in-depth
//      against `..` / `.` that survived a malformed normalize).

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
    if (hasTraversalSegment(value)) return false;
    return true;
  };
}
