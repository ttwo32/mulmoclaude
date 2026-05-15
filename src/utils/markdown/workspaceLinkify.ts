// Auto-linkify inline-code spans whose content looks like a
// workspace-relative path to a generated / data file (#1300).
//
// The LLM is told (via `server/agent/prompt.ts` → "Referring to
// files in chat replies") to present generated files as Markdown
// links: `[name.pdf](artifacts/.../name.pdf)`. That covers 80%+ of
// outputs deterministically. The remaining tail — where the model
// drops the wrapper and ships ``artifacts/.../name.pdf`` as an
// inline code span — used to render as non-clickable code, forcing
// the user to copy/paste. This extension catches that residual case
// and wraps the codespan in an anchor so the existing
// workspace-link routing (#1102 / L-23) picks it up.
//
// Detection is intentionally narrow:
//   - prefix MUST be `artifacts/` or `data/` (= host's two
//     workspace-root file dirs; never matches a generic code
//     identifier like `obj.prop`)
//   - the path MUST be whitespace-free and end with `.<ext>` where
//     ext is 1-8 alphanumeric chars
// Anything that doesn't match falls through to the default
// codespan rendering — so legitimate code snippets (CSS selectors,
// CLI flags, version strings) keep their `<code>` shape.

import { Renderer, type MarkedExtension, type Tokens } from "marked";

// Greedy by design: matches up to the LAST `.ext` group, so paths
// with intermediate dots (e.g. `archive.tar.gz`) get the FULL path
// wrapped, not just the trailing `.gz`. The body character class is
// deliberately tight — `[A-Za-z0-9._/-]+` covers every char that
// appears in a real workspace path and EXCLUDES HTML metachars
// (`<`, `>`, `"`, `'`, `=`, …). This is defence in depth: even
// though marked's lexer HTML-escapes codespan text before we see it
// (so `<` is already `&lt;`), keeping the regex narrow stops
// crafted escaped sequences from sneaking into `href` / data-attr
// values. (Codex + Sourcery review on #1325.)
const WORKSPACE_PATH_PATTERN = /^(?:artifacts|data)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8}$/;

/** Pure test seam — exported so the unit test can drive every
 *  decision branch without spinning up marked. */
export function isWorkspacePath(text: string): boolean {
  return WORKSPACE_PATH_PATTERN.test(text);
}

// Delegate the non-linkified codespan path to marked's default
// renderer (instead of hardcoding `<code>${text}</code>`) so that
// any future marked behaviour — added classes, attribute escaping
// tweaks — flows through unchanged. (Sourcery review on #1325.)
const defaultRenderer = new Renderer();

/** Wrap the default `<code>...</code>` in an anchor that the
 *  workspace-link routing in `src/utils/dom/externalLink.ts` (and
 *  the global click handler in chat / files / wiki views) already
 *  knows how to intercept and route. `text` is the codespan content
 *  marked has already HTML-escaped, and `WORKSPACE_PATH_PATTERN`
 *  further restricts it to `[A-Za-z0-9._/-]` — together they
 *  guarantee no HTML metachars reach `href` / `data-workspace-path`
 *  attribute values. */
function wrapAsWorkspaceLink(token: Tokens.Codespan): string {
  const codeHtml = defaultRenderer.codespan(token);
  const { text } = token;
  return `<a href="${text}" class="workspace-link" data-workspace-path="${text}">${codeHtml}</a>`;
}

export const workspaceLinkifyExtension: MarkedExtension = {
  renderer: {
    codespan(token): string {
      if (!isWorkspacePath(token.text)) {
        return defaultRenderer.codespan(token);
      }
      return wrapAsWorkspaceLink(token);
    },
  },
};
