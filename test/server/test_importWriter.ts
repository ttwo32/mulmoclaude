import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { writeImportedCollection } from "../../server/workspace/collectionsRegistry/importWriter.js";
import type { RegistryCollectionEntry } from "../../server/workspace/collectionsRegistry/registryIndex.js";

const REGISTRY = "receptron/mulmoclaude-collections";

const entry: RegistryCollectionEntry = {
  id: "isamu/movies",
  author: "isamu",
  slug: "movies",
  title: "映画リスト",
  icon: "movie",
  description: "d",
  version: "1.0.0",
  tags: [],
  license: "MIT",
  fieldCount: 2,
  views: [],
  hasSeed: true,
  seedCount: 1,
  path: "collections/isamu/movies",
  contentSha: "abc123",
};

function validSchema(): Record<string, unknown> {
  return {
    title: "映画リスト",
    icon: "movie",
    dataPath: "data/movies/items",
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true },
      title: { type: "string", label: "Title" },
    },
  };
}

function makeBundle(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      "SKILL.md": "---\nname: movies\ndescription: x\n---\n# Movies",
      "schema.json": JSON.stringify(validSchema()),
      "meta.json": JSON.stringify({ author: "isamu", slug: "movies", version: "1.0.0", title: "映画リスト", description: "d", license: "MIT" }),
      "views/cinema.html": "<!doctype html><html></html>",
      "seed/items/a.json": JSON.stringify({ id: "a", title: "A" }),
      ...overrides,
    }),
  );
}

const skillDir = (root: string) => path.join(root, ".claude", "skills", "movies");
const seedFile = (root: string) => path.join(root, "data", "collections", "movies", "items", "a.json");

describe("writeImportedCollection", () => {
  let wsRoot: string;
  beforeEach(() => {
    wsRoot = mkdtempSync(path.join(tmpdir(), "mc-import-"));
  });
  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("installs the bundle, normalizes dataPath, materializes seed, writes provenance", async () => {
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "2026-06-27T00:00:00Z" });
    assert.ok(result.ok);
    assert.equal(result.localSlug, "movies");
    assert.equal(result.updated, false);
    assert.equal(result.seedWritten, 1);
    assert.equal(result.seedSkipped, false);

    assert.ok(existsSync(path.join(skillDir(wsRoot), "SKILL.md")));
    assert.ok(existsSync(path.join(skillDir(wsRoot), "views", "cinema.html")));
    assert.ok(!existsSync(path.join(skillDir(wsRoot), "seed")), "seed must not land in the skill dir");

    const schema = JSON.parse(readFileSync(path.join(skillDir(wsRoot), "schema.json"), "utf-8"));
    assert.equal(schema.dataPath, "data/collections/movies/items", "dataPath normalized (R3)");

    const origin = JSON.parse(readFileSync(path.join(skillDir(wsRoot), ".origin.json"), "utf-8"));
    assert.equal(origin.registry, REGISTRY);
    assert.equal(origin.author, "isamu");
    assert.equal(origin.contentSha, "abc123");
    assert.equal(origin.importedAt, "2026-06-27T00:00:00Z");

    assert.ok(existsSync(seedFile(wsRoot)), "seed record materialized into dataPath");
  });

  it("treats a same-origin re-import as an update and skips seed when data exists", async () => {
    await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t1" });
    const again = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t2" });
    assert.ok(again.ok);
    assert.equal(again.updated, true);
    assert.equal(again.seedWritten, 0);
    assert.equal(again.seedSkipped, true, "existing dataPath → seed skipped");
  });

  it("rejects with 409 when a different collection occupies the slug", async () => {
    mkdirSync(skillDir(wsRoot), { recursive: true });
    writeFileSync(path.join(skillDir(wsRoot), "SKILL.md"), "someone else's collection");
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("rejects an invalid schema with 422", async () => {
    const bundle = makeBundle({ "schema.json": JSON.stringify({ title: "x" }) });
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle, workspaceRoot: wsRoot, nowIso: "t" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 422);
  });

  it("re-import removes files that dropped out of the manifest", async () => {
    await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle({ "templates/old.md": "old" }), workspaceRoot: wsRoot, nowIso: "t1" });
    assert.ok(existsSync(path.join(skillDir(wsRoot), "templates", "old.md")));
    await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t2" });
    assert.ok(!existsSync(path.join(skillDir(wsRoot), "templates", "old.md")), "stale file removed on re-import");
    assert.ok(existsSync(path.join(skillDir(wsRoot), "SKILL.md")), "current bundle still installed");
  });

  it("returns 409 when the slug path exists as a non-directory file", async () => {
    mkdirSync(path.dirname(skillDir(wsRoot)), { recursive: true });
    writeFileSync(skillDir(wsRoot), "i am a file, not a directory");
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("returns 409 when the data path exists as a non-directory file", async () => {
    mkdirSync(path.join(wsRoot, "data", "collections", "movies"), { recursive: true });
    writeFileSync(path.join(wsRoot, "data", "collections", "movies", "items"), "i am a file, not a directory");
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("returns 409 when an ancestor of the data path is a non-directory file", async () => {
    mkdirSync(path.join(wsRoot, "data", "collections"), { recursive: true });
    writeFileSync(path.join(wsRoot, "data", "collections", "movies"), "ancestor is a file, not a dir");
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("cleans leftover staging/backup dirs from a prior crashed import and still installs", async () => {
    const staging = path.join(wsRoot, ".claude", "skills", ".importing-movies");
    const backup = path.join(wsRoot, ".claude", "skills", ".backup-movies");
    mkdirSync(staging, { recursive: true });
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(staging, "junk.txt"), "leftover from a crashed import");
    writeFileSync(path.join(backup, "junk.txt"), "leftover from a crashed swap");
    const result = await writeImportedCollection({ registry: REGISTRY, entry, bundle: makeBundle(), workspaceRoot: wsRoot, nowIso: "t" });
    assert.ok(result.ok);
    assert.ok(!existsSync(staging), "leftover staging dir removed");
    assert.ok(!existsSync(backup), "leftover backup dir removed");
    assert.ok(existsSync(path.join(skillDir(wsRoot), "SKILL.md")));
  });
});
