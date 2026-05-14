# L-15b: #1194 衝突条件の end-to-end repro

## 背景

[#1194](https://github.com/receptron/mulmoclaude/issues/1194) は PR [#1319](https://github.com/receptron/mulmoclaude/pull/1319) で fix 済み (`server/api/routes/wiki.ts:pickFuzzyMatch`)。

既存カバレッジ:

- **Unit** — `test/routes/test_wikiResolveFuzzy.ts` (7 ケース、全ブランチ pin)。十分。
- **e2e-live** — `e2e-live/tests/wiki-nav.spec.ts:72` の **L-15** が新 resolver 経路を通る。**ただし**、target slug に `nonascii-target` という unique token が入っているため、`-${projectSlug}-${nonce}` 共通 suffix を真に共有する状況にはなっていない。PR 本文も「load-bearing からは降りた redundancy belt」と明記している。

## 不足

「target slug と source slug が共通 suffix だけを共有し、wikiSlugify 後の slug が両 key に partial-match する」という #1194 オリジナルの衝突条件を end-to-end で再現する spec が無い。

## 提案

`e2e-live/tests/wiki-nav.spec.ts` に **L-15b** を追加。L-15 はそのまま残す (regression belt 兼 navigation 一般のカバー)。

### 設計

- target slug = `日本語タイトル-${projectSlug}-${nonce}` (unique token なし)
- source slug = `e2e-live-l15b-source-${projectSlug}-${nonce}`
- 共通 suffix: `-${projectSlug}-${nonce}` ← wikiSlugify(target) の出力そのもの
- 両 key に対し `key.includes(slug)` が true になる

### 期待される resolver 挙動 (`pickFuzzyMatch`)

- `slug` (≈ `-chromium-...`) の長さ ≥ MIN_FUZZY_SLUG_LEN (6)
- score(slug, target key) = `min/max` ≈ 0.8 (Japanese 7 字 + 共通 suffix)
- score(slug, source key) = `min/max` ≈ 0.57 (`e2e-live-l15b-source-` 20 字 + 共通 suffix)
- → target が高スコアで勝つ。決定的。

### Seed 順

source → target の順で seed (元 bug repro 時と同じ順)。readdir order に依存していた pre-#1319 挙動を再現する条件。

### Assertion

- `wiki-page-body` testid に **target marker** が含まれる (positive)
- `wiki-page-body` に **source marker** が含まれない (negative — #1194 regression shape を直撃)
- URL が `/wiki/pages/<encoded target>$` で終わる
- URL が `/chat` 配下に流れていない (catch-all router B-24 系の負ガード、L-14/L-15 と shape を揃える)

## 不採用案

- **L-15 を改修 (`nonascii-target` 削除)** — PR #1319 が「safety belt として残す」と明言している意図を覆すため不採用。新規 spec で独立にカバーする方が clean。
- **手動 QA のみ** — issue コメントが「QA を」だが、自動回帰がないと将来の readdir 挙動変更で silent 再発する。

## 実装スコープ

- 1 ファイル: `e2e-live/tests/wiki-nav.spec.ts` に test ブロック追加のみ
- timeout: 既存 `L15_TIMEOUT_MS = ONE_MINUTE_MS` を流用 (L15B 用に別定数を切る必要なし、同じ shape のテスト)
- import 追加なし (L-15 と同じヘルパで完結)

## 注意点 / Items to Confirm

- **Seed 順序依存ではない** — `pickFuzzyMatch` は length-ratio スコアで決定的なので、source/target どちらを先に seed しても結果は変わらない。「source 先 seed」は単に元バグの再現条件を踏襲しているだけ。
- **`projectSlug` (`chromium` / `webkit` etc.) の長さ依存** — 共通 suffix が長くなりすぎると target key の長さに対する score 差が縮む可能性がある。現状の projectSlug + nonce 長 (約 28 字) と target key 長 (35 字) のバランスでは安全マージンあり。極端に短い projectSlug が将来追加されたら見直し対象。
- **Japanese chars 部分の長さ** — `日本語タイトル` (7 字) は target key 長を意図的に slug 長に近づけるための値。短くしすぎると source 側にスコアが寄る。

## Test plan

- [ ] `yarn typecheck` clean
- [ ] `yarn lint` clean
- [ ] `yarn format` 適用済み
- [ ] (Manual / CI) e2e-live live 環境で chromium + webkit の両 project で pass
