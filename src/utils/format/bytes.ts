// Human-readable byte sizes for the UI (file sizes, attachment
// previews, etc.). Centralised so the same byte count never displays
// as different rounded forms across views (#1309).
//
// Boundaries are powers of 1024 (KiB / MiB / GiB), matching how
// operating systems report file sizes; binary thresholds are the
// expected convention for desktop file-size UI even though SI uses
// 1000-based prefixes.

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

export interface FormatBytesOptions {
  /** Decimal places for KB and above. Defaults to 1. Bytes (B) are
   *  always shown as integers. */
  decimals?: number;
}

// `toFixed` throws RangeError for arguments outside [0, 100] and for
// non-integers after coercion. As a shared helper, a single bad caller
// option (negative, fractional, Infinity, NaN) would otherwise crash
// the UI render path. Clamp + floor to keep the helper defensive.
function sanitiseDecimals(raw: number | undefined): number {
  if (raw === undefined) return 1;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(100, Math.max(0, Math.floor(raw)));
}

export function formatBytes(bytes: number, opts: FormatBytesOptions = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const decimals = sanitiseDecimals(opts.decimals);
  // The interface comment promises "Bytes (B) are always shown as
  // integers" — `Math.trunc` keeps that contract honest when callers
  // pass fractional input (e.g. file.size from some upstream APIs
  // can carry a sub-byte fraction).
  if (bytes < KiB) return `${Math.trunc(bytes)} B`;
  if (bytes < MiB) return `${(bytes / KiB).toFixed(decimals)} KB`;
  if (bytes < GiB) return `${(bytes / MiB).toFixed(decimals)} MB`;
  return `${(bytes / GiB).toFixed(decimals)} GB`;
}
