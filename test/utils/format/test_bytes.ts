import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes } from "../../../src/utils/format/bytes.js";

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

describe("formatBytes", () => {
  it("renders bytes under 1 KiB as plain integers with 'B' suffix", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(KiB - 1), "1023 B");
  });

  it("renders KB once bytes >= 1024, with 1 decimal by default", () => {
    assert.equal(formatBytes(KiB), "1.0 KB");
    assert.equal(formatBytes(KiB * 5 + KiB / 2), "5.5 KB");
    assert.equal(formatBytes(MiB - 1), "1024.0 KB");
  });

  it("renders MB at the MiB boundary", () => {
    assert.equal(formatBytes(MiB), "1.0 MB");
    assert.equal(formatBytes(MiB * 2 + MiB / 4), "2.3 MB");
    // Upper edge — just under 1 GiB still shows as MB so the
    // KB→MB→GB rollover stays symmetric with the KB→MB one above.
    assert.equal(formatBytes(GiB - 1), "1024.0 MB");
  });

  it("renders GB at the GiB boundary", () => {
    assert.equal(formatBytes(GiB), "1.0 GB");
    assert.equal(formatBytes(GiB * 12.5), "12.5 GB");
  });

  it("honours the decimals option", () => {
    assert.equal(formatBytes(KiB * 5.5, { decimals: 0 }), "6 KB");
    assert.equal(formatBytes(MiB * 2.345, { decimals: 2 }), "2.35 MB");
  });

  it("returns the em-dash placeholder for negative / non-finite input", () => {
    assert.equal(formatBytes(-1), "—");
    assert.equal(formatBytes(Number.NaN), "—");
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), "—");
  });

  // Sourcery / Codex flagged that `toFixed(n)` throws RangeError for
  // `n < 0` or `n > 100`, so as a shared helper the `decimals` option
  // is sanitised (clamped + floored, non-finite → default). Pin every
  // sanitisation path so a future regression that drops the clamp
  // surfaces as a test failure rather than a UI crash.
  it("sanitises the decimals option — negative / out-of-range / non-finite all fall back safely", () => {
    // Negative clamps to 0.
    assert.equal(formatBytes(KiB * 5.5, { decimals: -3 }), "6 KB");
    // Above 100 clamps to 100 (toFixed's hard upper limit).
    assert.equal(formatBytes(KiB, { decimals: 1000 }), `${(1).toFixed(100)} KB`);
    // Fractional decimals floor to the integer below.
    assert.equal(formatBytes(MiB * 2.345, { decimals: 2.9 }), "2.35 MB");
    // Non-finite decimals fall back to the default of 1.
    assert.equal(formatBytes(MiB, { decimals: Number.NaN }), "1.0 MB");
    assert.equal(formatBytes(MiB, { decimals: Number.POSITIVE_INFINITY }), "1.0 MB");
  });

  it("ignores the decimals option for sub-KiB values (bytes always render as integers)", () => {
    assert.equal(formatBytes(512, { decimals: 3 }), "512 B");
    assert.equal(formatBytes(512, { decimals: 0 }), "512 B");
  });

  it("truncates fractional sub-KiB input — the 'B' branch never shows decimals", () => {
    // CodeRabbit flagged that the doc-comment promises integers for
    // the B branch, but raw template interpolation would leak `0.5 B`
    // through when a caller passes a fractional byte count (rare but
    // possible if upstream sums something like `file.size * ratio`).
    assert.equal(formatBytes(0.5), "0 B");
    assert.equal(formatBytes(512.9), "512 B");
    assert.equal(formatBytes(1023.999), "1023 B");
  });
});
