import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { WORKSPACE_FILES } from "../../../../server/workspace/paths.js";
import { normalizeDashboard, normalizeRowHeights, readDashboard, writeDashboard } from "../../../../server/utils/files/dashboard-io.js";
import type { DashboardTile } from "../../../../src/types/dashboard.js";

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmoclaude-dashboard-"));
  return realpathSync(dir);
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function filePath(root: string): string {
  return path.join(root, WORKSPACE_FILES.dashboard);
}

const sample: DashboardTile = { slug: "invoices", viewMode: "kanban" };

describe("dashboard-io — read", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("returns an empty layout when the file is missing", async () => {
    assert.deepEqual(await readDashboard(root), { tiles: [], rowHeights: {} });
  });

  it("returns an empty layout on malformed JSON", async () => {
    mkdirSync(path.dirname(filePath(root)), { recursive: true });
    writeFileSync(filePath(root), "{ not json");
    assert.deepEqual(await readDashboard(root), { tiles: [], rowHeights: {} });
  });

  it("reads back what was written (tiles + rowHeights)", async () => {
    await writeDashboard({ tiles: [sample], rowHeights: { "2": [400, 0, 250], "1": [300] } }, root);
    assert.deepEqual(await readDashboard(root), { tiles: [sample], rowHeights: { "2": [400, 0, 250], "1": [300] } });
  });
});

describe("dashboard-io — write", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("persists the object-wrapped shape with a trailing newline", async () => {
    await writeDashboard({ tiles: [sample], rowHeights: { "2": [400] } }, root);
    const raw = readFileSync(filePath(root), "utf-8");
    assert.equal(raw.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(raw), { tiles: [sample], rowHeights: { "2": [400] } });
  });

  it("dedupes tiles on slug, keeping the first occurrence", async () => {
    const written = await writeDashboard({ tiles: [sample, { slug: "invoices", viewMode: "table" }, { slug: "contacts" }] }, root);
    assert.deepEqual(written, { tiles: [sample, { slug: "contacts" }], rowHeights: {} });
  });
});

describe("normalizeDashboard — tile validation", () => {
  it("drops non-array input", () => {
    assert.deepEqual(normalizeDashboard(null), []);
    assert.deepEqual(normalizeDashboard({ foo: 1 }), []);
  });

  it("drops entries with an empty / non-string slug", () => {
    const input = [
      { slug: "", viewMode: "table" }, // empty slug
      { slug: 42 }, // non-string slug
      { slug: "ok" }, // valid
    ];
    assert.deepEqual(normalizeDashboard(input), [{ slug: "ok" }]);
  });

  it("keeps viewMode only when a non-empty string", () => {
    assert.deepEqual(
      normalizeDashboard([
        { slug: "a", viewMode: "" },
        { slug: "b", viewMode: 7 },
        { slug: "c", viewMode: "custom:year" },
      ]),
      [{ slug: "a" }, { slug: "b" }, { slug: "c", viewMode: "custom:year" }],
    );
  });
});

describe("normalizeRowHeights — validation", () => {
  it("drops non-object / array input and bad column keys", () => {
    assert.deepEqual(normalizeRowHeights(null), {});
    assert.deepEqual(normalizeRowHeights([400, 250]), {}); // bare array no longer accepted
    assert.deepEqual(normalizeRowHeights({ "0": [200], abc: [200], "-1": [200] }), {}); // non-positive-int keys
  });

  it("coerces invalid / non-positive entries to 0 and trims trailing zeros per layout", () => {
    assert.deepEqual(normalizeRowHeights({ "2": [420, 0, -5, "tall", Number.NaN, 300], "1": [250, 0, 0] }), {
      "2": [420, 0, 0, 0, 0, 300],
      "1": [250],
    });
  });

  it("drops a column whose array is all-default (empty after trim)", () => {
    assert.deepEqual(normalizeRowHeights({ "1": [0, 0], "2": [400] }), { "2": [400] });
  });
});
