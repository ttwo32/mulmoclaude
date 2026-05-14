# fix: image self-repair の URL-encoded 検知対応 (issue #1102 / L-W-S-04)

## 背景

PR #974 (Stage 3) で導入された `useGlobalImageErrorRepair` は、`<img>` の 404 を捕捉して `IMAGE_REPAIR_PATTERN = /artifacts\/images\/.+/` にマッチする部分文字列を `/${match}` に書き換えて static mount から再取得する設計。

`/wrong/prefix/artifacts/images/foo.png` のような broken-prefix 直書きは下記 3 種のシナリオを救う想定だった:

1. wiki / HTML 出力で rewriter が漏らした raw `<img>`
2. LLM が誤った prefix で出した `/some/wrong/prefix/artifacts/images/foo.png`
3. ページ URL に対する相対 `../../../artifacts/images/foo.png`

しかし wiki ページに対しては **markdown rewriter (`rewriteImgSrcAttrsInHtml`)** が先に介入し、`/wrong/prefix/artifacts/images/foo.png` を:

```text
/api/files/raw?path=wrong%2Fprefix%2Fartifacts%2Fimages%2Ffoo.png
```

に書き換えて DOM に挿入する。 結果 `img.src` は上記の **percent-encoded** 形になり、 既存パターン `/artifacts\/images\/.+/` は `%2F` を `/` として認識できず一致しない → repair が発火せず broken のまま (e2e-live `L-W-S-04 chromium` が 1.1s timeout で fail)。

## 修正方針

**自己修復側を拡張**して両形式を受け付ける。 markdown rewriter のロジックは触らない (他のパスの整合性を保つため)。

### 採用する case

```text
<img src> 中の "artifacts/images/<rest>"   → 既存どおり /<match>
<img src> 中の "artifacts%2Fimages%2F<rest>" → decodeURIComponent して /<decoded>
```

両方とも `imageRepairTried` の one-shot guard と `repairImageSrc` / `repairSourceSrc` の戻り値セマンティクスは既存のまま (no-match で marker は付けない、 retry 1 回限り)。

### 実装

- `src/utils/image/imageRepairInlineScript.ts`
  - 既存 `IMAGE_REPAIR_PATTERN` (`/artifacts\/images\/.+/`) はそのまま (互換性のため re-export 維持)
  - 新規 `IMAGE_REPAIR_PATTERN_ENCODED = /artifacts%2[Ff]images%2[Ff][^&#\s]+/` を export
  - 新規 pure helper `findRepairTarget(src: string): string | null` を export — unencoded 優先、 encoded fallback で decodeURIComponent
  - `IMAGE_REPAIR_INLINE_SCRIPT` を同じ二段マッチに更新 (iframe 内も対応)
- `src/composables/useImageErrorRepair.ts`
  - `repairImageSrc` / `repairSourceSrc` (の `src` 経路 / `srcset` 経路) を `findRepairTarget` 経由に置き換え
  - `IMAGE_REPAIR_PATTERN_ENCODED`, `findRepairTarget` を re-export
- `test/composables/test_useImageErrorRepair.ts`
  - encoded 形 (`/api/files/raw?path=...artifacts%2Fimages%2Ffoo.png`) を repair するテスト
  - encoded + cache-bust (`...&v=N`) を `&` で停止して repair するテスト
  - encoded + retry guard が一段で効くテスト
  - drift guard: inline script が encoded pattern と decode 呼び出しを embed しているか
- `test/utils/image/test_imageRepairInlineScript.ts`
  - 既存の inline-script 表面テストに encoded 表記の embed を assert

## 受け入れ条件

- `yarn test` の `test_useImageErrorRepair.ts` / `test_imageRepairInlineScript.ts` 全 pass
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean
- e2e-live `L-W-S-04 chromium` が次回 run で pass するはず (このローカル PR では `e2e-live` は走らせない)

## 影響範囲

- ホスト側 document listener: 触らない (二段マッチは helper 内に閉じる)
- iframe 注入経路 (`presentHtml/View.vue`, `injectImageRepairScript`): 同じ helper を embed するので追加の編集なし
- 既存の unencoded 形に対する挙動は完全保持 (regex 自体は変更しない、 順序も unencoded 先)

## 関連

- Issue: #1102
- Stage 3 PR: #974
- Stage 1 PR (static mount): #969
- e2e-live spec: `e2e-live/tests/wiki.spec.ts:69` (L-W-S-04)
