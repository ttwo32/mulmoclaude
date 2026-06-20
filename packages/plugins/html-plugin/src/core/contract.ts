// Host-agnostic dispatch envelope for the presentHtml View. The Vue View is
// decoupled from any one host's REST surface: it calls
// `useRuntime().dispatch({ kind, … })`, the host routes that to the package's
// `executeHtmlDispatch` (see `./dispatch`), and the dispatch reaches host
// storage only through the GENERIC gui-chat-protocol `files.artifacts`
// capability — no presentHtml-specific host method.

/** Read the bytes of an existing HTML artifact (source editor + print). */
export interface LoadHtmlArgs {
  kind: "loadHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
}

/** Overwrite an existing HTML artifact in place (source editor "Apply"). */
export interface SaveHtmlArgs {
  kind: "saveHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
  html: string;
}

/** Discriminated union of every action the View can `dispatch`. */
export type HtmlDispatchArgs = LoadHtmlArgs | SaveHtmlArgs;

/** Maps a dispatch `kind` to its result shape so the View can call
 *  `dispatch<HtmlDispatchResult["loadHtml"]>(…)` without a cast. */
export interface HtmlDispatchResult {
  loadHtml: { html: string };
  saveHtml: { path: string };
}
