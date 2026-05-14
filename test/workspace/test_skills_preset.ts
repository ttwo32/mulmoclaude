// Tests for the boot-time preset-skill sync.
//
// #1210 PR-A: introduced. Source: `server/workspace/skills-preset/`.
// Destination: originally `<workspaceRoot>/.claude/skills/`.
// #1335 PR-A: destination flipped to
// `<workspaceRoot>/data/skills/catalog/preset/` (catalog half of the
// catalog-vs-active split). The sync helper itself doesn't care
// about the literal path — it works against whatever `destDir` the
// caller passes — so these tests stay tmpdir-based.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { syncPresetSkills, isPresetSlug } from "../../server/workspace/skills-preset.js";

let workdir: string;
let sourceDir: string;
let destDir: string;

function writePresetSource(slug: string, body = `placeholder for ${slug}`): void {
  const slugDir = path.join(sourceDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(path.join(slugDir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\n${body}\n`);
}

function writeDestSkill(slug: string, body: string): void {
  const slugDir = path.join(destDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(path.join(slugDir, "SKILL.md"), body);
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "skills-preset-"));
  sourceDir = path.join(workdir, "source");
  destDir = path.join(workdir, "dest");
  mkdirSync(sourceDir);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("isPresetSlug", () => {
  it("accepts mc-* slugs", () => {
    assert.equal(isPresetSlug("mc-library"), true);
    assert.equal(isPresetSlug("mc-x"), true);
  });

  it("rejects non-prefixed slugs", () => {
    assert.equal(isPresetSlug("library"), false);
    assert.equal(isPresetSlug("manage-library"), false);
  });

  it("rejects bare prefix without a name", () => {
    assert.equal(isPresetSlug("mc-"), false);
  });

  it("rejects empty / unrelated", () => {
    assert.equal(isPresetSlug(""), false);
    assert.equal(isPresetSlug("MC-LIBRARY"), false);
  });
});

describe("syncPresetSkills — happy path", () => {
  it("copies a single mc-* preset into the destination", () => {
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.removed, []);
    const destFile = path.join(destDir, "mc-foo", "SKILL.md");
    assert.ok(existsSync(destFile));
    assert.match(readFileSync(destFile, "utf-8"), /placeholder for mc-foo/);
  });

  it("copies multiple presets in one pass", () => {
    writePresetSource("mc-a");
    writePresetSource("mc-b");
    writePresetSource("mc-c");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied.sort(), ["mc-a", "mc-b", "mc-c"]);
    for (const slug of ["mc-a", "mc-b", "mc-c"]) {
      assert.ok(existsSync(path.join(destDir, slug, "SKILL.md")));
    }
  });

  it("creates the destination dir when it does not exist yet", () => {
    writePresetSource("mc-foo");
    assert.equal(existsSync(destDir), false);
    syncPresetSkills({ sourceDir, destDir });
    assert.ok(existsSync(destDir));
  });

  it("returns an empty result when the source dir does not exist (no presets shipped yet)", () => {
    rmSync(sourceDir, { recursive: true });
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result, { copied: [], removed: [], skipped: [] });
  });
});

describe("syncPresetSkills — overwrite policy", () => {
  it("refreshes a preset whose dest content was modified", () => {
    writePresetSource("mc-foo", "fresh content");
    writeDestSkill("mc-foo", "stale content from a previous boot");
    syncPresetSkills({ sourceDir, destDir });
    const after = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    assert.match(after, /fresh content/);
    assert.doesNotMatch(after, /stale content/);
  });

  it("is idempotent — running twice yields the same on-disk state", () => {
    writePresetSource("mc-foo");
    syncPresetSkills({ sourceDir, destDir });
    const first = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    syncPresetSkills({ sourceDir, destDir });
    const second = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    assert.equal(first, second);
  });
});

describe("syncPresetSkills — user-skill safety", () => {
  it("does NOT touch a non-mc- slug in the destination", () => {
    writePresetSource("mc-foo");
    writeDestSkill("library", "user-authored content");
    syncPresetSkills({ sourceDir, destDir });
    const after = readFileSync(path.join(destDir, "library", "SKILL.md"), "utf-8");
    assert.equal(after, "user-authored content");
  });

  it("does NOT remove a non-mc- slug during cleanup", () => {
    // Even when there are NO source presets, a user's library/ in
    // dest must survive the cleanup pass.
    writeDestSkill("library", "user-authored content");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, []);
    assert.ok(existsSync(path.join(destDir, "library", "SKILL.md")));
  });
});

describe("syncPresetSkills — slug guard", () => {
  it("skips a source entry without the mc- prefix", () => {
    writePresetSource("library");
    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /library/);
    assert.match(result.skipped[0], /mc-/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /library/);
    assert.equal(existsSync(path.join(destDir, "library")), false);
  });

  it("skips a source entry without SKILL.md", () => {
    mkdirSync(path.join(sourceDir, "mc-empty"));
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-empty/);
    assert.match(result.skipped[0], /SKILL\.md/);
  });

  it("skips a non-directory source entry", () => {
    writeFileSync(path.join(sourceDir, "stray-file.md"), "not a slug dir");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
  });

  it("ignores hidden source entries (.gitkeep, .DS_Store)", () => {
    writeFileSync(path.join(sourceDir, ".gitkeep"), "");
    writeFileSync(path.join(sourceDir, ".DS_Store"), "");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
  });

  it("skips when SKILL.md is a directory (regression: not a regular file)", () => {
    // Codex review iter-1: existsSync alone passes a directory
    // standing in for SKILL.md; copyFileSync would then crash boot.
    // The classifier must check `isFile()`.
    const slugDir = path.join(sourceDir, "mc-bad-shape");
    mkdirSync(path.join(slugDir, "SKILL.md"), { recursive: true });
    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-bad-shape/);
    assert.match(result.skipped[0], /regular file/);
    assert.equal(warnings.length, 1);
  });
});

describe("syncPresetSkills — source resilience", () => {
  it("aborts cleanly when sourceDir exists as a regular file (packaging mistake)", () => {
    // Codex review iter-3: existsSync(sourceDir) accepts a regular
    // file standing in for the preset directory; readdirSync would
    // then ENOTDIR-crash boot. The function must tolerate that
    // packaging bug as a recoverable "skip the sync" state.
    rmSync(sourceDir, { recursive: true, force: true });
    writeFileSync(sourceDir, "stray file at the source path");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /preset sync aborted/);
  });
});

describe("syncPresetSkills — destination resilience", () => {
  it("aborts the sync cleanly when the root dest itself is a regular file (regression: corruption-tolerant boot)", () => {
    // Codex review iter-2 (on the original `.claude/skills/` dest;
    // same defence applies to the catalog destination after #1335
    // PR-A): prior fix only protected per-slug mkdirSync; the root
    // mkdirSync would still EEXIST-crash if the destination root
    // itself was somehow a regular file. Now it logs warn + skips
    // the whole sync.
    writePresetSource("mc-foo");
    writeFileSync(destDir, "stray file blocking the root skills dir");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /preset sync aborted/);
  });

  it("skips a slug whose dest slot is occupied by a regular file (regression: corruption-tolerant boot)", () => {
    // Codex review iter-1: mkdirSync recursive: true throws EEXIST
    // when the path is a regular file. One bad slot must not crash
    // boot — log warn and skip just that slug, keep others moving.
    writePresetSource("mc-foo");
    writePresetSource("mc-bar");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, "mc-foo"), "stray file blocking the slug dir");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    // mc-foo is skipped (slot occupied), mc-bar still copies.
    assert.deepEqual(result.copied, ["mc-bar"]);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-foo/);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    // mc-bar landed normally despite mc-foo's failure.
    assert.ok(existsSync(path.join(destDir, "mc-bar", "SKILL.md")));
  });
});

describe("syncPresetSkills — cleanup of retired presets", () => {
  it("removes an mc-* slug in dest that no longer exists in source", () => {
    writeDestSkill("mc-stale", "old preset from a previous release");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, ["mc-stale"]);
    assert.equal(existsSync(path.join(destDir, "mc-stale")), false);
    assert.ok(existsSync(path.join(destDir, "mc-foo", "SKILL.md")));
  });

  it("does NOT remove the slug we just copied", () => {
    writeDestSkill("mc-foo", "old content");
    writePresetSource("mc-foo", "new content");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.copied, ["mc-foo"]);
  });

  it("removes multiple stale mc-* entries in one pass", () => {
    writeDestSkill("mc-old-a", "");
    writeDestSkill("mc-old-b", "");
    writePresetSource("mc-fresh");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed.sort(), ["mc-old-a", "mc-old-b"]);
  });

  it("emits an info log for each removed entry", () => {
    writeDestSkill("mc-stale", "");
    const infos: string[] = [];
    syncPresetSkills({
      sourceDir,
      destDir,
      onInfo: (message, data) => infos.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.ok(infos.some((entry) => entry.includes("removed retired preset") && entry.includes("mc-stale")));
  });
});

describe("syncPresetSkills — combined scenarios", () => {
  it("handles an upgrade: one preset added, one removed, one user-skill untouched", () => {
    // Snapshot of a typical mulmoclaude upgrade: previous boot
    // installed mc-old + mc-keep, user added their own `library`,
    // current source ships mc-keep + mc-new.
    writeDestSkill("mc-old", "retired in this release");
    writeDestSkill("mc-keep", "stale content");
    writeDestSkill("library", "user content");
    writePresetSource("mc-keep", "refreshed content");
    writePresetSource("mc-new", "new in this release");

    const result = syncPresetSkills({ sourceDir, destDir });

    assert.deepEqual(result.copied.sort(), ["mc-keep", "mc-new"]);
    assert.deepEqual(result.removed, ["mc-old"]);
    assert.equal(existsSync(path.join(destDir, "mc-old")), false);
    assert.match(readFileSync(path.join(destDir, "mc-keep", "SKILL.md"), "utf-8"), /refreshed/);
    assert.ok(existsSync(path.join(destDir, "mc-new", "SKILL.md")));
    assert.equal(readFileSync(path.join(destDir, "library", "SKILL.md"), "utf-8"), "user content");
  });
});

describe("syncPresetSkills — repository fixture", () => {
  it("the in-repo skills-preset/ directory has at least one preset and ALL slugs are mc-* prefixed", () => {
    // Anchored to a real path so this test catches regressions where
    // someone adds a preset slug missing the mc- prefix at the
    // repository level (boot would warn-and-skip, but a CI fail is
    // louder).
    const REPO_PRESET_DIR = path.resolve(import.meta.dirname, "..", "..", "server", "workspace", "skills-preset");
    if (!existsSync(REPO_PRESET_DIR)) return; // dir not created yet — covered by other tests
    const slugs = readdirSync(REPO_PRESET_DIR).filter((entry) => !entry.startsWith("."));
    assert.ok(slugs.length >= 1, "expected at least one preset under skills-preset/");
    for (const slug of slugs) {
      assert.equal(isPresetSlug(slug), true, `slug "${slug}" must start with "mc-"`);
      assert.ok(existsSync(path.join(REPO_PRESET_DIR, slug, "SKILL.md")), `slug "${slug}" must contain a SKILL.md`);
    }
  });
});
