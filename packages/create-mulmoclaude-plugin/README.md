# create-mulmoclaude-plugin

Scaffold a new MulmoClaude runtime plugin.

```bash
npx create-mulmoclaude-plugin my-plugin
# or
npx create-mulmoclaude-plugin @example/cool-plugin
```

Creates a directory in the current working directory with a runnable
counter sample plugin: server-side `definePlugin` factory, `View.vue`
canvas component, plugin-local i18n, and the build / lint config the
in-tree reference plugins (`bookmarks-plugin`, `accounting-plugin`)
use.

The output is a starting point — rename the tool, replace the counter
logic with whatever your plugin actually does, ship.

## Output

```text
my-plugin/
  package.json           name set to your argument; peer-deps and scripts ready
  tsconfig.json
  vite.config.ts         two bundles: dist/index.js (server) + dist/vue.js (browser)
  eslint.config.mjs      extends gui-chat-protocol/eslint-preset
  .gitignore
  README.md              dev-loop instructions for your new plugin
  src/
    index.ts             definePlugin factory + sample handler
    definition.ts        TOOL_DEFINITION shared between server + browser
    vue.ts               browser entry: { toolDefinition, viewComponent }
    View.vue             canvas SFC using useRuntime() + dispatch + pubsub
    shims-vue.d.ts
    lang/
      en.ts ja.ts        translation tables
      index.ts           useT() composable reading runtime.locale
```

## Next steps after scaffolding

```bash
cd my-plugin
yarn install
yarn build
```

To develop against MulmoClaude, hand the plugin's project dir to
the launcher with `--dev-plugin`:

```bash
# Terminal A — keep dist/ fresh on every save
cd my-plugin
yarn dev          # vite build --watch

# Terminal B — start mulmoclaude with the dev plugin loaded
mulmoclaude --dev-plugin /abs/path/to/my-plugin
# or, repeat for multiple
mulmoclaude --dev-plugin ./my-plugin --dev-plugin ../other-plugin
```

The plugin appears in the runtime registry under its `package.json`
name with version `dev` and is served straight from your `dist/`. Edit
source → vite rebuilds → **the browser auto-reloads** to pick up the
new bundle.

Hard-fails fast on:
- Missing `dist/index.js` (run `yarn build` or `yarn dev` first).
- Name collision between the dev plugin and an installed (published)
  one — both abs paths are logged so you can see what conflicted.

Server-side caveat: when you change `src/index.ts` (the `definePlugin`
factory), vite rebuilds `dist/index.js` and the browser reloads, but
Node's ESM cache holds the old server-side module. The mulmoclaude log
prints `dist/index.js changed — restart mulmoclaude to pick up
server-side changes` so you know to Ctrl+C and restart the launcher.
Pure browser-side edits (`View.vue`, CSS, lang/) hot-load without a
restart.

## Why a sample, not an empty plugin

Every line of the counter sample exists because a plugin author
needs to know *how* to do that thing. Boilerplate is fine if it
demonstrates the runtime API surface. The trade-off is a handful of
deletions when you're ready to write your real plugin — small price
for not having to reverse-engineer the API on day one.

## License

MIT
