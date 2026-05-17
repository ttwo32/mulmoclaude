// Encore plugin registration — built-in, single MCP tool
// (`manageEncore`) + a transient chat-on-mount View at `/encore`.
//
// The View has one job: when the user clicks an Encore bell entry,
// they land on /encore?pendingId=<uuid>, the View mounts, dispatches
// `resolveNotification` (which calls chat.start server-side), and
// redirects to /chat/<chatId>. The user never actually sees the
// page beyond a ~300ms "Starting chat…" line. This defers chat
// creation to the user's click — the tick never calls chat.start
// directly, so no abandoned chats appear in the sidebar.
//
// Notification clearing is the LLM's job in the resulting chat
// (calls markStepDone with the pendingId; handler reads the
// pending-clear ticket and clears the bell).
//
// The MCP-side `execute` posts to /api/encore (apiNamespace from
// META) so the LLM-facing MCP bridge and the in-page dispatch
// share one server handler.
//
// See plans/feat-encore-as-builtin.md for the build plan and
// plans/feat-encore-plugin.md for the DSL spec / design decisions.

import type { ToolResult } from "gui-chat-protocol";
import type { PluginEntry, PluginRegistration, ToolPlugin } from "../../tools/types";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";
import View from "./View.vue";
import definition, { TOOL_NAME, type EncoreEndpoints } from "./definition";
import { META } from "./meta";

export interface EncoreData {
  kind?: string;
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}

const execute: ToolPlugin<EncoreData>["execute"] = async function execute(_context, args) {
  const endpoints = pluginEndpoints<EncoreEndpoints>(META.apiNamespace);
  const { method, url } = endpoints.dispatch;
  const result = await apiCall<ToolResult<EncoreData>>(url, { method, body: args });
  if (!result.ok) {
    return {
      toolName: TOOL_NAME,
      uuid: makeUuid(),
      message: result.error,
    };
  }
  return {
    ...result.data,
    toolName: TOOL_NAME,
    uuid: result.data.uuid ?? makeUuid(),
  };
};

export const manageEncorePlugin: ToolPlugin<EncoreData> = {
  toolDefinition: definition,
  execute,
  isEnabled: () => true,
  generatingMessage: "Updating Encore...",
  viewComponent: wrapWithScope("encore", View),
};

const encorePluginEntry: PluginEntry = manageEncorePlugin as unknown as PluginEntry;

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: encorePluginEntry,
};

export default manageEncorePlugin;
