// Resolution helpers for the Claude Code CLI's on-disk config locations.
//
// Why this exists: six call sites used to hardcode `homedir() + ".claude"` and
// `homedir() + ".claude.json"` — the sandbox pre-flight (`docker.ts`), the Docker
// bind mounts (`config.ts`), the credentials-present probe (`index.ts`), and a
// couple of related lookups (`credentials.ts`, `skills/paths.ts`). That works
// today on every platform Claude Code ships on (POSIX + Windows both use
// `homedir()` as the anchor), but it leaves no escape hatch when:
//
//   - A user's Windows install is redirected (corporate `%USERPROFILE%` policy)
//   - Anthropic moves the location in a future Claude Code release
//   - Someone wants to test against a sandboxed Claude config without touching
//     their real `~/.claude/`
//
// `CLAUDE_CONFIG_DIR` / `CLAUDE_CONFIG_JSON` env overrides are the documented
// escape hatch. Default behaviour is unchanged.
//
// Tracking: issue #87 §2 — Windows Claude CLI config location.

import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "../system/env.js";

/** Absolute path to the user's Claude Code config directory.
 *
 *  Default: `<home>/.claude` (where `home` defaults to `os.homedir()`).
 *  Override with `CLAUDE_CONFIG_DIR` env var. The `home` parameter exists
 *  for tests that thread a fake home through callers like
 *  `buildDockerSpawnArgs`; production passes nothing and gets `homedir()`. */
export function claudeConfigDir(home?: string): string {
  return env.claudeConfigDir ?? join(home ?? homedir(), ".claude");
}

/** Absolute path to the user's top-level Claude Code JSON config file.
 *
 *  Default: `<home>/.claude.json`. Override with `CLAUDE_CONFIG_JSON`. */
export function claudeConfigJson(home?: string): string {
  return env.claudeConfigJson ?? join(home ?? homedir(), ".claude.json");
}

/** Absolute path to the user's Claude Code credentials file
 *  (`<claudeConfigDir>/.credentials.json`). */
export function claudeCredentialsPath(home?: string): string {
  return join(claudeConfigDir(home), ".credentials.json");
}

/** Absolute path to the user's Claude Code skills directory
 *  (`<claudeConfigDir>/skills`). */
export function claudeSkillsDir(home?: string): string {
  return join(claudeConfigDir(home), "skills");
}
