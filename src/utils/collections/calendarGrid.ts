// Pure, deterministic helpers for the collection calendar view: parse
// `date`-field values, build a month grid, and bucket records onto the
// days they cover. No `Date.now()` / `new Date()` (argless) here — every
// function takes its inputs explicitly so the logic is unit-testable
// without faking the clock. All internal arithmetic runs in UTC (which
// has no DST), so fixed 86_400_000 ms steps never skip or double a day.

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A civil date triple. `month` is 1-12 (NOT the 0-based `Date` month). */
export interface Ymd {
  year: number;
  month: number;
  day: number;
}

/** One cell of the 6×7 month grid. */
export interface DayCell {
  ymd: Ymd;
  /** False for the leading/trailing days that belong to the adjacent
   *  month (rendered greyed). */
  inMonth: boolean;
  /** Canonical `YYYY-MM-DD` key for this cell. */
  key: string;
}

/** A record placed on the calendar: the inclusive `[start, end]` span of
 *  days it covers. `end === start` for a single-day record. */
export interface RecordSpan<T> {
  item: T;
  start: Ymd;
  end: Ymd;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Canonical `YYYY-MM-DD` string for a civil date. */
export function ymdKey(ymd: Ymd): string {
  return `${String(ymd.year).padStart(4, "0")}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

/** Strictly parse a `YYYY-MM-DD` string into a civil date, rejecting
 *  anything that isn't a real calendar day (e.g. `2026-02-30`, `2026-13-01`).
 *  Returns null for non-strings and malformed values so callers can route
 *  records with no usable date into the "no date" tray rather than crash. */
export function parseIsoDate(value: unknown): Ymd | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through a UTC Date to reject impossible days: a value the
  // Date constructor rolls over (Feb 30 → Mar 2) won't match back.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function ymdToUtcMs(ymd: Ymd): number {
  return Date.UTC(ymd.year, ymd.month - 1, ymd.day);
}

function utcMsToYmd(epochMs: number): Ymd {
  const date = new Date(epochMs);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Chronological comparison: negative if `left` precedes `right`, 0 if the
 *  same day, positive if after. */
export function compareYmd(left: Ymd, right: Ymd): number {
  return ymdToUtcMs(left) - ymdToUtcMs(right);
}

/** True iff `day` falls within the inclusive span `[span.start, span.end]`. */
export function spanCoversDay<T>(span: RecordSpan<T>, day: Ymd): boolean {
  return compareYmd(span.start, day) <= 0 && compareYmd(day, span.end) <= 0;
}

/** Build the 6×7 (42-cell) grid for the given month, including the
 *  leading/trailing days of the adjacent months so every week is full.
 *  `month` is 1-12. `weekStartsOn` is 0 (Sunday) … 6 (Saturday). */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 0): DayCell[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const startMs = Date.UTC(year, month - 1, 1) - lead * MS_PER_DAY;
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const ymd = utcMsToYmd(startMs + i * MS_PER_DAY);
    cells.push({ ymd, inMonth: ymd.year === year && ymd.month === month, key: ymdKey(ymd) });
  }
  return cells;
}

/** Resolve a record's calendar span from its `date` fields. Returns null
 *  when the anchor date is missing/invalid (→ the caller's "no date" tray).
 *  An end date that is missing, invalid, or earlier than the start collapses
 *  to a single-day span — never an inverted range. */
export function recordSpan<T extends Record<string, unknown>>(item: T, anchorField: string, endField?: string): RecordSpan<T> | null {
  const start = parseIsoDate(item[anchorField]);
  if (!start) return null;
  let end = start;
  if (endField) {
    const parsedEnd = parseIsoDate(item[endField]);
    if (parsedEnd && compareYmd(parsedEnd, start) >= 0) end = parsedEnd;
  }
  return { item, start, end };
}

/** Split records into those that land on the calendar (with their spans)
 *  and those with no usable anchor date (the "no date" tray). Spans are
 *  sorted by start day so same-day stacking is stable across renders. */
export function bucketRecords<T extends Record<string, unknown>>(
  items: readonly T[],
  anchorField: string,
  endField?: string,
): { spans: RecordSpan<T>[]; noDate: T[] } {
  const spans: RecordSpan<T>[] = [];
  const noDate: T[] = [];
  for (const item of items) {
    const span = recordSpan(item, anchorField, endField);
    if (span) spans.push(span);
    else noDate.push(item);
  }
  spans.sort((left, right) => compareYmd(left.start, right.start));
  return { spans, noDate };
}

/** Month label key inputs — returns the 1st of the month as a `Date` so the
 *  component can feed it to `Intl.DateTimeFormat(locale, …)` for a localized
 *  "April 2026" header without this module taking a locale dependency. */
export function monthAnchorDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}
