// MulmoClaude's implementation of the markdown plugin's host-capability
// surface (task #6). Builds a `MarkdownHostApp` over MulmoClaude's
// existing backends (Puppeteer PDF, Gemini image-fill, the
// artifacts/documents store, workspace Marp themes) and registers it as
// the built-in "markdown" dispatch handler. Imported for side effect at
// boot (server/index.ts) so the markdown View's
// `useRuntime().dispatch({ kind })` resolves.
//
// These are THIN adapters: each method delegates to the same server
// function the legacy REST routes used, so behaviour can't drift. At
// extraction (Phase 3) `core`/`contract` move into
// `@mulmoclaude/markdown-plugin` and this file stays behind as
// MulmoClaude's host adapter.

import { executeMarkdown } from "@mulmoclaude/markdown-plugin";
import type { MarkdownDispatchArgs, MarkdownHostApp } from "@mulmoclaude/markdown-plugin";
import { isMarkdownPath, loadMarkdown, overwriteMarkdown, saveMarkdown } from "../utils/files/markdown-store.js";
import { publishFileChange } from "../events/file-change.js";
import { listMarpThemes } from "../workspace/marp-themes.js";
import { renderMarkdownPdf } from "../api/routes/pdf.js";
import { fillMarkdownImagePlaceholders } from "../utils/files/markdown-image-fill.js";
import { registerBuiltinDispatch } from "./builtin-dispatch.js";

/** Scope name — matches `wrapWithScope("markdown", …)` in
 *  `src/plugins/markdown/index.ts`, which is what the View's
 *  `useRuntime().dispatch` uses as the `:pkg` path segment. */
const MARKDOWN_SCOPE = "markdown";

const markdownHostApp: MarkdownHostApp = {
  async loadDoc(path) {
    // The View only ever loads its own `artifacts/documents/*.md` docs;
    // `isMarkdownPath` is the same gate `overwriteMarkdown` relies on.
    if (!isMarkdownPath(path)) throw new Error(`invalid markdown path: ${path}`);
    return { content: await loadMarkdown(path) };
  },
  async saveDoc(path, markdown) {
    if (!isMarkdownPath(path)) throw new Error(`invalid markdown path: ${path}`);
    await overwriteMarkdown(path, markdown);
    // Fire-and-forget: refresh sibling tabs / agents watching this file.
    void publishFileChange(path);
    return { path };
  },
  async saveNewDoc(prefix, markdown) {
    // The package's context.app create path (MulmoTerminal); MulmoClaude's
    // own tool-call create still uses POST /api/markdown, but implementing
    // this keeps the host app conformant + usable either way.
    const path = await saveMarkdown(markdown, prefix);
    return { path };
  },
  async marpThemes() {
    return { themes: listMarpThemes() };
  },
  async exportPdf(options) {
    const buffer = await renderMarkdownPdf({
      markdown: options.markdown,
      marp: options.marp,
      baseDir: options.baseDir,
      format: options.format,
      stripFrontmatter: options.stripFrontmatter,
    });
    // base64 so the result survives the JSON dispatch hop; the View
    // decodes it back to a Blob for download.
    return { pdfBase64: buffer.toString("base64") };
  },
  async fillImages(markdown) {
    return { markdown: await fillMarkdownImagePlaceholders(markdown) };
  },
};

registerBuiltinDispatch(MARKDOWN_SCOPE, (args) => executeMarkdown({ app: markdownHostApp }, args as unknown as MarkdownDispatchArgs));
