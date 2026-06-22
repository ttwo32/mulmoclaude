// Shared-package version-bump guard.
//
// The `@mulmoclaude/*` packages under `packages/plugins/` and
// `packages/services/` are consumed by BOTH MulmoClaude and MulmoTerminal,
// and the two apps share one `~/mulmoclaude/` workspace. So a change to one
// of these packages that ships WITHOUT a version bump means the two apps can
// run different published versions against the same data — a cross-app
// data-correctness skew, not just a missing feature (e.g. the `safeRecordId`
// dotted-id rule in collection-plugin: app A writes a record id app B can't
// address). The `@mulmobridge/*` drift check (scripts/mulmoclaude/drift.mjs)
// does NOT cover this scope, so this guard fills the gap.
//
// Rule: if any file under a published `@mulmoclaude/*` package in those two
// dirs changed in this PR, its `version` must differ from the base ref's
// version (i.e. the PR bumped it). Pure git + fs; no install/build needed.
//
// Usage:
//   node scripts/check-shared-pkg-bumps.mjs            # base = origin/main
//   node scripts/check-shared-pkg-bumps.mjs <base-ref> # explicit base
//   BASE_SHA=<sha> node scripts/check-shared-pkg-bumps.mjs   # CI

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const SHARED_DIRS = ["packages/plugins", "packages/services"];
const SCOPE = "@mulmoclaude/";

const base = process.env.BASE_SHA || process.argv[2] || "origin/main";

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8" });
}

/** Files under `dir` that this branch changed since it diverged from `base`
 *  (three-dot = merge-base..HEAD, so a base that moved ahead doesn't count). */
function changedUnder(dir) {
  const out = git(["diff", "--name-only", `${base}...HEAD`, "--", dir]).trim();
  return out ? out.split("\n") : [];
}

/** `version` of a package.json as it exists at `base`, or null when the file
 *  didn't exist there (a brand-new package — nothing published to skew). */
function versionAtBase(pkgJsonRelPath) {
  try {
    return JSON.parse(git(["show", `${base}:${pkgJsonRelPath}`])).version ?? null;
  } catch {
    return null;
  }
}

const failures = [];
for (const root of SHARED_DIRS) {
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root)) {
    const pkgJsonRel = path.join(root, name, "package.json");
    if (!existsSync(pkgJsonRel)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonRel, "utf-8"));
    if (!pkg.name?.startsWith(SCOPE) || pkg.private === true) continue;
    if (changedUnder(path.join(root, name)).length === 0) continue;
    const baseVersion = versionAtBase(pkgJsonRel);
    if (baseVersion !== null && pkg.version === baseVersion) {
      failures.push({ name: pkg.name, version: pkg.version });
    }
  }
}

if (failures.length > 0) {
  console.error(`Shared @mulmoclaude/* package(s) changed without a version bump (base: ${base}):\n`);
  for (const f of failures) console.error(`  ✗ ${f.name} — changed but version is still ${f.version} (same as base)`);
  console.error(`\nBump each package's "version" in its package.json (publish on the next cascade).`);
  console.error("These are consumed by BOTH MulmoClaude and MulmoTerminal and share workspace data,");
  console.error("so an unbumped change ships a version skew between the two apps.");
  process.exit(1);
}

console.log(`✓ all changed @mulmoclaude/* shared packages are version-bumped vs ${base}`);
