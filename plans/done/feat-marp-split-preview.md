# feat(marp): side-by-side ライブプレビュー

Issue: receptron/mulmoclaude#1647

## 背景

#1646 で chat plugin View の Marp 分岐に source editor (textarea) を露出した。これは「編集 → Apply → preview 更新」の離散ステップで、編集中はプレビューが古いまま。

`MarpView` は `props.markdown` を watch して即時再描画する作りなので、未保存バッファをそのまま `MarpView` に流せばライブプレビューが成立する。今回その配線を追加する。

## 設計 (ユーザ合意済)

- **トグル UI**: MarpView 上部のツールバー (PDF ボタンの隣) に split / preview-only トグルを 1 つ追加
- **layout**: 左 = editor, 右 = preview (横並び)
- **size**: 50/50 固定 (リサイザーは別 PR)
- **debounce**: なし (即時更新)
- **デフォルト state**: preview-only (現状互換)
- **状態の永続化**: なし (タブ切替・リロードでリセット)

## 流用するもの (変更不要)

- `editableMarkdown` ref / `hasChanges` computed / `applyMarkdown` / `cancelEdit` / `onDetailsToggle`
- `MarpView` の reactive 再描画

## 触るファイル

- `src/plugins/markdown/View.vue` — split state + template 分岐 + toggle ボタン配線
- `src/plugins/markdown/MarpView.vue` — トグルボタンを slot or prop で受ける (toolbar に追加)
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — トグルラベル i18n キー追加

## 重要な実装判断

### トグル UI を MarpView 内に置くか View.vue 側に置くか

MarpView 内のツールバーには PDF ボタン / slide count が既にある。一貫性のため split toggle もそこに置く。

ただし split state を MarpView が持つと「preview だけ MarpView 内 → 編集すると View.vue 側の textarea が要る」のように責務が両方にまたがる。

解決: state は View.vue 側で持ち、MarpView には `onToggleSplit` emit + `splitMode` prop を渡してボタンを描画させる。MarpView の責務は「preview を出す + toolbar に既存ボタン + slot で外部ボタン」というシンプルな形にする。

### split mode 時の textarea 表示

split mode に入ると、左に textarea / 右に MarpView を flex で並置する。

- textarea には `editableMarkdown` を bind (現状の `<details>` 内のものと同じ ref)
- preview には `editableMarkdown` を流す → 未保存バッファでライブ更新
- Apply / Cancel button を textarea 上部に出す
- 既存の bottom `<details>` panel は split mode 時には隠す (重複 UI 防止)

### 編集中バッファをそのまま preview に流すか?

split mode 中: preview は `editableMarkdown` (未保存)。preview-only mode 中: preview は `markdownContent` (保存済)。

→ MarpView に流す markdown は computed で切り替え。

### `useFileChange` でリモート書き込みを受けた時の挙動

split mode 中にリモート書き込みが来たら、現状の `<details>` 同様、編集破棄してリロード。`fileVersion` watcher で `splitMode = false` にする (panel 閉じる相当)。

## 受け入れ基準

- [ ] Marp ファイル (`marp: true`) を開くと MarpView ツールバーに split toggle ボタンが出る
- [ ] split mode に入ると左 textarea / 右 MarpView の 50/50 並置
- [ ] textarea で打鍵すると preview が即時更新 (未保存)
- [ ] Apply で disk 保存 / Cancel で破棄 / どちらでも mode はそのまま (継続編集できる)
- [ ] preview-only mode に戻すと元の単一 preview レイアウト
- [ ] リモート書き込みが来たら mode 自動解除 + リロード
- [ ] 非 Marp Markdown 分岐に regression なし
- [ ] 8 locale で i18n 追加
- [ ] `yarn format` / `lint` / `typecheck` / `build` / `test` 全 pass

## 非ゴール (別 issue)

- リサイザー / pane width の永続化
- textarea を CodeMirror / Monaco に置換
- WYSIWYG
