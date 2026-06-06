import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageFeed",
  apiNamespace: "feeds",
  apiRoutes: {
    /** POST /api/feeds/manage — single-action dispatch (register / list
     *  / refresh / remove) used by the MCP bridge + the canvas View. */
    manage: { method: "POST", path: "/manage" },
  },
  // The non-skill feeds registry. Provisioned so the first register
  // doesn't race a missing dir.
  workspaceDirs: { feeds: "feeds" },
  mcpDispatch: "manage",
});
