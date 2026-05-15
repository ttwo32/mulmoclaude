// One-shot migration: move recipe files from the runtime plugin's
// `files.data` scope (`<ws>/data/plugins/%40mulmoclaude%2Frecipe-book-plugin/recipes/*.md`)
// to the clean canonical path (`<ws>/data/cooking/recipes/*.md`).
// Runs at server startup; idempotent via a sentinel file at the
// destination root (`.migration-from-plugin-done`).
//
// Source files are COPIED, not moved, so a partial run doesn't lose
// data. The sentinel is written ONLY after every source file landed
// at the destination — a crashed migration leaves the source intact
// and the next boot re-attempts.
//
// CLEANUP target: after every active workspace has migrated and the
// `recipe-book-plugin` package itself is deleted, this helper +
// sentinel can be removed in one sweep. The plugin source presently
// stays in `packages/plugins/` (per #1286 user constraint) so the
// migration helper stays for any old workspace that flips the plugin
// back on then off again.

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_PATHS } from "../paths.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";

const LEGACY_PLUGIN_SEG = "%40mulmoclaude%2Frecipe-book-plugin";
const LEGACY_RECIPES_SUBDIR = "recipes";
const SENTINEL_FILENAME = ".migration-from-plugin-done";

export interface CookingRecipesMigrationOptions {
  /** Workspace data root override for tests. Defaults to
   *  `WORKSPACE_PATHS.pluginsData` for the source side and
   *  `WORKSPACE_PATHS.cookingRecipes` for the destination. */
  pluginsDataRoot?: string;
  cookingRecipesRoot?: string;
}

interface MigrationResult {
  copied: number;
  skipped: number;
  /** Number of `.md` source files whose copy threw an I/O error.
   *  When non-zero the sentinel is NOT written, so the next boot
   *  retries — transient failures don't become permanent. */
  copyFailures: number;
  alreadyDone: boolean;
}

/** Best-effort migration. Logs at info on success, warn on failures
 *  per-file; never throws — boot continues regardless. */
export async function migrateCookingRecipesFromPlugin(opts: CookingRecipesMigrationOptions = {}): Promise<MigrationResult> {
  const pluginsData = opts.pluginsDataRoot ?? WORKSPACE_PATHS.pluginsData;
  const cookingRecipes = opts.cookingRecipesRoot ?? WORKSPACE_PATHS.cookingRecipes;
  const legacyDir = path.join(pluginsData, LEGACY_PLUGIN_SEG, LEGACY_RECIPES_SUBDIR);
  const sentinelPath = path.join(cookingRecipes, SENTINEL_FILENAME);

  if (existsSync(sentinelPath)) {
    return { copied: 0, skipped: 0, copyFailures: 0, alreadyDone: true };
  }
  if (!existsSync(legacyDir)) {
    // No plugin storage to migrate from. Drop the sentinel so we
    // don't re-stat the source dir on every future boot.
    await mkdir(cookingRecipes, { recursive: true });
    await writeFile(sentinelPath, sentinelBody("no legacy source found"), "utf-8");
    return { copied: 0, skipped: 0, copyFailures: 0, alreadyDone: false };
  }

  await mkdir(cookingRecipes, { recursive: true });
  const entries = await readdir(legacyDir);
  let copied = 0;
  let skipped = 0;
  let copyFailures = 0;
  for (const name of entries) {
    if (!name.endsWith(".md")) {
      skipped += 1;
      continue;
    }
    const src = path.join(legacyDir, name);
    const dst = path.join(cookingRecipes, name);
    if (existsSync(dst)) {
      // Don't overwrite a file the user may have hand-edited at the
      // new location. Skip + log + carry on — this is an intentional
      // skip, not a failure, so it doesn't block the sentinel.
      log.warn("cooking-recipes", "migration: destination already exists, skipping", { name });
      skipped += 1;
      continue;
    }
    try {
      await copyFile(src, dst);
      copied += 1;
    } catch (err) {
      // Transient I/O failures (disk full, EBUSY, permissions) MUST NOT
      // mark migration as done — Codex review on PR #1287. Track
      // separately from intentional skips so the sentinel-gate below
      // can decide. Next boot retries the source files we missed.
      log.warn("cooking-recipes", "migration: copy failed (will retry next boot)", { name, error: errorMessage(err) });
      copyFailures += 1;
    }
  }

  if (copyFailures > 0) {
    log.warn("cooking-recipes", "migration: not marking complete — copy failures present", { copied, skipped, copyFailures });
    return { copied, skipped, copyFailures, alreadyDone: false };
  }

  await writeFile(sentinelPath, sentinelBody(`copied=${copied} skipped=${skipped}`), "utf-8");
  if (copied > 0) {
    log.info("cooking-recipes", "migration from recipe-book-plugin complete", { copied, skipped, legacyDir, cookingRecipes });
  }
  return { copied, skipped, copyFailures: 0, alreadyDone: false };
}

function sentinelBody(detail: string): string {
  return [
    "# Migration sentinel — recipe-book-plugin → data/cooking/recipes/ (#1286)",
    "",
    `# Run at: ${new Date().toISOString()}`,
    `# Result: ${detail}`,
    "",
    "# The presence of this file marks the legacy-plugin migration as done.",
    "# Delete it to force a re-run on next server boot (use with care: the",
    "# migration is non-overwriting, so re-running on a workspace that has",
    "# diverged from the legacy snapshot won't silently clobber hand-edits).",
    "",
  ].join("\n");
}
