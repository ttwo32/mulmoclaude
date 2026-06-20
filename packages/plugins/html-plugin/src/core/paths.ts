// Pure path helpers for presentHtml artifacts. No Node built-ins so the
// package stays bundler-agnostic; all filesystem access happens through the
// host's generic `files.artifacts` FileOps (rooted at `<workspace>/artifacts`).

const HTML_DIR = "html";
const ARTIFACTS_ROOT = "artifacts";
const MAX_SLUG_LEN = 120;

/** Lowercase-hyphen slug, capped at MAX_SLUG_LEN, with leading/trailing
 *  hyphens stripped. Falls back to `fallback` for empty/undefined input.
 *  Mirrors chart-plugin's in-package slugify (deliberately simpler than the
 *  host's hash-fallback variant — these are throwaway artifact filenames). */
export function slugify(title: string | undefined, fallback = "page"): string {
  if (!title) return fallback;
  const collapsed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LEN);
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start += 1;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  return collapsed.slice(start, end) || fallback;
}

// #764 partitioning. UTC (not local) so a workspace synced across timezones
// still groups into the same YYYY/MM bucket.
function yearMonthUtc(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

export interface HtmlPath {
  /** Path relative to the artifacts root — what `files.artifacts.write` takes
   *  (e.g. `html/2026/06/the-cell-1718765432101.html`). */
  relPath: string;
  /** Workspace-relative path for display / tool-result data
   *  (e.g. `artifacts/html/2026/06/the-cell-1718765432101.html`). */
  filePath: string;
}

/** Build a fresh, collision-safe artifact path for a new HTML page. */
export function htmlArtifactPath(title: string | undefined, now: Date = new Date()): HtmlPath {
  const fname = `${slugify(title)}-${now.getTime()}.html`;
  const relPath = `${HTML_DIR}/${yearMonthUtc(now)}/${fname}`;
  return { relPath, filePath: `${ARTIFACTS_ROOT}/${relPath}` };
}

/**
 * Strict guard for a workspace-relative path the caller claims is an existing
 * HTML artifact. Rejects anything outside `artifacts/html/`, non-`.html`, or
 * with traversal / non-canonical segments — the primary defence before a
 * `files.artifacts` read/write (the FileOps path is the strip of this, below).
 */
export function isHtmlArtifactPath(value: string): boolean {
  if (!value.startsWith(`${ARTIFACTS_ROOT}/${HTML_DIR}/`)) return false;
  if (!value.endsWith(".html")) return false;
  // Reject empty segments (`//`, leading/trailing slash) and `.` / `..` —
  // equivalent to the host's `path.posix.normalize(v) === v && !v.includes("..")`.
  const segments = value.split("/");
  return !segments.some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Convert a workspace-relative artifacts path (`artifacts/html/…`) to the
 *  `files.artifacts`-relative form (`html/…`) that FileOps expects. Assumes
 *  the input already passed `isHtmlArtifactPath`. */
export function toArtifactsRelative(workspaceRelPath: string): string {
  return workspaceRelPath.startsWith(`${ARTIFACTS_ROOT}/`) ? workspaceRelPath.slice(ARTIFACTS_ROOT.length + 1) : workspaceRelPath;
}

/**
 * Default browser URL for an HTML artifact, derived purely from its
 * workspace-relative `filePath` — `artifacts/html/2026/04/p.html` →
 * `/artifacts/html/2026/04/p.html` (per-segment URL-encoded). The View uses
 * this when the host hasn't injected a `previewUrl`, so already-presented
 * results (whose stored data predates that field) still render. A host that
 * serves `artifacts/html/…` at a different URL injects `previewUrl` to override.
 * Returns null for non-HTML / out-of-tree paths.
 */
export function htmlArtifactPreviewUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return null;
  const prefix = `${ARTIFACTS_ROOT}/${HTML_DIR}/`;
  if (!filePath.startsWith(prefix)) return null;
  // Reject traversal / non-canonical segments so the derived URL can never point
  // the iframe outside artifacts/html/ — defence-in-depth even though `filePath`
  // is normally produced by `htmlArtifactPath` / validated by `presentExisting`.
  if (filePath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  const rest = filePath.slice(prefix.length);
  if (rest.length === 0) return null;
  return `/${ARTIFACTS_ROOT}/${HTML_DIR}/${rest.split("/").map(encodeURIComponent).join("/")}`;
}
