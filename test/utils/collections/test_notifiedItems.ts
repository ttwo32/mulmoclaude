// Unit tests for collectionNotifiedSeverities
// (src/utils/collections/notifiedItems.ts) — maps active bell entries to the
// (slug, itemId) records they deep-link plus the notification severity, so the
// Kanban board can flag cards in the matching bell colour.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionNotifiedSeverities, type NotifiedEntryLike } from "../../../src/utils/collections/notifiedItems.js";

/** A bell entry shaped like the ones `notifications.ts` publishes:
 *  `pluginData.action.target = { view: "collections", slug, itemId }`, with a
 *  top-level `severity`. */
function collectionEntry(slug: string, itemId?: string, severity?: string): NotifiedEntryLike {
  return { severity, pluginData: { action: { type: "navigate", target: { view: "collections", slug, itemId } } } };
}

describe("collectionNotifiedSeverities", () => {
  it("maps item ids to their severity for the matching slug", () => {
    const entries = [collectionEntry("tasks", "t1", "urgent"), collectionEntry("tasks", "t2", "nudge"), collectionEntry("notes", "n1", "urgent")];
    assert.deepEqual(
      collectionNotifiedSeverities(entries, "tasks"),
      new Map([
        ["t1", "urgent"],
        ["t2", "nudge"],
      ]),
    );
  });

  it("defaults an unknown/absent severity to 'info'", () => {
    assert.deepEqual(collectionNotifiedSeverities([collectionEntry("tasks", "t1")], "tasks"), new Map([["t1", "info"]]));
  });

  it("keeps the worst severity when an item has several notifications", () => {
    const entries = [collectionEntry("tasks", "t1", "nudge"), collectionEntry("tasks", "t1", "urgent"), collectionEntry("tasks", "t1", "info")];
    assert.deepEqual(collectionNotifiedSeverities(entries, "tasks"), new Map([["t1", "urgent"]]));
  });

  it("ignores entries for other collections", () => {
    assert.deepEqual(collectionNotifiedSeverities([collectionEntry("notes", "n1", "urgent")], "tasks"), new Map());
  });

  it("skips collection-level entries that carry no itemId", () => {
    assert.deepEqual(collectionNotifiedSeverities([collectionEntry("tasks", undefined, "urgent")], "tasks"), new Map());
  });

  it("ignores entries whose target is a different view", () => {
    const wiki: NotifiedEntryLike = { severity: "urgent", pluginData: { action: { target: { view: "wiki", slug: "tasks", itemId: "t1" } } } };
    assert.deepEqual(collectionNotifiedSeverities([wiki], "tasks"), new Map());
  });

  it("tolerates entries with absent or malformed pluginData", () => {
    const entries: NotifiedEntryLike[] = [
      {},
      { pluginData: null },
      { pluginData: "nope" },
      { pluginData: { action: {} } },
      { pluginData: { action: { target: { view: "collections" } } } }, // missing slug
      collectionEntry("tasks", "t1", "nudge"),
    ];
    assert.deepEqual(collectionNotifiedSeverities(entries, "tasks"), new Map([["t1", "nudge"]]));
  });
});
