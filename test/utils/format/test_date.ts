import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatTime, formatShortTime, formatShortDate, formatMonthYear } from "../../../src/utils/format/date.js";

describe("formatDate", () => {
  it("returns a non-empty string for a valid ISO date", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("contains digits (some form of time/day)", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    // `\p{N}` matches any Unicode digit so this stays correct on
    // hosts that emit non-ASCII numerals (Arabic-Indic `١`,
    // Devanagari `१`, etc.). `\d` would be `[0-9]` only and
    // false-fail there. (Codex review on #1338.)
    assert.match(out, /\p{N}/u);
  });

  it("does not throw for an unparseable input", () => {
    // Locale-aware formatting of an invalid Date never throws — it
    // returns a placeholder string ("Invalid Date" / "Invalid Date
    // Invalid Date" depending on locale). We only assert the safety
    // contract: the function must not bubble an exception up to the
    // UI render path.
    assert.doesNotThrow(() => formatDate("not a date"));
    // And it returns a non-empty placeholder string of some kind.
    const out = formatDate("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.match(out, /Invalid Date/);
  });

  it("differs across days at the same time", () => {
    const dateJan = formatDate("2026-01-01T12:00:00Z");
    const dateDec = formatDate("2026-12-31T12:00:00Z");
    assert.notEqual(dateJan, dateDec);
  });
});

// Fixed instant for the test suite below. Using `Date.now()` would
// make assertions non-deterministic — the test would pass on any
// string-looking output regardless of whether the formatter pulled a
// digit out of the actual input. With a frozen epoch we can also
// assert that the day-of-month survives, so a future bug that
// returns "Invalid Date" but still includes some digit gets caught.
// (Sourcery review on PR #1316.)
const FIXED_INSTANT = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
const FIXED_EPOCH = FIXED_INSTANT.getTime();

// Day-of-month for `FIXED_INSTANT` as the formatter would render it
// on THIS host. Both axes of variation collapse into one call:
//   - **Numeral system** follows the host's default locale (`"10"`
//     on ASCII hosts, `"١٠"` on `ar-EG`, `"१०"` on `hi-IN`, etc.).
//   - **Timezone** is the host's default — important because
//     `2026-04-10T12:00:00Z` is April 11 locally in UTC+13/+14 zones,
//     so hard-coding `"10"` would fail in those zones even with
//     correct formatter output (Codex review iter-2 on #1338).
// `formatDateTime` / `formatShortDate` use the same `undefined`
// locale + timezone defaults, so the substring assertion below
// always finds a match when the formatter is healthy.
const EXPECTED_DAY_OF_MONTH = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(FIXED_INSTANT);

// Locale-independent time-shape pattern: 1-2 Unicode digits, a
// common time separator (`:` typical, some locales use `.` or
// space), 2 more digits. `\p{N}` covers any numeric script so the
// pattern matches `12:00`, `١٢:٠٠`, `१२.००`, etc.
const TIME_PATTERN = /\p{N}{1,2}[:.\s]\p{N}{2}/u;

describe("formatDateTime", () => {
  it("returns a non-empty string carrying the input's day-of-month", () => {
    const out = formatDateTime(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.ok(out.includes(EXPECTED_DAY_OF_MONTH), `expected "${EXPECTED_DAY_OF_MONTH}" in ${out}`);
  });
});

describe("formatTime", () => {
  it("renders an hour:minute-shaped value from a fixed epoch", () => {
    const out = formatTime(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    // Tightened from the original `/\d{1,2}/` which would pass for
    // any string containing digits (e.g. a bare day number or just
    // minutes). The locale-independent time-shape pattern asserts
    // we got an actual HH:MM-style segment. (Codex + Sourcery
    // reviews on #1338.)
    assert.match(out, TIME_PATTERN);
  });
});

describe("formatShortTime", () => {
  it("returns a short time from ISO string", () => {
    const out = formatShortTime("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.match(out, /\p{N}/u);
  });

  it("falls back to raw string on parse error", () => {
    const out = formatShortTime("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });
});

describe("formatShortDate", () => {
  it("renders a short date carrying the day-of-month from a fixed epoch", () => {
    const out = formatShortDate(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    assert.ok(out.includes(EXPECTED_DAY_OF_MONTH), `expected "${EXPECTED_DAY_OF_MONTH}" in ${out}`);
  });
});

describe("formatMonthYear", () => {
  // `FIXED_INSTANT` / `FIXED_EPOCH` come from the top of this file;
  // `FIXED_ISO` is only needed here so it stays local.
  const FIXED_ISO = FIXED_INSTANT.toISOString();

  it("returns a non-empty string from a Date", () => {
    const out = formatMonthYear(FIXED_INSTANT);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("returns the same string for equivalent Date / epoch ms / ISO inputs", () => {
    // Locale-agnostic structural invariant (Codex #1316): assert
    // that the three input shapes produce identical output for the
    // same instant, not that the output matches a literal year /
    // digit sequence (which would break in non-ASCII-digit or
    // non-Gregorian locales).
    const fromDate = formatMonthYear(FIXED_INSTANT);
    const fromEpoch = formatMonthYear(FIXED_EPOCH);
    const fromIso = formatMonthYear(FIXED_ISO);
    assert.equal(fromEpoch, fromDate);
    assert.equal(fromIso, fromDate);
    assert.ok(fromDate.length > 0);
  });
});
