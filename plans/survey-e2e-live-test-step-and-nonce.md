# e2e-live: `test.step` + `testInfo.title` nonce 横展開の要調査

## 動機

PR [#1347](https://github.com/receptron/mulmoclaude/pull/1347) (L-15b 追加) の Sourcery review で以下 2 点が指摘され、L-15b には適用済み:

1. **`test.step` で route ごとにブロック化** — Playwright trace viewer / report に route 単位の独立ノードができ、CI 失敗時に「どのルート」で落ちたかの triage が容易になる
2. **`testInfo.title` を nonce に織り込み** — `data/wiki/pages/` 等に取り残された fixture slug を見ただけで「どのテストが書いたファイルか」が分かる。parallel 実行中の stale 検出と correlation が楽になる

これらは L-15b 固有の改善ではなく、**e2e-live スイート全般に効く改善**。他テストへの横展開を検討する。

## 調査対象

`e2e-live/tests/` 配下の全 spec:

- `media.spec.ts`
- `mulmo-script-edit.spec.ts`
- `roles.spec.ts`
- `session.spec.ts`
- `skills.spec.ts`
- `ui.spec.ts`
- `wiki-nav.spec.ts` (L-15b は適用済み、L-14 / L-15 / L-16 が候補)
- `wiki.spec.ts`
- `workspace-link-routing.spec.ts`

`e2e/tests/` (mock 系) も同様の構造を持つので追加調査の余地あり。ただし e2e-live の方が trace を実環境で読むケースが多いため優先度高。

## 各 spec の見立て (要検証)

| spec | route 数 | 重複量 | `test.step` 化の価値 | nonce 改善の価値 |
|---|---|---|---|---|
| `wiki-nav.spec.ts:L-14` | 1 | 小 | 低 | 中 (stale 識別) |
| `wiki-nav.spec.ts:L-15` | 2 (A / B) | 中 | **高** (L-15b と同形) | 中 |
| `wiki-nav.spec.ts:L-16` | 1 (index → click × 2) | 中 | 中 | 中 |
| その他 spec | 要調査 | 要調査 | 要調査 | 要調査 |

## 調査タスク

1. 各 spec を読み、route / phase が複数ある test を列挙
2. 「同じ assertion パターンが N 回繰り返されている」テストを洗い出す
3. `test.step` 化したときの読みやすさ / trace 改善度合いを weigh
4. nonce が `Date.now()` ベースのみのテストを列挙し、`testInfo.title` 化の cost を見積もる
5. **`test.describe.serial` / `parallel` の境界を犯さないか確認** — `test.step` は同じテスト内で動くので問題なし。nonce 変更は slug 長を変えるので、fuzzy resolver 系テスト (wiki-nav.spec.ts) では collision math が変動しないか要確認 (L-15b では問題なしと確認済み)
6. 1 PR にまとめるか per-spec で分割するか判断

## 注意点

- **L-15 を触る場合**: `nonascii-target` safety token は PR #1319 が「redundancy belt」として残す意図を明記しているため、`test.step` 化 + nonce 改善のみに留め、slug shape は変えない
- **collision-sensitive な spec (L-15 / L-15b)**: nonce 長を変えると `pickFuzzyMatch` の length-ratio score が変動する。安全マージンは大きいが、 数字を plan / コメントに残しておく
- **Skill-level な抽出は不採用方針**: `test.step` 内の assertion 列を helper にまとめる案も Sourcery が出していたが、L-15b では「route-(B) 固有の wikilink click は helper に乗らない」「assertion 列の意図を読者が追いやすい」理由で見送り。横展開でも同じ判断軸を維持する想定。helper 化するならテスト固有のドメインロジックを切り出さない汎用 wrapper (`expectWikiPageBody(target)` 等) に限る

## 完了条件

- 各 spec の見立て (test.step 化 / nonce 改善の要否) が一覧化されている
- 横展開する PR の単位と順序が決まっている
- L-15 (wiki-nav) の `test.step` 化は最優先候補として PR 化

## 関連

- PR #1347 (L-15b 追加 + Sourcery review)
- Issue #1194 (元の wiki fuzzy resolver bug)
- PR #1319 (fix)
