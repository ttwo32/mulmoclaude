import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type FeedsEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

/** One row in the feeds list returned by every manageFeed action. */
export interface FeedSummary {
  slug: string;
  title: string;
  icon: string;
  kind: string;
  schedule: string;
  lastFetchedAt: string | null;
}

export interface FeedRefreshSummary {
  slug: string;
  written: number;
  errors: string[];
}

export interface ManageFeedData {
  feeds: FeedSummary[];
  /** Set on register to highlight the new feed. */
  highlightSlug?: string;
  /** Set on register/refresh so the View can flash the run result. */
  lastRefresh?: FeedRefreshSummary;
}

const manageFeedPlugin: ToolPlugin<ManageFeedData> = {
  toolDefinition,
  async execute(_context, args) {
    const endpoints = pluginEndpoints<FeedsEndpoints>("feeds");
    const { method, url } = endpoints.manage;
    const result = await apiCall<ToolResult<ManageFeedData>>(url, { method, body: args });
    if (!result.ok) {
      return { toolName: TOOL_NAME, uuid: makeUuid(), message: result.error };
    }
    return { ...result.data, toolName: TOOL_NAME, uuid: makeUuid() };
  },
  isEnabled: () => true,
  generatingMessage: "Managing feeds…",
  viewComponent: wrapWithScope("feeds", View),
  previewComponent: wrapWithScope("feeds", Preview),
};

export default manageFeedPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: manageFeedPlugin,
};
