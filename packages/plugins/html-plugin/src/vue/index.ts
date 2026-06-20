import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { HtmlArgs, PresentHtmlData } from "../core/types";
import { pluginCore } from "../core/plugin";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<PresentHtmlData, PresentHtmlData, HtmlArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { HtmlArgs, PresentHtmlData, UpdateHtmlArgs } from "../core/types";
export type { HtmlDispatchArgs, HtmlDispatchResult, LoadHtmlArgs, SaveHtmlArgs } from "../core/contract";
export { TOOL_NAME, TOOL_DEFINITION } from "../core/definition";
export { executeHtml, executeHtmlUpdate, pluginCore, type HtmlExecuteContext } from "../core/plugin";
export { executeHtmlDispatch, type HtmlDispatchContext } from "../core/dispatch";
export { View, Preview };

export default { plugin };
