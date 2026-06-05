# claude.ai MCP コネクタのセットアップ / claude.ai MCP Connector Setup

最終確認 / Last verified: 2026-05-28 (CLI 2.1.163)
関連 PR / Related: [#1618](https://github.com/receptron/mulmoclaude/pull/1618) (`--strict-mcp-config` 撤廃で MulmoClaude が connector を見えるようにした) / dropped `--strict-mcp-config` so MulmoClaude inherits the user's connectors

## 概要 / Overview

**JA**: claude.ai が公式にホストしている **MCP コネクタ**（Gmail / Google Calendar / Google Drive / Slack / Canva / 他）を、Claude Code CLI 経由で 1 回認証しておくと、その後 MulmoClaude のエージェントからもそのコネクタの全ツールが呼べるようになります。認証情報は **claude.ai アカウントレベルで永続化**するので、別マシン / 別 Claude Code セッションでも同じアカウントなら有効。

**EN**: Anthropic hosts a small but growing set of **MCP connectors** (Gmail, Google Calendar, Google Drive, Slack, Canva, …). Authorise each one **once** via the `claude` CLI's interactive `/mcp` panel and every future Claude Code session for the same claude.ai account — including the agent that MulmoClaude spawns — sees that connector's full tool surface.

## 1. 認証フロー / Authentication flow

```bash
# 1. ターミナルで claude (対話モード) を起動 / launch claude in interactive mode
claude

# 2. /mcp と入力 / type /mcp
> /mcp
```

**JA**: `/mcp` パネルが開き、有効化済み・要認証・無効の MCP サーバ一覧が表示されます。

**EN**: The `/mcp` panel opens with the list of MCP servers, each tagged as connected / needs auth / disabled.

サンプル / Example output:

```text
Manage MCP servers
5 servers

  claude.ai
  claude.ai Gmail            · ✔ connected · 12 tools
> claude.ai Google Calendar  · ✔ connected · 8 tools
  claude.ai Google Drive     · △ needs authentication
  claude.ai Slack            · ✔ connected · 19 tools

  Built-in MCPs (always available)
  computer-use               · ◯ disabled
```

ステップ / Steps:

1. **JA**: 矢印キーで認証したい connector（`△ needs authentication` 表示のもの）を選択 → Enter
   **EN**: Use ↑/↓ to select a `△ needs authentication` entry, then Enter.
2. **JA**: ブラウザが自動で開き Google / Slack 等の OAuth 同意画面に遷移 → 承認
   **EN**: A browser tab opens with the provider's OAuth consent screen. Approve.
3. **JA**: ターミナルに戻ると `✔ connected · N tools` に変わっていれば完了
   **EN**: Back in the CLI, status flips to `✔ connected · N tools`.

リモート SSH 環境などブラウザが自動で開かない場合は、URL がコピー可能な形で表示されるので別マシンで開いて完了させ、コールバック URL を貼り戻す形になります（CLI 側の指示に従う）。

If the browser cannot launch (remote SSH etc.), the CLI prints a copyable URL — open it on a local browser, complete OAuth, then paste the callback URL back as instructed.

## 2. 設定の保存場所 / Where settings live

| パス / Path | 役割 / Role |
|---|---|
| `~/.claude.json` → `claudeAiMcpEverConnected` | 過去に enable したコネクタ表示名の履歴リスト / array of connector display names ever enabled |
| `~/.claude.json` → `oauthAccount` | claude.ai ログイン ID（どのアカウントの connector か） / claude.ai login identity binding the connector tokens |
| `~/.claude/.credentials.json` (mode 0600) | claude.ai ログイントークン本体 / claude.ai session credential |
| `~/.claude/mcp-needs-auth-cache.json` | 「要認証」状態のコネクタとサーバ id / connectors currently in `needs-auth` state |
| **claude.ai サーバ側** / claude.ai backend | **実際の OAuth トークンと scope** / **actual OAuth tokens and scopes** |

**JA**: 重要なのは「**実体は claude.ai サーバ側で管理されている**」点です。ローカルファイルは履歴・ログイン証明・キャッシュだけで、connector 自身のトークンを編集できる場所ではありません。connector の追加 / 削除は必ず `claude /mcp` UI 経由で行います。

**EN**: The important point: **the connector OAuth tokens and scopes live server-side at claude.ai**, not in any local file you can edit. Local files only carry the claude.ai login credential and metadata. Always add / remove / re-authorise connectors through `claude /mcp`, never by editing files.

## 3. 一覧確認とトラブルシュート / Listing & troubleshooting

### `claude mcp list`

```bash
claude mcp list
```

```text
claude.ai Slack:            https://mcp.slack.com/mcp                    - ✔ Connected
claude.ai Gmail:            https://gmailmcp.googleapis.com/mcp/v1       - ✔ Connected
claude.ai Google Drive:     https://drivemcp.googleapis.com/mcp/v1       - ! Needs authentication
claude.ai Google Calendar:  https://calendarmcp.googleapis.com/mcp/v1   - ✔ Connected
```

各 connector が HTTP MCP エンドポイントとして公開されていることが分かります。

The output reveals each connector is exposed as an HTTP MCP endpoint.

### よくある状態 / Common states

| 状態 / Status | 意味 / Meaning | 対処 / Action |
|---|---|---|
| `✔ Connected` | OAuth 有効・ツール利用可 / OAuth live, tools callable | — |
| `! Needs authentication` | OAuth が無いか失効 / OAuth missing or expired | `/mcp` → 選択 → 再認証 / re-authorise via `/mcp` |
| `(pending)` (init message のみ) | HTTP MCP ハンドシェイク待ち / HTTP MCP handshake in flight | 数秒〜十数秒で `connected` に遷移 / will flip to connected shortly |
| `◯ disabled` | ユーザが明示的に無効化 / explicitly disabled | `/mcp` で再 enable / re-enable via `/mcp` |

### 「すぐに使えない」場合の典型 / Frequent "doesn't work yet" cases

- **JA**: 認証直後の最初のセッション → connector 由来ツールが Tool 一覧に**まだ載っていない**ことがある。Claude Code セッションを 1 回開き直すか、数秒待ってから再試行
- **EN**: First session right after authorising — connector tools may not appear in the tool list yet. Re-open the Claude Code session or wait a few seconds and retry
- **JA**: トークン失効 → `! Needs authentication` 表示に戻る。`/mcp` で再選択して再 OAuth
- **EN**: Token expired — entry flips back to `! Needs authentication`. Re-select it in `/mcp` and re-OAuth

## 4. ツール命名規則 / Tool naming convention

connector が公開するツールは `mcp__<server-id>__<tool-name>` 形式で agent に露出します。`<server-id>` は表示名のスペースとピリオドを `_` に置換したもの。

Connector tools surface to the agent as `mcp__<server-id>__<tool-name>`. The `<server-id>` is the display name with whitespace and dots replaced by `_`.

| 表示名 / Display name | server-id | ツール例 / Example tool |
|---|---|---|
| `claude.ai Gmail` | `claude_ai_Gmail` | `mcp__claude_ai_Gmail__send_message` |
| `claude.ai Google Drive` | `claude_ai_Google_Drive` | `mcp__claude_ai_Google_Drive__list_recent_files` |
| `claude.ai Google Calendar` | `claude_ai_Google_Calendar` | `mcp__claude_ai_Google_Calendar__list_events` |
| `claude.ai Slack` | `claude_ai_Slack` | `mcp__claude_ai_Slack__send_message` |

`--allowedTools` で扱える形式の詳細は [`docs/claude-code-allowed-tools.md`](./claude-code-allowed-tools.md) を参照。

For acceptable `--allowedTools` shapes (per-server shorthand, glob, etc.), see [`docs/claude-code-allowed-tools.md`](./claude-code-allowed-tools.md).

## 5. MulmoClaude からの利用 / Using from MulmoClaude

**JA**: PR [#1618](https://github.com/receptron/mulmoclaude/pull/1618) のマージ後、MulmoClaude のエージェントは spawn する `claude` プロセスに `--strict-mcp-config` を渡さなくなったので、`/mcp` で認証済みの connector ツールが自動的に session の `init.mcp_servers` に乗ります。`--mcp-config` で渡している MulmoClaude 自身の broker と**共存**します（CLI 2.1.163 で動作確認済み）。

**EN**: Since [#1618](https://github.com/receptron/mulmoclaude/pull/1618) landed, MulmoClaude no longer passes `--strict-mcp-config` to the spawned `claude`, so any connector you have authorised via `/mcp` is auto-merged into the session's `init.mcp_servers` alongside MulmoClaude's own broker.

### 期待される挙動 / Expected behaviour

1. **JA**: ユーザが `claude /mcp` で connector を authorize（1 回限り）
   **EN**: User authorises the connector via `claude /mcp` (one-time)
2. **JA**: MulmoClaude を起動。エージェントが新規ターンを開始
   **EN**: Launch MulmoClaude. The agent starts a new turn
3. **JA**: agent は `mcp__claude_ai_*` ツールを直接呼べる（pre-allow されているため `--allowedTools` ゲートを通る）
   **EN**: The agent can call `mcp__claude_ai_*` tools directly (they're in the pre-allow list)
4. **JA**: 例: 「最近の Drive ファイルを 5 件挙げて」と頼むと agent が `mcp__claude_ai_Google_Drive__list_recent_files` を発火 → 結果が右ペインに表示
   **EN**: Example: ask "list my 5 most recent Drive files" — the agent fires `mcp__claude_ai_Google_Drive__list_recent_files` and shows the result in the right pane

### 既知のトレードオフ / Known trade-off

**JA**: 現在 MulmoClaude は connector まるごと（read 系も write/delete 系も）を `--allowedTools` で pre-allow しています。これは「prompt なしで自然に使える」体験のためですが、**プロンプトインジェクション攻撃で `Gmail.send_message` 等が無確認で発火するリスク**を伴います。粒度のある同意 UI（read は自動 / write は確認）は将来 issue で改善予定。気になる場合は `server/agent/config.ts` の `CLAUDE_AI_CONNECTOR_SERVERS` を編集すれば一時的に空にできます。

**EN**: As of writing, MulmoClaude pre-allows every connector tool (read AND write/delete) via `--allowedTools` for friction-free UX. This means a **prompt-injection attack could trigger `Gmail.send_message`, `Drive.delete_file`, etc. without user confirmation**. A per-tool consent UI (auto-allow reads, prompt on writes) is tracked as a follow-up. To opt out today, empty `CLAUDE_AI_CONNECTOR_SERVERS` in `server/agent/config.ts`.

## 6. Connector を切る / Disabling a connector

```bash
claude
> /mcp
# Select the connector, then choose "Disable" / "Disconnect"
```

**JA**: claude.ai 側で connector が `disabled` になり、以後どの Claude Code セッションからも見えなくなります。再有効化は同じパネルから。

**EN**: The connector flips to `disabled` server-side at claude.ai and disappears from every future Claude Code session. Re-enable from the same panel.

## 7. 参考 / References

- Permissions: <https://code.claude.com/docs/en/permissions.md>
- MCP: <https://code.claude.com/docs/en/mcp.md>
- MulmoClaude side wiring: [`server/agent/config.ts`](../server/agent/config.ts) (`buildCliArgs`, `CLAUDE_AI_CONNECTOR_SERVERS`)
- Allowed-tools vocabulary: [`docs/claude-code-allowed-tools.md`](./claude-code-allowed-tools.md)
