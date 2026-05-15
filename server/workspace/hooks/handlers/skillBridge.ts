// Skill-bridge handler — agent writes skill drafts to
// `data/skills/<slug>/SKILL.md` (a plain data dir, no permission
// special case) and this hook mirrors them into
// `.claude/skills/<slug>/SKILL.md` so Claude CLI's skill discovery
// picks them up.
//
// Why a bridge: Claude Code's permission system gives `.claude/`
// stricter scrutiny than ordinary cwd subdirs (the dir holds the
// agent's own skills / hooks / settings, so writes there are a
// self-modification risk). Even with explicit `Write(.claude/**)`
// allow rules in workspace settings.json, writes prompt — and the
// host GUI has no surface to answer the prompt. Routing writes
// through `data/skills/` avoids the gate; this hook (a regular
// subprocess, NOT a Claude tool call) does the mirror copy and is
// not subject to the gate.
//
// Why mirror as `<slug>/SKILL.md` (not flat `<slug>.md`): Claude
// CLI's canonical skill layout IS the nested form, and the agent
// naturally writes that shape. A flat staging path forced the agent
// to reason against its own training, missed the regex, and the
// mirror silently never fired. Mirroring 1:1 keeps the path math
// trivial for both sides.
//
// Mirror operations:
//
//   Write/Edit data/skills/<slug>/SKILL.md
//     → copy content to .claude/skills/<slug>/SKILL.md
//       (creates the parent dir on first install)
//
//   Bash "rm -rf data/skills/<slug>/" or "rm -rf data/skills/<slug>"
//     → rm -rf .claude/skills/<slug>/
//       (regex-matched so the agent's intent is unambiguous;
//        a bulk `rm -rf data/skills/` or wildcards are intentionally
//        NOT mirrored to avoid mass deletion surprises)

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAuthPost, safePost, serverLog } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractCommand, extractFilePath, extractToolName } from "../shared/stdin.js";
import { workspaceRoot } from "../shared/workspace.js";
import { errorMessage } from "../../../utils/errors.js";

const DATA_SKILLS_DIR = path.join("data", "skills");
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");
const SKILL_FILENAME = "SKILL.md";

