// Unit tests for the pure calendar-grid helpers
// (src/utils/collections/calendarGrid.ts). The month-grid construction
// and record→day bucketing are pure so their edge cases (leap Feb, month
// boundaries, multi-day spans, invalid/inverted dates) are pinned here,
// independently from the Vue rendering layer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseIsoDate, ymdKey, compareYmd, buildMonthGrid, recordSpan, spanCoversDay, bucketRecords } from "../../../src/utils/collections/calendarGrid.js";

describe("parseIsoDate", () => {
  it("parses a valid YYYY-MM-DD", () => {
    assert.deepEqual(parseIsoDate("2026-06-02"), { year: 2026, month: 6, day: 2 });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(parseIsoDate("  2026-06-02 "), { year: 2026, month: 6, day: 2 });
  });

  it("rejects impossible calendar days", () => {
    assert.equal(parseIsoDate("2026-02-30"), null);
    assert.equal(parseIsoDate("2026-13-01"), null);
    assert.equal(parseIsoDate("2026-00-10"), null);
    assert.equal(parseIsoDate("2026-06-31"), null);
  });

  it("accepts a real leap day and rejects a non-leap one", () => {
    assert.deepEqual(parseIsoDate("2024-02-29"), { year: 2024, month: 2, day: 29 });
    assert.equal(parseIsoDate("2026-02-29"), null);
  });

  it("rejects non-strings and malformed shapes", () => {
    assert.equal(parseIsoDate(undefined), null);
    assert.equal(parseIsoDate(null), null);
    assert.equal(parseIsoDate(20260602), null);
    assert.equal(parseIsoDate("2026/06/02"), null);
    assert.equal(parseIsoDate("2026-6-2"), null);
    assert.equal(parseIsoDate(""), null);
  });
});

describe("ymdKey / compareYmd", () => {
  it("zero-pads the key", () => {
    assert.equal(ymdKey({ year: 2026, month: 6, day: 2 }), "2026-06-02");
    assert.equal(ymdKey({ year: 26, month: 12, day: 31 }), "0026-12-31");
  });

  it("orders dates chronologically", () => {
    assert.ok(compareYmd({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 }) < 0);
    assert.equal(compareYmd({ year: 2026, month: 5, day: 9 }, { year: 2026, month: 5, day: 9 }), 0);
    assert.ok(compareYmd({ year: 2027, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }) > 0);
  });
});

describe("buildMonthGrid", () => {
  it("always returns 42 cells", () => {
    assert.equal(buildMonthGrid(2026, 6).length, 42);
    assert.equal(buildMonthGrid(2026, 2).length, 42);
  });

  it("marks the current-month days and greys the rest", () => {
    // June 2026: the 1st is a Monday. Sunday-start grid → one leading day
    // (May 31), then June 1-30, then trailing July days.
    const grid = buildMonthGrid(2026, 6, 0);
    assert.equal(grid[0].key, "2026-05-31");
    assert.equal(grid[0].inMonth, false);
    assert.equal(grid[1].key, "2026-06-01");
    assert.equal(grid[1].inMonth, true);
    const inMonth = grid.filter((cell) => cell.inMonth);
    assert.equal(inMonth.length, 30);
    assert.equal(inMonth[0].key, "2026-06-01");
    assert.equal(inMonth[29].key, "2026-06-30");
  });

  it("honours a Monday week start", () => {
    // June 1 2026 is a Monday → no leading days with weekStartsOn=1.
    const grid = buildMonthGrid(2026, 6, 1);
    assert.equal(grid[0].key, "2026-06-01");
    assert.equal(grid[0].inMonth, true);
  });

  it("handles a leap February", () => {
    const inMonth = buildMonthGrid(2024, 2).filter((cell) => cell.inMonth);
    assert.equal(inMonth.length, 29);
    assert.equal(inMonth[28].key, "2024-02-29");
  });

  it("produces 42 contiguous days with no gaps or repeats", () => {
    const grid = buildMonthGrid(2026, 3);
    const keys = grid.map((cell) => cell.key);
    assert.equal(new Set(keys).size, 42);
  });
});

describe("recordSpan", () => {
  it("returns a single-day span when there is no end field", () => {
    const span = recordSpan({ on: "2026-06-10" }, "on");
    assert.deepEqual(span?.start, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(span?.end, { year: 2026, month: 6, day: 10 });
  });

  it("spans start→end inclusive when an end field is given", () => {
    const span = recordSpan({ on: "2026-06-10", until: "2026-06-12" }, "on", "until");
    assert.deepEqual(span?.start, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(span?.end, { year: 2026, month: 6, day: 12 });
  });

  it("collapses an inverted or invalid end to a single day", () => {
    assert.deepEqual(recordSpan({ on: "2026-06-10", until: "2026-06-01" }, "on", "until")?.end, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(recordSpan({ on: "2026-06-10", until: "nonsense" }, "on", "until")?.end, { year: 2026, month: 6, day: 10 });
  });

  it("returns null when the anchor date is missing or invalid", () => {
    assert.equal(recordSpan({ on: "" }, "on"), null);
    assert.equal(recordSpan({ on: "2026-02-30" }, "on"), null);
    assert.equal(recordSpan({}, "on"), null);
  });
});

describe("spanCoversDay", () => {
  const span = recordSpan({ on: "2026-06-10", until: "2026-06-12" }, "on", "until");
  if (!span) throw new Error("fixture span must parse");

  it("covers the inclusive endpoints and interior", () => {
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 10 }));
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 11 }));
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 12 }));
  });

  it("excludes days outside the span", () => {
    assert.equal(spanCoversDay(span, { year: 2026, month: 6, day: 9 }), false);
    assert.equal(spanCoversDay(span, { year: 2026, month: 6, day: 13 }), false);
  });
});

describe("bucketRecords", () => {
  it("separates dated records from undated ones and sorts by start", () => {
    const items = [
      { id: "c", on: "2026-06-20" },
      { id: "a", on: "2026-06-01" },
      { id: "x", on: "" },
      { id: "b", on: "2026-06-10" },
      { id: "y", on: "not-a-date" },
    ];
    const { spans, noDate } = bucketRecords(items, "on");
    assert.deepEqual(
      spans.map((span) => span.item.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      noDate.map((item) => item.id),
      ["x", "y"],
    );
  });
});
