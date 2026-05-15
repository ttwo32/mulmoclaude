// Workspace root resolution for hook scripts.
//
// `CLAUDE_PROJECT_DIR` is set by Claude CLI to the workspace root
// the hook fired against — this is the value we trust at runtime.
// Falling back to `~/mulmoclaude` keeps the script robust when run
// outside CLI context (test harness, manual reproduction).

import { homedir } from "node:os";
import path from "node:path";

export function workspaceRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? path.join(homedir(), "mulmoclaude");
}
