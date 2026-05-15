// Wiki page snapshot handler — fires after Write/Edit on a wiki
// page so the snapshot pipeline (#763 PR 2) records the new state.
//
// Migrated from `server/workspace/wiki-history/hook/snapshot.ts`.
// Same behaviour, now part of the unified dispatcher so settings.json
// carries a single PostToolUse entry instead of one per hook source.

import path from "node:path";
import { wikiSlugFromAbsPath } from "../../../../src/lib/wiki-page/paths.js";
import { buildAuthPost, safePost } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractFilePath, extractSessionId, extractToolName } from "../shared/stdin.js";
import { workspaceRoot } from "../shared/workspace.js";

const WIKI_PAGES_REL = path.join("data", "wiki", "pages");

export async function handleWikiSnapshot(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  // Wiki pages are written via Write or Edit — Bash rm or shell
  // mutations don't go through the snapshot pipeline (the wiki
  // route does that explicitly server-side when needed).
  if (tool !== "Write" && tool !== "Edit") return;

  const filePath = extractFilePath(payload);
  if (!filePath) return;

  const wikiPagesDir = path.join(workspaceRoot(), WIKI_PAGES_REL);
  const slug = wikiSlugFromAbsPath(filePath, wikiPagesDir);
  if (slug === null) return;

  // Prefer the parent server's chatSessionId (#963) — the server's
  // session store keys by chatSessionId, not Claude CLI's internal
  // session_id, so the toolResult publish on the server side only
  // matches when we forward our own id. Fall back to Claude CLI's
  // session_id when the env var is absent.
  const envChatSessionId = process.env.MULMOCLAUDE_CHAT_SESSION_ID;
  const payloadSessionId = extractSessionId(payload);
  const sessionId = envChatSessionId && envChatSessionId.length > 0 ? envChatSessionId : payloadSessionId;
  const body = sessionId === undefined ? { slug } : { slug, sessionId };

  const req = buildAuthPost("/api/wiki/internal/snapshot", body);
  await safePost(req);
}
