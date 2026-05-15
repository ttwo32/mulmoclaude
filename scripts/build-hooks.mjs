// Bundle every wiki/* hook source TS into a self-contained ESM
// file under `server/workspace/wiki-history/hook/`. Run as
// `yarn build:hooks` (also chained from `yarn build`).
//
// Why a build step rather than esbuild-at-server-start: the
// bundles are committed to git, so the runtime has zero esbuild
// cost and the JS that ships is the JS that was reviewed in CI.
// Pre-#951 the hook lived as a JS-as-string template literal in
// `hookScript.ts`; refactoring to TS source + bundle lets the
// hook share `wikiSlugFromAbsPath` (and any future helpers) with
// the server route via plain TS imports.
//
// The bundle is always produced fresh — esbuild is fast (~50ms
// per entry) so there's no value in incremental skip logic.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Each entry: { src, out } — `src` is the TS source, `out` is
// where the bundled .mjs is written. Both are relative to repo
// root for stable error messages.
const ENTRIES = [
  {
    src: "server/workspace/hooks/dispatcher.ts",
    out: "server/workspace/hooks/dispatcher.mjs",
  },
];

const SHEBANG = "#!/usr/bin/env node\n";

async function buildEntry({ src, out }) {
  const absSrc = path.join(repoRoot, src);
  const absOut = path.join(repoRoot, out);
  await build({
    entryPoints: [absSrc],
    outfile: absOut,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // The hook runs in whatever Node the Claude CLI launches it
    // with. Source maps are tiny and worth committing — they make
    // the bundled .mjs debuggable as the original TS.
    sourcemap: "inline",
    // `#!/usr/bin/env node` shebang so the hook is executable
    // when the workspace's `.claude/hooks/` dir copies the file
    // (matches the existing chmod 0o700 behaviour from
    // provision.ts).
    banner: { js: SHEBANG.trimEnd() },
  });
  console.log(`[build:hooks] ${src} -> ${out}`);
}

async function main() {
  for (const entry of ENTRIES) {
    await buildEntry(entry);
  }
}

await main();
