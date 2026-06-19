// Click/keyboard activation for the ref/embed + file cell links, which navigate
// through the binding rather than a `<router-link>` (router-optional). Centralised
// so every link site behaves the same:
//   - plain left-click / Enter / Space → navigate via the binding;
//   - a *modified* click (cmd/ctrl/shift/alt) falls through to the `href` (open in
//     a new tab) when the host provided one via `recordHref`/`fileRoutePath`;
//   - `stop` suppresses a surrounding clickable row's handler.
// The link sites also set `role="link"` + `tabindex=0` when there's no href, so a
// router-less host (no `recordHref`) keeps keyboard access.

import { collectionUi } from "./uiContext";

function isModifiedClick(event: MouseEvent | KeyboardEvent): boolean {
  // Only mouse clicks carry the "open in new tab" intent; keyboard Enter/Space
  // always activate in place.
  return event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** Activate a ref/embed link → navigate to `targetSlug` (optionally a record). */
export function activateRefLink(event: MouseEvent | KeyboardEvent, targetSlug: string, recordId?: string, stop = false): void {
  if (stop) event.stopPropagation();
  if (isModifiedClick(event)) return; // let the browser open the href in a new tab
  event.preventDefault();
  collectionUi().navigateToRecord(targetSlug, recordId);
}

/** Activate a `file` cell link → navigate to a host path. When the host has no
 *  `navigate` capability, do NOT preventDefault so the `href` still works (or, in
 *  a router-less host that also has no path, the link simply isn't rendered). */
export function activatePathLink(event: MouseEvent | KeyboardEvent, path: string, stop = false): void {
  if (stop) event.stopPropagation();
  if (isModifiedClick(event)) return;
  const nav = collectionUi().navigate;
  if (!nav) return; // fall back to the browser following the href
  event.preventDefault();
  nav(path);
}
