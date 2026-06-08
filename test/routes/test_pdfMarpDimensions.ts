// Boundary tests for the Marp PDF route's `extractSlideDimensions`
// helper. Codex flagged the clamp/fallback path as untested across
// several review rounds — without this, a regression that drops the
// clamp would still pass CI even though hostile sizes would reach
// Puppeteer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSlideDimensions } from "../../server/api/routes/pdf.js";

function svg(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}"></svg>`;
}

describe("extractSlideDimensions — happy path", () => {
  it("returns the literal dimensions for a 16:9 viewBox", () => {
    assert.deepEqual(extractSlideDimensions(svg(1280, 720)), { width: 1280, height: 720 });
  });

  it("returns 4:3 dimensions", () => {
    assert.deepEqual(extractSlideDimensions(svg(960, 720)), { width: 960, height: 720 });
  });

  it("returns custom portrait dimensions inside the safe range", () => {
    assert.deepEqual(extractSlideDimensions(svg(1080, 1920)), { width: 1080, height: 1920 });
  });
});

describe("extractSlideDimensions — fallback", () => {
  it("falls back to 1280×720 when no viewBox is present", () => {
    assert.deepEqual(extractSlideDimensions("<div>no svg</div>"), { width: 1280, height: 720 });
  });

  it("falls back when either dimension is zero", () => {
    assert.deepEqual(extractSlideDimensions(svg(0, 720)), { width: 1280, height: 720 });
    assert.deepEqual(extractSlideDimensions(svg(1280, 0)), { width: 1280, height: 720 });
  });
});

describe("extractSlideDimensions — DoS clamp", () => {
  it("clamps 99999×99999 down to the cap (3840) so Puppeteer doesn't OOM", () => {
    assert.deepEqual(extractSlideDimensions(svg(99999, 99999)), { width: 3840, height: 3840 });
  });

  it("clamps just one over-sized dimension while preserving the safe one", () => {
    assert.deepEqual(extractSlideDimensions(svg(1280, 99999)), { width: 1280, height: 3840 });
    assert.deepEqual(extractSlideDimensions(svg(99999, 720)), { width: 3840, height: 720 });
  });

  it("falls back to default for under-sized dimensions", () => {
    // Smaller than MIN (200) → use default for that side.
    assert.deepEqual(extractSlideDimensions(svg(50, 720)), { width: 1280, height: 720 });
    assert.deepEqual(extractSlideDimensions(svg(1280, 50)), { width: 1280, height: 720 });
  });

  it("accepts values exactly at the cap and floor", () => {
    assert.deepEqual(extractSlideDimensions(svg(3840, 2160)), { width: 3840, height: 2160 });
    assert.deepEqual(extractSlideDimensions(svg(200, 200)), { width: 200, height: 200 });
  });
});
