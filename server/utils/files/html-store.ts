import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { makePathValidator } from "./path-validator.js";

// Strict — overwriteHtml's path.join doesn't normalize traversal, so this gate is the primary defence.
export const isHtmlPath = makePathValidator({ prefix: WORKSPACE_DIRS.htmls, ext: ".html" });

// Defense in depth (matches `overwriteSvg`): if a caller forgets to
// pre-check via `isHtmlPath`, `path.join(workspacePath, relativePath)`
// would silently produce a traversal escape. The re-check inside the
// write closes that trust chain.
export async function overwriteHtml(relativePath: string, content: string): Promise<void> {
  if (!isHtmlPath(relativePath)) {
    throw new Error(`invalid html path: ${relativePath}`);
  }
  const absPath = path.join(workspacePath, relativePath);
  await writeFileAtomic(absPath, content);
}
