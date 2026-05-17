// MCP ToolDefinition for `manageEncore`. The argument shape is a
// discriminated union on `kind`; the LLM picks the action it wants
// and supplies the relevant fields. Schema details live in the help
// file (`config/helps/encore-dsl.md`) which the host syncs into the
// workspace at every startup — keeping this `description` short and
// letting Claude lazy-read the help file for full grammar is the
// teaching strategy (see plans/feat-encore-plugin.md "Teaching the
// DSL to Claude").

import type { ToolDefinition } from "gui-chat-protocol";
import type { ResolvedRoute } from "../meta-types";
import { META } from "./meta";

// Derive TOOL_NAME from META so the schema, MCP-bridge dispatch,
// and Vue executor can't drift apart. The host aggregators
// (TOOL_NAMES, API_ROUTES, WORKSPACE_PATHS) read META; everything
// downstream reads from here.
export const TOOL_NAME = META.toolName;

/** Resolved-route shape Encore exposes to the browser via
 *  `pluginEndpoints("encore")`. Derived from META so adding a new
 *  apiRoutes key flows into the type without manual edits. */
export type EncoreEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

/** Action kinds the LLM is allowed to invoke via the MCP tool.
 *
 *  `resolveNotification` is DELIBERATELY excluded from this list:
 *  it's a browser-only action dispatched by the /encore page on
 *  mount (when the user clicks a bell entry). It calls `startChat`
 *  server-side, which would create a brand-new chat if the LLM
 *  invoked it from inside an existing chat — never the right
 *  behavior. The dispatch handler still accepts it (over POST
 *  /api/encore from the page), but the MCP-facing enum hides it.
 *
 *  When adding a new action kind, decide whether the LLM should
 *  call it: if yes, add it here; if it's a browser-internal
 *  dispatch like resolveNotification, leave it out of this list
 *  and only handle it in dispatch.ts. */
export const LLM_ENCORE_KINDS = ["setup", "amendDefinition", "markStepDone", "markTargetSkipped", "recordValues", "query", "appendNote", "snooze"] as const;

/** Every action kind the server-side dispatch handles, including
 *  browser-only ones. Re-exported for the dispatch.ts switch and
 *  for tests; NOT the enum exposed to Claude. */
export const ALL_ENCORE_KINDS = [...LLM_ENCORE_KINDS, "resolveNotification"] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Track recurring obligations (monthly payments, biannual taxes, annual services) defined in the Encore DSL.\n\n" +
    "Actions:\n" +
    "- setup: create a new obligation. Args: { kind: 'setup', definition: <full DSL> }. Encore generates `id` and `createdAt`.\n" +
    "- amendDefinition: update an obligation mid-life. Args: { kind: 'amendDefinition', obligationId, definition: <partial DSL fields to merge> }. Cannot change `type`, `currency`, or `cadence.type`.\n" +
    "- markStepDone: close ONE step on ONE target. Args: { kind: 'markStepDone', obligationId, cycleId, targetId, stepId, values?, pendingId? }. `targetId` is SINGULAR (string). `values` is FLAT { fieldName: value, ... } — never nested by target. If a bundled notification covered multiple targets, call markStepDone ONCE PER TARGET.\n" +
    "- markTargetSkipped: skip a whole target for this cycle. Args: { kind: 'markTargetSkipped', obligationId, cycleId, targetId, pendingId? }.\n" +
    "- recordValues: write partial values without closing. Args: { kind: 'recordValues', obligationId, cycleId, targetId, values, pendingId? }.\n" +
    "- snooze: defer a step's bell entry. Args: { kind: 'snooze', obligationId, cycleId, targetId, stepId, pendingId? }.\n" +
    "- query: read obligations + cycle history. Args: { kind: 'query', obligationId?, range?: 'current' | 'all' | <number>, targetId? }. Response includes workspace-relative paths so you can deep-read raw files.\n" +
    "- appendNote: append free-form notes. Args: { kind: 'appendNote', obligationId, cycleId?, body }. Omit cycleId to append to the obligation's index.md body; include it to append to a specific cycle's body.\n\n" +
    "Bell-entry lifecycle: notifications are NOT auto-cleared on user click. When the user clicks a bell entry the host lands them in a seeded chat with you; you converse, then call markStepDone (or markTargetSkipped / snooze) with the `pendingId` from the seed prompt — that's what clears the bell. Do NOT invent a separate clear/dismiss action.\n\n" +
    "Read `helps/encore-dsl.md` for the full DSL grammar and three worked examples (monthly-payments, real-estate-tax, annual-physical). When composing a setup DSL, the help file is mandatory reference reading.",
  description: "Manage recurring obligations defined in the Encore DSL — payments and services with cadence, targets, steps, and firing plans.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...LLM_ENCORE_KINDS],
        description: "Which Encore action to perform.",
      },
    },
    required: ["kind"],
    // The handler validates the rest of the args per-kind with Zod
    // (see src/plugins/encore/server.ts). Keeping the top-level
    // schema minimal lets Claude compose any shape and surface
    // structural errors via the help-file-pointer messages, rather
    // than fighting a strict JSON-schema validator that doesn't
    // know about cross-field rules.
    additionalProperties: true,
  },
};

export default toolDefinition;
