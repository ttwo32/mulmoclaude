import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applicableViewModes } from "@mulmoclaude/collection-plugin/vue";
import type { CollectionSchema } from "@mulmoclaude/core/collection";

function schema(overrides: Partial<CollectionSchema>): CollectionSchema {
  return {
    title: "Test",
    icon: "apps",
    dataPath: "data/test",
    primaryKey: "id",
    fields: { id: { type: "string", label: "Id" } },
    ...overrides,
  } as CollectionSchema;
}

describe("applicableViewModes", () => {
  it("always offers table; nothing else for a plain string field", () => {
    assert.deepEqual(applicableViewModes(schema({})), ["table"]);
  });

  it("adds calendar when a date or datetime field exists", () => {
    const withDate = schema({ fields: { id: { type: "string", label: "Id" }, due: { type: "date", label: "Due" } } });
    assert.deepEqual(applicableViewModes(withDate), ["table", "calendar"]);
  });

  it("adds kanban when an enum field exists", () => {
    const withEnum = schema({ fields: { id: { type: "string", label: "Id" }, status: { type: "enum", label: "Status", values: ["a", "b"] } } });
    assert.deepEqual(applicableViewModes(withEnum), ["table", "kanban"]);
  });

  it("appends each custom view as custom:<id>, in declaration order", () => {
    const withViews = schema({
      views: [
        { id: "year", label: "Year", file: "views/year.html" },
        { id: "board", label: "Board", file: "views/board.html" },
      ],
    });
    assert.deepEqual(applicableViewModes(withViews), ["table", "custom:year", "custom:board"]);
  });

  it("combines built-in and custom modes in selector order", () => {
    const full = schema({
      fields: {
        id: { type: "string", label: "Id" },
        due: { type: "datetime", label: "Due" },
        status: { type: "enum", label: "Status", values: ["a"] },
      },
      views: [{ id: "year", label: "Year", file: "views/year.html" }],
    });
    assert.deepEqual(applicableViewModes(full), ["table", "calendar", "kanban", "custom:year"]);
  });
});
