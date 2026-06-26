// Domain IO for `config/dashboard.json` — the dashboard layout (per-tile
// view mode + tile order for the favorites grid). Follows the `*-io.ts`
// pattern: all writes go through `writeFileAtomic`; a missing file reads
// as `[]`.

import path from "node:path";
import { WORKSPACE_FILES, workspacePath } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { readTextSafe } from "./safe.js";
import type { DashboardTile, DashboardFile } from "../../../src/types/dashboard.js";

function dashboardFilePath(workspaceRoot?: string): string {
  return path.join(workspaceRoot ?? workspacePath, WORKSPACE_FILES.dashboard);
}

/** Coerce arbitrary JSON into a clean `DashboardTile[]`: drop malformed
 *  entries (empty slug / non-string fields), keep `viewMode` only when a
 *  non-empty string, and dedupe on `slug` keeping the first occurrence.
 *  Exported for the route validator and unit tests — pure, no IO. */
export function normalizeDashboard(input: unknown): DashboardTile[] {
  if (!Array.isArray(input)) return [];
  const out: DashboardTile[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Record<string, unknown>;
    const { slug, viewMode } = candidate;
    if (typeof slug !== "string" || slug.length === 0) continue;
    if (out.some((existing) => existing.slug === slug)) continue;
    const tile: DashboardTile = { slug };
    if (typeof viewMode === "string" && viewMode.length > 0) tile.viewMode = viewMode;
    out.push(tile);
  }
  return out;
}

/** Read the dashboard tiles. Missing / unreadable / malformed file
 *  → `[]` (never throws on absent state). */
export async function readDashboard(workspaceRoot?: string): Promise<DashboardTile[]> {
  const text = await readTextSafe(dashboardFilePath(workspaceRoot));
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text) as Partial<DashboardFile>;
    return normalizeDashboard(parsed?.tiles);
  } catch {
    return [];
  }
}

/** Replace the full tile list. Normalises (validate + dedupe) before
 *  writing so the on-disk file is always clean. Returns the written list
 *  so callers can echo the canonical result. */
export async function writeDashboard(tiles: unknown, workspaceRoot?: string): Promise<DashboardTile[]> {
  const clean = normalizeDashboard(tiles);
  const payload: DashboardFile = { tiles: clean };
  await writeFileAtomic(dashboardFilePath(workspaceRoot), `${JSON.stringify(payload, null, 2)}\n`);
  return clean;
}
