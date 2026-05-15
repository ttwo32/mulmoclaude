# fix #1074 — presentMulmoScript: beat 編集が再表示時に消える問題

## 背景

`presentMulmoScript` view で beat を JSON 編集 → 「更新」 ボタン押下 → 別セッションを開き直す（または `/wiki` 経由でブラウザリロード）と、disk に書き込まれた編集が view に反映されず編集前の内容に戻ってしまう。

## 根本原因

`server/api/routes/mulmo-script.ts` の `update-beat` ハンドラは `writeJsonAtomic` で disk へ正しく永続化する。しかしクライアント (`src/plugins/presentMulmoScript/View.vue`) 側では:

1. `updateBeat()` は `localOverrides[index] = beat` で in-memory に上書きするだけで、`emit("updateResult", ...)` を呼んでいない (`applySource()` とは挙動が違う)。
2. `localOverrides` は `initializeScript()` で毎マウント時にクリアされる。
3. `props.selectedResult.data.script` は 「ツールが最初に走ったとき」 の古いスナップショットのまま。
4. ブラウザリロード時、`/api/sessions/:id` の JSONL から session を復元すると `entry.result` をそのまま使うので、ここで読まれる `data.script` は古いまま。
5. View は `script.value = data.value?.script` を描画するため、disk が新しくても **画面上は古い** という乖離が発生する。

つまり 「disk vs in-memory toolResult の不整合」 が #1074 の本体。e2e-live の L-EDIT が観測した `Saving…` が消えない問題は別件 (test 側の wait 条件が間違っていて、保存後 `sourceOpen[index]=false` で textarea が DOM から消えるため `toBeEnabled` がタイムアウトしている)。

## 修正方針

**Disk を source of truth にする。** `presentMulmoScript` View を mount するたびに `filePath` から `apiGet(filesEndpoints.content)` で disk の最新内容を取得し、`mulmoScriptSchema` で検証して、 props の値と差分があれば `emit("updateResult", ...)` で in-memory toolResult を更新する。

`mulmoScript.save` の reopen path (`{ filePath }`) と挙動を揃える形になる。 副作用 (autoGenerateMovie 等) は呼ばないので mount 時の追加コストは files API 1 本のみ。

### 実装範囲

- `src/plugins/presentMulmoScript/helpers.ts`
  - `parseDiskScript(raw: string): MulmoScriptParseResult` — 文字列 → script への純粋関数。invalid JSON / schema 不一致をそれぞれ識別する discriminated union。
- `src/plugins/presentMulmoScript/View.vue`
  - `refreshScriptFromDisk()` を追加 — `filePath.value` 経由で disk を読み、新しければ `emit("updateResult", ...)`。
  - `initializeScript()` の冒頭 (state リセット直後、 per-beat hydrate より前) で `await refreshScriptFromDisk()`。
- `e2e-live/tests/mulmo-script-edit.spec.ts`
  - `test.skip(true, ...)` を削除。
  - クリック後の wait 条件を 「textarea が detach される」 に変更（`toBeEnabled` だと DOM から消えた瞬間に retry し続けてタイムアウトする）。
- `test/plugins/presentMulmoScript/helpers.test.ts` (新規)
  - `parseDiskScript` の happy path / invalid JSON / schema 不一致 / 空文字列。

### 影響範囲

- `presentMulmoScript` view のみ。 他の plugin に波及しない。
- 既存ツール結果には変化なし (パースに失敗したらスキップして props のままを使う)。
- `mulmoScript.save` の reopen path とは別ルート (file content API)。 schema 検証は client 側で行う。

## TODO

- [x] 根本原因の特定
- [x] plan 作成
- [x] `helpers.ts` に `parseDiskScript` / `isSameScript` 抽出
- [x] `View.vue` の `initializeScript` に refresh ロジック追加 (stale-response guard 込み)
- [x] unit test (`test_helpers.ts`) 追加
- [x] e2e-live spec の wait 条件修正 (`toBeHidden`) + `test.skip` 解除
- [x] `yarn format / lint / typecheck / build / test`
- [x] codex-cross-review iteration 1: race condition 指摘を受けて `requestedUuid` / `requestedFilePath` キャプチャ + post-await re-check を追加
- [x] codex-cross-review iteration 2: LGTM
- [x] 手動で chromium に対し e2e-live を回して PASS することを確認 — `yarn test:e2e:live:mulmo-script-edit --project=chromium` で 18s で PASS (worktree の yarn dev に対して)
- [ ] PR 作成
