// Thin re-export of the shared package's tool definition. The View /
// Preview / utils moved into @mulmoclaude/markdown-plugin (task #6), but
// the plugin codegen (scripts/codegen-plugin-barrels.ts) scans every
// `src/plugins/*/definition.ts` for a default ToolDefinition export to
// build the MCP/server barrels — so markdown keeps this local shim to
// stay registered.
import { TOOL_DEFINITION } from "@mulmoclaude/markdown-plugin";

export default TOOL_DEFINITION;
export { TOOL_NAME, isFilePath } from "@mulmoclaude/markdown-plugin";
export type { MarkdownToolData } from "@mulmoclaude/markdown-plugin";
