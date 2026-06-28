# Error recovery — when a tool call fails

This is the lookup the agent reads BEFORE asking the user a clarifying
question or giving up on a failing tool call. Each section is keyed by
the error message you'd see in tool output, with the cause and the
documented fix.

Cite the section you used in your reply so the user can follow up
(e.g. "Per `config/helps/error-recovery.md` § gh-auth / SSH …").

If no section here matches, list the workspace's other help files
(`ls config/helps/`) and Read whichever name best matches the failing
area (`sandbox.md`, `github.md`, `collection-skills.md`, etc.) before
falling back to asking the user.

## gh / git / SSH errors inside the sandbox

### Symptoms

- `gh: To authenticate, please run gh auth login`
- `git@github.com: Permission denied (publickey)`
- `Could not resolve host: github.com`
- `Permission denied (publickey)` on `git push` / `git clone <ssh-url>`
- `fatal: Could not read from remote repository`

### Cause

The Claude Code agent runs inside a credential-free Docker sandbox by
default. The host's SSH agent and `gh` config aren't exposed unless the
user opts them in.

### Fix

Tell the user to enable the two opt-in mounts on the next agent spawn
(see also `config/helps/sandbox.md` for the full contract):

```bash
# Forward the host's SSH agent into the container.
# Private keys stay on the host; only the signing oracle is exposed.
SANDBOX_FORWARD_SSH_AGENT=1 \
# Mount allowlisted config files/dirs read-only — including ~/.config/gh.
SANDBOX_MOUNT_CONFIGS=gh \
  yarn dev   # or: npx mulmoclaude
```

Equivalent CLI flags: `--sandbox-forward-ssh-agent --sandbox-mount-configs=gh`.

After restart, inside the agent's first tool turn verify:

```bash
ssh-add -l                      # should list at least one key
gh auth status                  # should report logged in
```

If `ssh-add -l` fails, the host's SSH agent isn't running — tell the
user to start it (`ssh-add ~/.ssh/id_*` on macOS / Linux). If
`gh auth status` fails, the user needs to run `gh auth login` on the
host first (host config is mounted read-only into the sandbox).

### When neither helps

The sandbox itself can be turned off for the session with
`DISABLE_SANDBOX=1 yarn dev` / `--disable-sandbox`. The agent then
inherits the user's full environment. Recommend this only when the
credential mount approach didn't resolve the issue — the sandbox is
the safer default.

## Collection registry — Contribute / Discover failures

### Symptoms

- Contribute flow: `gh pr create` fails, `git push` rejected, or the
  registry clone fails inside `github/`.
- Discover tab loads no entries, or one registry's cards are missing.

### Cause + fix

For the Contribute side, the underlying issue is almost always
sandbox credentials — see the gh/git/SSH section above before anything
else.

For Discover, multi-registry config lives at
`config/collections-registries.json`. A malformed entry there is
silently dropped; check the server log for
`[collections-registry] registry config entry rejected`. The file
format and validation rules are documented in
`config/helps/collection-skills.md` (Contribute bundle layout) and the
shipped registry repo's README. Common rejections:

- URL not HTTPS, or includes embedded credentials.
- `rawBaseUrl` contains a `?` query or `#` fragment.
- `name` reuses the reserved value `official`.
- `name` doesn't match `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`.

## Marp slide PDF — empty / image / font issues

### Symptoms

- PDF export of a Marp deck produces tofu (□□□) for Japanese / CJK text.
- Inline images in a slide are missing from the PDF.
- A custom Marp `theme: <name>` is ignored.

### Fix

CJK fonts (Hiragino on macOS, Yu Gothic / Meiryo on Windows, Noto Sans
CJK on Linux) need to exist on the **host running the server**, not
in the sandbox (PDF render happens server-side via puppeteer). On
Linux: `sudo apt-get install fonts-noto-cjk`. Docker host:
`apt-get install -y fonts-noto-cjk` in the production Dockerfile.

Inline images missing from the PDF: paths must be relative to the
`.md` file, NOT absolute or workspace-rooted. See the "Image
references in markdown / HTML" section of the system prompt for the
rule.

Custom theme ignored: themes live in `~/mulmoclaude/config/marp-themes/<name>.css`.
The filename (sans `.css`) is the theme slug; only `[A-Za-z0-9_-]` is
allowed. Reload the browser tab after adding a theme — preview caches
per session.

## Build / yarn workspace ordering

### Symptoms

- `yarn dev` fails on a fresh clone with
  `Cannot find module '@mulmoclaude/<x>-plugin/server'` or similar.
- A workspace package's `dist/` is missing on first run.

### Fix

```bash
yarn build:packages   # builds every shared workspace package in tier order
yarn dev              # then the dev server picks them up
```

If a specific package keeps failing, build just it:
`yarn workspace @mulmoclaude/<name> run build`. The build pipeline
runs plugins before services so cross-package imports resolve cold.

## Plugin runtime — install / drift

### Symptoms

- A runtime plugin shown in `/skills` doesn't load, or its routes 404.
- After upgrading the plugin host, a previously-installed plugin
  reports a peer-dependency mismatch (e.g. `gui-chat-protocol`
  version skew).

### Fix

Runtime plugins are installed via tgz under `~/mulmoclaude/plugins/`
with a ledger at `plugins/plugins.json`. Reinstall the failing
plugin via the `/skills` UI to refresh both the tgz and the ledger.
A version skew on a peer dep means the plugin was built against an
older host — bump the plugin via the Discover tab's update flow.

## Fallback

If none of the above matches the failing tool output:

1. `ls config/helps/` to see every shipped help file.
2. Pick the file whose name most closely matches the failing area
   (`sandbox.md`, `github.md`, `feeds.md`, `presentation-deck.md`,
   `mulmoscript.md`, `spreadsheet.md`, etc.) and Read it.
3. If you find a fix there, apply it and cite the help by path in
   your reply.
4. If nothing fits, surface the raw error to the user and say
   "no documented fix found in `config/helps/` — could you share more
   context so we can resolve this together?" rather than silently
   guessing or retrying the same command.

## When you discover a new common error

If you resolve a new class of error that other users are likely to
hit, suggest to the user that we extend this file. Don't edit it
yourself — additions to `config/helps/error-recovery.md` are managed
by the project maintainers so the canonical copy in
`packages/core/assets/helps/error-recovery.md` and the installed copy
stay in sync.
