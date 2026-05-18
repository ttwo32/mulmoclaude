// MCP ToolDefinition for `defineEncore` — the structural tool that
// composes or modifies an Encore DSL document.
//
// Discriminator: `obligationId` presence.
//   - absent → setup (server generates `id` from `displayName`,
//     rejects with 409 if the slug collides with an existing
//     obligation — see `requireUniqueObligationId` in dispatch.ts)
//   - present → amend the named obligation (shallow-merge top-level)
//
// The choice to use parameter PRESENCE as the discriminator (instead
// of a `kind: "setup" | "amendDefinition"` enum) gives the LLM a
// natural mental model: "I have an id" / "I don't". The setup vs
// amend intent IS the parameter shape, no redundant flag.
//
// `dsl` is declared as `{ type: "object" }` here — telling the LLM
// "this is an object literal, not a JSON-encoded string" without
// embedding the full nested schema. Field-level shape is documented
// in `helps/encore-dsl.md` and validated server-side via Zod
// (`EncoreDslInput.parse`).
//
// A fully-typed `dsl` JSON Schema (auto-derived from the Zod
// validator via `z.toJSONSchema(EncoreDslInput)`) would be the ideal
// next step, but the eslint `no-restricted-imports` rule forbids
// plugin code from importing server-side modules. Moving the DSL
// schema to a plugin-safe shared package is its own follow-up; see
// plans/feat-encore-define-tool.md "Out of scope".

import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./defineEncoreMeta";

export const TOOL_NAME = META.toolName;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Use defineEncore to compose a NEW Encore obligation (no `obligationId` argument) or AMEND an existing one (pass its `obligationId`). " +
    "The `dsl` argument is an OBJECT LITERAL — never a JSON-encoded string. " +
    "Setup: provide the complete DSL document (version / displayName / type / cadence / targets / steps / formSchema). " +
    "Amend: provide ONLY the top-level fields you want to change — the server shallow-merges onto the existing DSL. " +
    "Read `helps/encore-dsl.md` for the full grammar, severity rules, and worked examples.",
  description:
    "Compose a new Encore obligation, or amend an existing one (pass obligationId). Operational actions (markStepDone, snooze, query, …) live on the sibling manageEncore tool.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["defineEncore"],
        description: "Fixed value; the tool's only kind.",
      },
      dsl: {
        type: "object",
        description:
          "Encore DSL document (OBJECT LITERAL — do NOT pass a JSON-encoded string). " +
          "For setup (no obligationId): provide the full DSL (version / displayName / type / cadence / targets / steps / formSchema). " +
          "For amend (with obligationId): provide ONLY the top-level fields you want to change — others are preserved from the existing DSL. " +
          "See `helps/encore-dsl.md` for the field-level grammar and worked examples. Field-level validation runs on the server; missing or malformed fields surface as 400 errors with field-path-aware messages.",
        additionalProperties: true,
      },
      obligationId: {
        type: "string",
        description:
          "Present → amend the named obligation. Absent → setup a new one (server generates the id from displayName). If you intend to amend but forget this, the server rejects with 409 and tells you the id to pass.",
      },
    },
    required: ["kind", "dsl"],
    additionalProperties: false,
  },
};

export default toolDefinition;
