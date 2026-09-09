# 最新main同期・実装前baseline

## Node 22 / T017追記

2026-09-09: `npm exec --yes --package=node@22 -- node -v` = v22.23.2。
同じNode22環境の `npm test` で変更前56/56成功、T017後62/62成功。
package.json、lockfile、postinstallは変更なし。DB migration未検証の制約は継続。

T017 diff: minutes routeに共通requireAuthを適用し、テスト用service依存注入factoryを追加。list/all/detail/generate/update/delete/templates取得・更新すべてを保護。フロント、cron、自動生成serviceは変更なし。
回帰はmock SQL/Drive/OpenAIによるHTTP route検証。期限切れはSQLのexpiry条件と空resultで検証し、実DB統合テストとは区別する。リポジトリ外consumerは既知のものなし。ただし存在する場合はBearer対応が必要で、運用時401の確認が残る。本番deployは未実施。

## 同期とSHAの確認（2026-09-09）

- 調査開始時main: `f13996016bcf85ac35db022f3575068b5aa5e124`
- 最新取得main: `6b5f8c888ea3e299319d0e134dfb0209fd6c2522`
- Phase 0 remote: `96a63ecc02d6878f3426ddf4efe7dec681759221`（直前報告と一致）
- 旧ローカル: `1a80127dcfdd1c05bd84372d5a092c27e8e97c81`。GitHub APIでcommitを作成したためSHAは異なるがtreeは同一。remote履歴とmainをローカルへmergeし、既存履歴は破棄していない。
- baseline対象local: `add8d2f395802efc6576fe5593bb888cae5dc5e1`。アプリコードは最新mainと同一、差分はPhase 0文書のみ。

PR #103 / `3877976` はbroadcastService.setRecipientStatusでSQL `$3` をVARCHAR(20)に明示castする修正。変更は1ファイルのみで、認証・minutes・Drive・DB schemaへの変更なし。AI設計への直接影響なし。最新mainの変更を保持する。

## 実装前の実行結果

| 項目 | 結果 | 分類 |
|---|---|---|
| npm ci | exit 1。パッケージ導入後postinstallのDB migrationでlocalhost:5432 ECONNREFUSED | 既存package.jsonのpostinstallとDB未設定による環境制約。T015実装前 |
| npm test | 48/48 pass、0 fail、exit 0 | 実装前の自動テストbaseline |
| Node | v24.19.0 / npm 11.9.0。package指定は22.x | engine警告あり。22系での本番同等検証は未実施 |
| Discord | import時TokenInvalidログ | 既存serviceの副作用。テスト失敗なし、実接続/送信なし |

厳密にはnpm ci成功の環境baselineは未成立。自動テスト48件成功をT015の比較基準とし、DB migration成功や本番同等環境を検証済みとは扱わない。これを直すために本番DBへ接続したりpostinstallを変更したりしていない。

## T015後の検証

`npm test`: 56/56成功、0失敗、exit 0（既存48件＋T015の8件）。`git diff --check`成功。package.json/package-lock.jsonとmainのbroadcast修正に差分なし。新規runtimeコードは `src/middleware/auth.js` のみ。

T017の既存APIへの適用、実DB session検証、T005 inventoryは別ゲートとして未実施。DB未接続によるnpm ci失敗を完了扱いにしない。
