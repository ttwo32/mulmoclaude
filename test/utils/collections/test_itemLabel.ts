// Unit tests for the shared collection chip-label resolution
// (src/utils/collections/itemLabel.ts), used by both the month grid and the
// day view so they label a record identically.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { labelFieldFor, itemIdOf, itemLabelOf } from "../../../src/utils/collections/itemLabel.js";
import type { CollectionSchema } from "../../../src/components/collectionTypes.js";

const schema: CollectionSchema = {
  title: "Events",
  icon: "event",
  dataPath: "data/events/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true },
    title: { type: "string", label: "Title" },
    count: { type: "number", label: "Count" },
  },
};

describe("labelFieldFor", () => {
  it("prefers an explicit displayField", () => {
    assert.equal(labelFieldFor({ ...schema, displayField: "count" }), "count");
  });

  it("falls back to the first non-primary text-like field", () => {
    assert.equal(labelFieldFor(schema), "title");
  });

  it("returns null when no text-like field exists", () => {
    const numericOnly: CollectionSchema = {
      ...schema,
      fields: { id: { type: "string", label: "ID", primary: true }, count: { type: "number", label: "Count" } },
    };
    assert.equal(labelFieldFor(numericOnly), null);
  });
});

describe("itemLabelOf", () => {
  it("uses a non-empty string label-field value", () => {
    assert.equal(itemLabelOf({ id: "a", title: "Launch" }, schema, "title"), "Launch");
  });

  it("stringifies numeric / boolean label values rather than dropping to the id", () => {
    assert.equal(itemLabelOf({ id: "a", count: 0 }, schema, "count"), "0");
    assert.equal(itemLabelOf({ id: "a", flag: true }, schema, "flag"), "true");
  });

  it("falls back to the id for empty, missing, or object values", () => {
    assert.equal(itemLabelOf({ id: "a", title: "" }, schema, "title"), "a");
    assert.equal(itemLabelOf({ id: "a" }, schema, "title"), "a");
    assert.equal(itemLabelOf({ id: "a", title: { nested: 1 } }, schema, "title"), "a");
    assert.equal(itemLabelOf({ id: "a", title: "x" }, schema, null), "a");
  });
});

describe("itemIdOf", () => {
  it("stringifies the primary-key value", () => {
    assert.equal(itemIdOf({ id: "abc" }, schema), "abc");
    assert.equal(itemIdOf({}, schema), "");
  });
});
