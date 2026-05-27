# feat(wiki): mc-wiki-deep-lint preset — on-demand LLM lint (RFC #1491 Phase B)

## 背景

RFC #1491 Phase B = **LLM 駆動 lint**。構造 lint
（`mc-wiki-health-check` / Phase D #1523）が拾えない 3 種:

- **contradictions**: ページ間の事実矛盾
- **stale claims**: 日付/状態語が古びた主張
- **missing concepts**: index.md / log.md / sources に出てくる概念で
  `pages/<slug>.md` がまだ無いもの

## 設計判断 — なぜ副作用なしか

- **preset 追加のみ**（`server/workspace/skills-preset/mc-wiki-deep-lint/SKILL.md`）。
  launcher が catalog に sync するだけで ★ star されない限り起動しない
- 起動後にエージェントが叩く操作は **すべて read**（`Read`, `manageWiki`
  の read アクション群、必要なら `lint_report`）。wiki への write なし
- **schedule なし**（Phase D は scheduled・静か、Phase B は on-demand・能動）
- 新規エンドポイント・新規コードなし。SKILL.md 1 ファイルのみ

## 仕様（要約）

1. **読み込み範囲を絞る**: `index.md` + `log.md`（直近~40件）+ 最近変更
   `pages/*.md` 10–20件 + `sources/` タイトル一覧。ユーザー指定が
   あればそちらを優先
2. **3 検査**: contradictions / stale claims / missing concepts。
   ページパスと **該当文を引用**して報告
3. **書かない**: 各 finding はユーザー判断項目（rename/delete/merge/split/
   archive/refresh）。自動修正禁止
4. **クリーン時は静か**: 0 findings → 1行で終了

## 変更ファイル

- `server/workspace/skills-preset/mc-wiki-deep-lint/SKILL.md`（新規・唯一）
- `plans/feat-wiki-deep-lint-1525.md`（このファイル）

ソース変更なし。

## 検証

- `test/workspace/test_skills_preset.ts` の glob ベース sync テストが
  自動で新規 dir を拾う（既存 26 ケース pass）
- `yarn typecheck` green（.md のみ）
- 手動: launcher 起動 → `/skills` Catalog に出現 → ★ star → 任意の
  チャットで "wiki を deep lint" 等と依頼 → 報告のみ返ってきて wiki
  内容は不変であることを確認

## スコープ外（RFC #1491 後続）

- **Phase A**: ingest skill（**書き込みあり**）
- **Phase C**: Query→Page 昇格 UI
- 本 skill の finding に対する自動修正
