// MulmoClaude's host wiring for the presentHtml plugin's dispatch channel.
// The extracted @mulmoclaude/html-plugin View reaches host storage through
// `useRuntime().dispatch({ kind: "loadHtml" | "saveHtml", … })`; this registers
// the built-in "html" dispatch handler that routes those calls to the package's
// `executeHtmlDispatch` against the GENERIC `files.artifacts` capability, then
// publishes a file-change event after a save so subscribed View tabs refresh.
// Imported for side effect at boot (server/index.ts) so the dispatch resolves.

import { executeHtmlDispatch } from "@mulmoclaude/html-plugin";
import type { HtmlDispatchArgs } from "@mulmoclaude/html-plugin";
import { makeArtifactsFileOps } from "./runtime.js";
import { publishFileChange } from "../events/file-change.js";
import { registerBuiltinDispatch } from "./builtin-dispatch.js";

/** Scope name — matches `wrapWithScope("html", …)` in
 *  `src/plugins/presentHtml/index.ts`, which is what the View's
 *  `useRuntime().dispatch` uses as the `:pkg` path segment. */
const HTML_SCOPE = "html";

registerBuiltinDispatch(HTML_SCOPE, async (args) => {
  const dispatchArgs = args as unknown as HtmlDispatchArgs;
  const result = await executeHtmlDispatch({ files: { artifacts: makeArtifactsFileOps() } }, dispatchArgs);
  // saveHtml changed bytes on disk → nudge subscribed View tabs (load is read-only).
  if (dispatchArgs.kind === "saveHtml") {
    void publishFileChange(dispatchArgs.path);
  }
  return result;
});
