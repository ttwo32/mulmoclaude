import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSkills",
  apiNamespace: "skills",
  apiRoutes: {
    /** GET /api/skills — list every available skill (user + project). */
    list: { method: "GET", path: "" },
    /** GET /api/skills/:name — read one skill's body + frontmatter. */
    detail: { method: "GET", path: "/:name" },
    /** POST /api/skills — create a new project-scope skill. The MCP
     *  bridge posts here. */
    create: { method: "POST", path: "" },
    /** PUT /api/skills/:name — overwrite an existing project-scope
     *  skill. */
    update: { method: "PUT", path: "/:name" },
    /** DELETE /api/skills/:name — delete a project-scope skill. */
    remove: { method: "DELETE", path: "/:name" },
    /** GET /api/skills/catalog — list catalog entries (preset for
     *  now; anthropic / community land in #1335 PR-C). Catalog
     *  entries are NOT in `.claude/skills/` and don't enter the
     *  Claude Code system prompt until the user ★ Stars them. */
    catalogList: { method: "GET", path: "/catalog" },
    /** POST /api/skills/catalog/star — body `{ source, slug }`.
     *  Copies the catalog entry into `.claude/skills/<slug>/` so
     *  Claude Code's slash-command resolver picks it up. */
    catalogStar: { method: "POST", path: "/catalog/star" },
  },
  mcpDispatch: "create",
});
