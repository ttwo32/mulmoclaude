import type { ScheduledItem } from "./index";

export type SegmentPosition = "only" | "start" | "middle" | "end";

export interface EventRange {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

export function eventRange(item: ScheduledItem): EventRange | null {
  const start = asIsoDate(item.props.date);
  if (!start) return null;
  const endRaw = asIsoDate(item.props.endDate);
  if (!endRaw) return { start, end: start };
  if (endRaw < start) return { start, end: start };
  return { start, end: endRaw };
}

export function coversDay(item: ScheduledItem, dateStr: string): boolean {
  const range = eventRange(item);
  if (!range) return false;
  return range.start <= dateStr && dateStr <= range.end;
}

export function segmentPosition(item: ScheduledItem, dateStr: string): SegmentPosition | null {
  const range = eventRange(item);
  if (!range) return null;
  if (dateStr < range.start || dateStr > range.end) return null;
  if (range.start === range.end) return "only";
  if (dateStr === range.start) return "start";
  if (dateStr === range.end) return "end";
  return "middle";
}

// Per-event color so adjacent multi-day events read as distinct
// bars instead of one indistinguishable blue block. Full class
// strings (not template-built) so Tailwind's content scanner can
// find every variant.
//
// Eight muted bg-100/text-800 pairs picked for legibility on a
// white month grid. Hover bumps to bg-200.
const EVENT_PALETTE = [
  "bg-blue-100 text-blue-900 hover:bg-blue-200",
  "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
  "bg-amber-100 text-amber-900 hover:bg-amber-200",
  "bg-violet-100 text-violet-900 hover:bg-violet-200",
  "bg-rose-100 text-rose-900 hover:bg-rose-200",
  "bg-cyan-100 text-cyan-900 hover:bg-cyan-200",
  "bg-orange-100 text-orange-900 hover:bg-orange-200",
  "bg-lime-100 text-lime-900 hover:bg-lime-200",
];

export function eventColorClasses(eventId: string): string {
  let hash = 0;
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash * 31 + eventId.charCodeAt(i)) | 0;
  }
  return EVENT_PALETTE[Math.abs(hash) % EVENT_PALETTE.length] ?? EVENT_PALETTE[0] ?? "";
}

export const EVENT_PALETTE_SIZE = EVENT_PALETTE.length;
