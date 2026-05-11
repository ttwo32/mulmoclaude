# feat: /skills ページに skill カテゴリのグルーピング/開閉を追加

## 背景

`/skills` ページ ([src/plugins/manageSkills/View.vue](../src/plugins/manageSkills/View.vue)) は現状、全 skill を**アルファベット順フラットリスト**で表示している。実際には次の 3 種類が混在しており、ユーザーは「何が編集可能で、何が触らない方が良いか」をぱっと見で判別できない。

1. **Project (Built-in)** — `mc-` プレフィックスを持つ project skill（mulmoclaude が同梱）
2. **Project (Yours)** — それ以外の project skill（ユーザーが作成、編集/削除可能）
3. **User (Global)** — `~/.claude/skills/` 配下の user skill（編集不可）

バックエンド (`server/workspace/skills/types.ts`) は `source: "user" | "project"` の 2 値しか返さない。Built-in / Yours の判別は **フロント側で `name` の `mc-` プレフィックスを見る**だけで完結する。

## 仕様

### カテゴリ判定

| キー | 条件 | 初期状態 |
|---|---|---|
| `builtin` | `source === "project"` && `name.startsWith("mc-")` | closed |
| `project` | `source === "project"` && それ以外 | open |
| `user` | `source === "user"` | open |

セクション順は固定: `builtin` → `project` → `user`。

各セクション内は `localeCompare` で名前順。

### サイドバー UI

- 各カテゴリの先頭にクリック可能なセクションヘッダー（chevron + ラベル + count）
- ヘッダークリックで開閉
- 開閉状態は `localStorage` (`skills:groupCollapsed`) に `string[]` で保存
- 空カテゴリのヘッダーは描画しない
- 現在の `source` 小文字バッジ (View.vue line 31-33) は冗長なので削除

### 触らないもの

- バックエンド API（`/api/skills`, `/api/skills/:name`）形状
- `SkillSummary` / `Skill` 型
- E2E セレクタ `data-testid="skill-item-{name}"`（既存 e2e に影響なし）

### 追加 testid

- `skill-group-{key}` — セクションコンテナ
- `skill-group-toggle-{key}` — 開閉ボタン
- `skill-group-count-{key}` — count バッジ

## 変更ファイル

- `src/plugins/manageSkills/View.vue` — 唯一のロジック変更
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — 3 キー追加（`categoryBuiltIn` / `categoryProject` / `categoryUser`）
- `docs/ui-cheatsheet.md` — `/skills` 節のレイアウト図を実装に追従させる（既存ブロックは旧 `<SkillsManager>` プロトタイプを示しており現状とズレている）

## テスト

- `yarn typecheck` — i18n キーは全 8 ロケールで揃える（vue-tsc が拾う）
- `yarn lint` / `yarn format` / `yarn build`
- 既存 e2e `skill-item-{name}` セレクタが温存されることをローカル確認

## スコープ外（別 PR）

- backend が `source: "builtin" | "project" | "user"` を返すように拡張する案 — 今回は不要（mc- 判定で十分かつフロント完結が望ましい）
- カテゴリのカスタム並び替え、検索/フィルタ
