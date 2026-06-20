// CSP for presentHtml's print-mode iframe. Ported from MulmoClaude's
// src/utils/html/previewCsp.ts so the View travels with its own policy (no host
// import). Keep the CDN allowlist audited — every entry is a supply-chain
// surface. The host's Files-explorer keeps its own copy of the broader preview
// policy; this package only needs the print path.

export const HTML_PREVIEW_CSP_ALLOWED_CDNS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // Plotly's official CDN — the LLM defaults to this URL for Sankey / other
  // Plotly charts, and historical artifacts bake it in.
  "https://cdn.plot.ly",
];

function buildCsp(connectSrc: string, imgSelf: string, cdns: readonly string[]): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    // LLM-authored HTML almost always uses inline <script>/<style> blocks
    // alongside a CDN load; no feasible path to drop 'unsafe-inline'.
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    `img-src ${imgSelf} ${cdnList} data: blob:`,
    `connect-src ${connectSrc}`,
  ].join("; ");
}

/**
 * Preview/print policy: block XHR/fetch/WebSocket (`connect-src 'none'`) so the
 * page can't phone home. `origin`, when provided, replaces `'self'` in
 * `img-src` — a `sandbox="allow-scripts"`/`srcdoc` document has an opaque
 * origin, so `'self'` would never match its same-origin asset requests.
 */
export function buildHtmlPreviewCsp(origin?: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  return buildCsp("'none'", origin ?? "'self'", cdns);
}

/** CSP for the hidden print iframe — same policy as the preview header with the
 *  explicit server origin substituted for `'self'`. */
export function buildPrintCspContent(origin: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  return buildHtmlPreviewCsp(origin, cdns);
}
