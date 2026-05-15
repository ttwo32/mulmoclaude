// Unit tests for `migrateCookingRecipesFromPlugin` (#1286).
// Drives the migration against a tmpdir so it never touches the real
// workspace. Locks in: idempotent, non-overwriting, copy-not-move,
// empty-source still drops the sentinel, sentinel skip on second run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateCookingRecipesFromPlugin } from "../../../server/workspace/cooking-recipes/migrate.js";

const LEGACY_SUBPATH = path.join("%40mulmoclaude%2Frecipe-book-plugin", "recipes");
const SENTINEL = ".migration-from-plugin-done";

async function makeTmp(name: string): Promise<{ pluginsData: string; cookingRecipes: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), `cook-mig-${name}-`));
  const pluginsData = path.join(root, "data", "plugins");
  const cookingRecipes = path.join(root, "data", "cooking", "recipes");
  return {
    pluginsData,
    cookingRecipes,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function seedLegacy(pluginsData: string, files: Record<string, string>): Promise<string> {
  const legacy = path.join(pluginsData, LEGACY_SUBPATH);
  await mkdir(legacy, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(legacy, name), body, "utf-8");
  }
  return legacy;
}

describe("migrateCookingRecipesFromPlugin — happy path", () => {
  it("copies every .md from the legacy plugin dir to the canonical dir", async () => {
    const { pluginsData, cookingRecipes, cleanup } = await makeTmp("happy");
    await seedLegacy(pluginsData, {
      "stuffed-peppers.md": "---\ntitle: ピーマンの肉詰め\n---\n\nbody A\n",
      "lasagna.md": "---\ntitle: Lasagna\n---\n\nbody B\n",
      "not-a-recipe.txt": "should be skipped",
    });

    const result = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });

    assert.equal(result.copied, 2);
    assert.equal(result.skipped, 1, "the .txt file is skipped (not .md)");
    assert.equal(result.alreadyDone, false);

    const stuffed = await readFile(path.join(cookingRecipes, "stuffed-peppers.md"), "utf-8");
    assert.match(stuffed, /title: ピーマンの肉詰め/);
    const lasagna = await readFile(path.join(cookingRecipes, "lasagna.md"), "utf-8");
    assert.match(lasagna, /title: Lasagna/);

    // Legacy files are LEFT in place (copy, not move).
    const legacyFile = path.join(pluginsData, LEGACY_SUBPATH, "stuffed-peppers.md");
    assert.ok(existsSync(legacyFile), "legacy source preserved (copy semantics, not move)");

    // Sentinel dropped.
    assert.ok(existsSync(path.join(cookingRecipes, SENTINEL)));

    await cleanup();
  });
});

describe("migrateCookingRecipesFromPlugin — idempotent", () => {
  it("second run is a no-op when sentinel exists", async () => {
    const { pluginsData, cookingRecipes, cleanup } = await makeTmp("idem");
    await seedLegacy(pluginsData, { "foo.md": "first" });

    await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    // Modify the destination — second run must not clobber it.
    await writeFile(path.join(cookingRecipes, "foo.md"), "hand-edited", "utf-8");

    const second = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    assert.equal(second.alreadyDone, true);
    assert.equal(second.copied, 0);
    assert.equal(second.skipped, 0);

    const after = await readFile(path.join(cookingRecipes, "foo.md"), "utf-8");
    assert.equal(after, "hand-edited", "second run must NOT overwrite the destination");

    await cleanup();
  });
});

describe("migrateCookingRecipesFromPlugin — non-overwriting", () => {
  it("skips files when the destination already has the same name", async () => {
    const { pluginsData, cookingRecipes, cleanup } = await makeTmp("noover");
    await seedLegacy(pluginsData, { "foo.md": "legacy", "bar.md": "legacy" });
    // Pre-existing destination with a hand-edited foo.md.
    await mkdir(cookingRecipes, { recursive: true });
    await writeFile(path.join(cookingRecipes, "foo.md"), "hand-edited", "utf-8");

    const result = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });

    assert.equal(result.copied, 1, "only bar.md is copied; foo.md is preserved");
    assert.equal(result.skipped, 1);

    const foo = await readFile(path.join(cookingRecipes, "foo.md"), "utf-8");
    assert.equal(foo, "hand-edited", "existing foo.md NOT overwritten");
    const bar = await readFile(path.join(cookingRecipes, "bar.md"), "utf-8");
    assert.equal(bar, "legacy");

    await cleanup();
  });
});

describe("migrateCookingRecipesFromPlugin — empty source", () => {
  it("drops sentinel even when there's no legacy plugin dir", async () => {
    const { pluginsData, cookingRecipes, cleanup } = await makeTmp("empty");
    // No legacy directory at all.
    const result = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    assert.equal(result.copied, 0);
    assert.equal(result.alreadyDone, false);
    assert.ok(existsSync(path.join(cookingRecipes, SENTINEL)), "sentinel still dropped so future boots skip re-statting");

    const second = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    assert.equal(second.alreadyDone, true);

    await cleanup();
  });
});

describe("migrateCookingRecipesFromPlugin — partial failure must NOT mark done (Codex review on #1287)", () => {
  it("withholds sentinel when a copy fails so the next boot retries", async () => {
    const { pluginsData, cookingRecipes, cleanup } = await makeTmp("partial");
    // Source has a real file PLUS a name that points at a missing
    // file under the legacy dir — we simulate the I/O failure by
    // making the source unreadable.
    const legacy = await seedLegacy(pluginsData, { "good.md": "good", "bad.md": "to-be-unreadable" });
    // Drop read perms on bad.md so copyFile() throws (EACCES).
    // On systems that ignore mode bits (Windows / root) this won't
    // simulate failure — guard with an early skip.
    const { chmod } = await import("node:fs/promises");
    await chmod(path.join(legacy, "bad.md"), 0o000);

    let result;
    try {
      result = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    } finally {
      // Always restore perms so the tmpdir cleanup below can succeed.
      await chmod(path.join(legacy, "bad.md"), 0o644);
    }

    if (result.copyFailures === 0) {
      // The platform / user runs with root or chmod doesn't take —
      // can't exercise the failure path here. The assertion below
      // would be invalid; skip the rest of the check.
      await cleanup();
      return;
    }

    assert.equal(result.copied, 1, "the good file still gets copied");
    assert.equal(result.copyFailures, 1);
    assert.equal(result.alreadyDone, false);
    assert.ok(!existsSync(path.join(cookingRecipes, SENTINEL)), "sentinel MUST NOT be written when a copy failed — next boot retries");

    // Verify retry behaviour: subsequent run with permissions restored
    // copies the previously-failed file.
    const retry = await migrateCookingRecipesFromPlugin({ pluginsDataRoot: pluginsData, cookingRecipesRoot: cookingRecipes });
    assert.equal(retry.copied, 1, "retry picks up the file that failed last time");
    assert.equal(retry.copyFailures, 0);
    assert.ok(existsSync(path.join(cookingRecipes, SENTINEL)), "sentinel written once the retry succeeds");

    await cleanup();
  });
});