// Slugs follow Claude Code's skill-name convention: lowercase ASCII
// letters / digits with single-hyphen separators. Matching is
// strict so a typo or path traversal attempt (`../foo`) never
// reaches the destination path math.
//
// eslint-disable-next-line security/detect-unsafe-regex -- input is always a basename slice ≤ 64 chars, so the theoretical worst-case backtracking is bounded; this is the canonical kebab-case pattern used across the skill toolchain.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// `rm -rf data/skills/<slug>` regex. Captures the flag run as
// `match[1]` so the caller can post-validate that the user passed
// a recursive flag (`-r`, `-R`, `-rf`, `-fr`, …). Tolerates optional
// trailing slash and optional quoting around the path. A literal
// `rm -rf data/skills` (the parent dir itself) or paths with
// wildcards / shell expansion are intentionally NOT matched.
//
// Recursive-flag enforcement (Codex review on this PR): plain `rm`
// or `rm -f` cannot remove a directory, so the staging delete fails
// silently while the canonical delete still runs — desyncing the
// two trees. Requiring at least one `r` / `R` in the flags rejects
// those forms outright.
//
// eslint-disable-next-line security/detect-unsafe-regex -- the `(-[a-z0-9]+)*` slug clause is bounded by the path tail and the input is a single-line Bash command Claude CLI captured; no pathological backtracking surface.
const RM_RE = /^\s*rm\s+((?:-[a-zA-Z]+\s+)+)['"]?data\/skills\/([a-z0-9-]+)\/?['"]?\s*$/;
const RECURSIVE_FLAG_RE = /[rR]/;

// Pure helpers exported for unit testing. Source paths stay relative
// to the workspace root resolved at call time so the handler is
// safe to run from any cwd.

export function dataSkillDir(slug: string): string {
  return path.join(workspaceRoot(), DATA_SKILLS_DIR, slug);
}

export function dataSkillFilePath(slug: string): string {
  return path.join(dataSkillDir(slug), SKILL_FILENAME);
}

export function claudeSkillDir(slug: string): string {
  return path.join(workspaceRoot(), CLAUDE_SKILLS_DIR, slug);
}

export function claudeSkillFilePath(slug: string): string {
  return path.join(claudeSkillDir(slug), SKILL_FILENAME);
}

// Extract the slug from a Write/Edit on a
// `data/skills/<slug>/SKILL.md` path. Returns null when:
//   - the path doesn't sit directly under data/skills/<slug>/
//   - the filename isn't SKILL.md
//   - the slug isn't a valid kebab-case identifier
//
// Sibling files in the same dir (e.g. data/skills/<slug>/README.md
// or data/skills/<slug>/assets/foo.png) are intentionally NOT
// bridged — only the canonical SKILL.md crosses over. Skill authors
// can keep extra material staging-side until they decide what
// belongs in the bundle.
export function slugFromDataPath(filePath: string): string | null {
  const root = workspaceRoot();
  const staging = path.join(root, DATA_SKILLS_DIR);
  const rel = path.relative(staging, filePath);
  if (!rel || rel.startsWith("..")) return null;
  // Expect exactly `<slug>/SKILL.md` — two segments deep.
  const segments = rel.split(path.sep);
  if (segments.length !== 2) return null;
  const [slug, basename] = segments;
  if (basename !== SKILL_FILENAME) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

// Extract the slug from a Bash `rm -rf data/skills/<slug>/` command.
// Returns null on any mismatch — wildcards, paths outside the
// staging dir, or non-recursive `rm` / `rm -f` (which can't delete
// the staging dir anyway, so mirroring would desync) are all
// intentionally rejected.
export function slugFromRmCommand(command: string): string | null {
  const match = RM_RE.exec(command);
  if (!match) return null;
  const [, flags, slug] = match;
  if (!RECURSIVE_FLAG_RE.test(flags)) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

// Atomic mirror: write to a tmp file in the destination dir, then
// rename onto the canonical path. `fs.renameSync` is atomic on POSIX
// when source + destination share a filesystem (always true here —
// both are inside `.claude/skills/<slug>/`). If the hook is killed
// mid-write, the half-written tmp file is left behind (harmless,
// never read) and SKILL.md still has its previous contents — Claude
// CLI's skill discovery never sees a torn file. CodeRabbit review
// on PR #1298.
function mirrorWrite(slug: string): void {
  const content = readFileSync(dataSkillFilePath(slug), "utf-8");
  const destDir = claudeSkillDir(slug);
  mkdirSync(destDir, { recursive: true });
  const dest = claudeSkillFilePath(slug);
  const tmp = path.join(destDir, `.SKILL.md.${process.pid}.tmp`);
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, dest);
}

function mirrorDelete(slug: string): void {
  rmSync(claudeSkillDir(slug), { recursive: true, force: true });
}

// `configRefresh` used to fan this out for us as a sibling handler,
// but running it in parallel with the mirror race'd: the
// `/api/config/refresh` POST could land before the canonical
// `.claude/skills/<slug>/SKILL.md` existed on disk, leaving a fresh
// skill unregistered until the next restart. `skillBridge` now
// fires the refresh itself, ALWAYS after a successful mirror (or
// delete), so ordering is deterministic (Codex review on this PR).
async function refreshConfig(): Promise<void> {
  await safePost(buildAuthPost("/api/config/refresh"));
}

async function handleWriteOrEdit(payload: HookPayload): Promise<void> {
  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const slug = slugFromDataPath(filePath);
  if (slug === null) return;
  try {
    mirrorWrite(slug);
    // Order matters: mirror must complete before refresh so the
    // server's skill scan sees the new SKILL.md. See refreshConfig
    // comment for the race history.
    await refreshConfig();
    // Server-side log line so the user can see from
    // `server-<date>.log` that the hook fired and what it did.
    // Without this the mirror is invisible — a successful copy
    // and "the hook never ran" look identical from the chat UI.
    await serverLog("skill-bridge", `mirrored ${dataSkillFilePath(slug)} → ${claudeSkillFilePath(slug)}`, { data: { slug, op: "write" } });
  } catch (err) {
    // The Write itself succeeded; a failed mirror would leave the
    // staging copy in place. Surface the failure to server logs
    // (so the user has a chance to react) but never throw — the
    // user's tool turn must stay clean.
    await serverLog("skill-bridge", `mirror write failed for slug=${slug}`, {
      level: "error",
      data: { slug, error: errorMessage(err) },
    });
  }
}

async function handleBash(payload: HookPayload): Promise<void> {
  const command = extractCommand(payload);
  if (!command) return;
  const slug = slugFromRmCommand(command);
  if (slug === null) return;
  try {
    mirrorDelete(slug);
    // Same ordering invariant as handleWriteOrEdit — refresh must
    // run after the canonical dir is gone so the server's rescan
    // deregisters the deleted skill.
    await refreshConfig();
    await serverLog("skill-bridge", `removed ${claudeSkillDir(slug)}`, { data: { slug, op: "delete" } });
  } catch (err) {
    // Same silent-fail discipline — a missed delete leaves an
    // orphan in `.claude/skills/` that the user can clean up
    // manually, which is better than aborting the tool turn.
    await serverLog("skill-bridge", `mirror delete failed for slug=${slug}`, {
      level: "error",
      data: { slug, error: errorMessage(err) },
    });
  }
}

export async function handleSkillBridge(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  if (tool === "Write" || tool === "Edit") {
    await handleWriteOrEdit(payload);
    return;
  }
  if (tool === "Bash") {
    await handleBash(payload);
  }
}
