// Parse the per-slide aspect ratio out of Marp's first `<svg
// viewBox="0 0 W H">`. Used by MarpView to compute the iframe
// height — `slideCount × containerWidth × aspect` — so a hostile or
// malformed viewBox here would balloon the DOM. Clamp the parsed
// ratio to a safe range; anything outside falls back to the 16:9
// default.

export const DEFAULT_SLIDE_ASPECT = 9 / 16;

// Sensible aspect-ratio range. Below 1:5 (super-wide) or above 5:1
// (extreme portrait) the layout becomes unusable, and a pathological
// `size: 100x99999` could otherwise inflate iframe height to
// `slideCount × containerWidth × 999`, stalling the DOM.
const MIN_SLIDE_ASPECT = 0.2;
const MAX_SLIDE_ASPECT = 5;

const VIEW_BOX_RE = /viewBox="0 0 (\d+) (\d+)"/;

export function extractSlideAspect(html: string): number {
  const match = html.match(VIEW_BOX_RE);
  if (!match) return DEFAULT_SLIDE_ASPECT;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return DEFAULT_SLIDE_ASPECT;
  const aspect = height / width;
  if (aspect < MIN_SLIDE_ASPECT || aspect > MAX_SLIDE_ASPECT) return DEFAULT_SLIDE_ASPECT;
  return aspect;
}
