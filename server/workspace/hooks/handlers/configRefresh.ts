// Config-refresh handler — fires after Write/Edit on files that
// drive workspace state the parent server hot-reloads:
//
//   <ws>/.claude/skills/<slug>/SKILL.md   (manual edits to canonical skills)
//   <ws>/config/scheduler/tasks.json      (user-task scheduler config)
//
// POSTs /api/config/refresh so the change activates without a server
// restart. Migrated from `server/workspace/config-refresh/hook.mjs`.
//
// NOTE on staging skills (`data/skills/<slug>/SKILL.md`):
// The staging path is INTENTIONALLY excluded from PATTERNS here.
// Refreshing on the staging write would race with `skillBridge`'s
// mirror copy — `/api/config/refresh` could land before the canonical
// file is written, leaving a fresh skill unregistered until the next
// restart. `skillBridge` owns its own refresh trigger and fires it
// AFTER the mirror succeeds, so the ordering is deterministic.

import { buildAuthPost, safePost } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractFilePath, extractToolName } from "../shared/stdin.js";

// Each pattern is matched against the absolute path the CLI
// delivered. Windows path separators are tolerated for cross-
// platform robustness even though the host is currently darwin /
// linux only.
const PATTERNS = [/[\\/]\.claude[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/, /[\\/]config[\\/]scheduler[\\/]tasks\.json$/];

export async function handleConfigRefresh(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  if (tool !== "Write" && tool !== "Edit") return;

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  if (!PATTERNS.some((pattern) => pattern.test(filePath))) return;

  const req = buildAuthPost("/api/config/refresh");
  await safePost(req);
}
