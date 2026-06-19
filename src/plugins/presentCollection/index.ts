import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { PresentCollectionData, PresentCollectionArgs } from "./types";
import { TOOL_DEFINITION, TOOL_NAME } from "./definition";
import { executePresentCollection } from "./plugin";
import { wrapWithScope } from "../scope";
// The chat-result View + Preview adapters now live in the package (the ToolPlugin
// entry, shared with MulmoTerminal). The built-in host still wraps them in its
// own plugin scope.
import { PresentCollectionView, PresentCollectionPreview } from "@mulmoclaude/collection-plugin/vue";

const presentCollectionPlugin: ToolPlugin<PresentCollectionData, PresentCollectionData, PresentCollectionArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executePresentCollection,
  generatingMessage: "Loading collection...",
  isEnabled: () => true,
  viewComponent: wrapWithScope("presentCollection", PresentCollectionView),
  previewComponent: wrapWithScope("presentCollection", PresentCollectionPreview),
};

export default presentCollectionPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentCollectionPlugin,
};
