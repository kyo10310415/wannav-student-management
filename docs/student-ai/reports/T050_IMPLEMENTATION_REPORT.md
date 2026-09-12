# T050 Implementation Report

実施日: 2026-09-12。実装担当: Codex。Workレビュー待ち。

## 1. Outcomeと未完了の実品質評価

**evaluation harness/code/tests done; live quality pending**。

架空の日本語質問40ケース、schema検証、独立した採点器、実T030/T040を通すオフラインpipeline、CLI、新規run保存、手動レビューのrun/case/output hash束縛を実装した。実モデルの意味検索・回答品質・攻撃耐性・費用・速度は評価していない。

全runはmode=offline_mock、semanticQuality=not_evaluated、liveQuality=pending。scripted/oracle mockによる高recallを検索アルゴリズムの実精度と扱わない。今回T050の実品質受入は保留し、T040のWork承認を保持した。

外部AI、実DB/Drive、migration、backfill、main merge、deploy、本番STUDENT_AI_ENABLED有効化は実行していない。UIやT060以降へ進んでいない。

## 2. 変更ファイル・コマンド・環境・テスト

- tests/fixtures/student-ai-evaluation/cases.js: 架空40ケース、本文から独立して確認できる期待根拠・主張・禁止事項。
- scripts/lib/studentAiEvaluationFixtures.js: 組込データのみのloaderとschema/参照範囲検証。
- scripts/lib/studentAiEvaluationScoring.js: 原文位置付きOR/AND、source重複排除、macro/micro/NA、機械検証、手動レビュー、カテゴリ集計。
- scripts/lib/studentAiEvaluationPipeline.js: parameterized SQL fake、scripted provider、実selector/context/answer/Hono routeを通すpipeline。
- scripts/evaluate-student-ai.js: offline専用CLI、排他的run作成、JSON/Markdown/レビュー雛形、checkpoint/中断/失敗状態。
- tests/studentAiEvaluation.test.js / studentAiEvaluationScoring.test.js: 新規97テスト。
- package.json: student-ai:evaluate scriptだけを追加。既存test/postinstall/start、依存とpackage-lockは変更なし。
- .gitignore: 既定の大量run出力を除外。
- docs/student-ai/T050_EVALUATION.md、TASKS.md、TEST_PLAN.md、CODEX_HANDOFF.md: 指標・実行・live保留と古いbaseline/一律ルールを整合。
- この報告と[T050_OFFLINE_SUMMARY.json](T050_OFFLINE_SUMMARY.json): 合成評価結果の限定保存。大量runや認証情報、実測統計はcommitしない。

実行コマンド:

```sh
npm test
npm run student-ai:evaluate -- --run-id T050-9a37aa5-a
npm run student-ai:evaluate -- --run-id T050-9a37aa5-b
```

WindowsではNode22の実行ファイルでnpm-cli.jsを起動し、子プロセスもNode22以外なら失敗する一時preloadを付けて検証した。

| 確認 | 結果 |
|---|---|
| Node | v22.23.2 |
| 最新feature baseline | 232/232成功、失敗0 |
| 最終npm test | 329/329成功、失敗0、skip0 |
| 新規テスト | 97件（上記全件に含む） |
| git diff空白チェック | 成功 |
| クリーンな実装commitでのCLI | 2 runとも正常終了 |
| 再現性 | 2 runの集計と全40 outputHashが一致 |

依存は導入済みを使用し、今回npm install/ciは行っていない。index.js/cronを起動していない。独立したlint/typecheck/build scriptはpackage.jsonにない。本体と既存minutes APIの回帰はnpm testに含まれる。

## 3. ケース・指標・controlled bad outputs

40ケース、17カテゴリ。recent2、comparison2、longitudinal2、repetition1、topic3、counterevidence1、dates3、missing5、single2、source-integrity3、limits4、isolation4、injection1、semantics3、authentication1、failures2、usage1。

主な観点は、古い転機/月初代表外の変更、後日の改善、言い換え/類似語の無関係資料、前後比較/JST/月末、0件/単一事実/単一記録の長期変化不足、欠損/summary/unverified transcript/旧ID、同日別資料/Drive重複/version変更、大量バッチ/最終上限、生徒カナリア、偽指示/URL、逆結論/無関係引用/提案の事実化。

requiredRecallは満たした必須グループ/全必須グループ、sourcePrecisionは関連集合に属する一意source/返却一意source。グループのallOfはAND、各anyOfはOR。位置付き根拠はsource/field/start/endの包含を検査する。反証と比較両時点は別指標。DB候補、detail選択source、最終evidenceの欠落段階を区別する。

macroはケース比率平均、microは分子合計/分母合計。必須0件のrecallと返却0件のprecisionはNA、必須あり返却0件のrecallは0。失敗・NA・未計測件数を保持し、HTTP成功率には全予定ケースを分母に使う。

採点器は改変quote、偽ID、生徒/所有者/原文/日付/URL偽造、source重複、同一時点の変化、候補外参照、カナリア、coverage改変、JSON型/未知キーを検出する。正しいcontrolled outputはpass。手計算でOR/AND、範囲、一意source、macro/microを検証した。

3つの意味的bad caseは正しいquoteを付けて機械passになり得ることを確認し、テスト用手動ratingを付けるとfailになることを検証した。これは実AI出力の手動レビュー実績ではない。正式runの手動評価は全40件pending。

## 4. 発見・修正・残る制約

自己レビューで新規SQL fakeの「双方のlesson_dateがNULLの場合、id降順にならない」不備を発見した。先に期待[2,1]に対し実際[1,2]となる失敗テストを実行し、同一日付/NULL同士はid降順にする修正を行った。最終回帰329件成功。

T030/T040の本体不具合として変更したものはない。認証、引用検証、入力budget、同時実行、既存APIを緩めていない。

次の検索上の有限context制約を意図的に可視化した:

- final-excerpt-count-loss: 必要sourceはDB/detailに存在するが、最終12抜粋上限で落ちる（最終12件、21463コードポイント）。
- final-character-loss: 必要sourceを選択したが、最終24000コードポイントで落ちる（最終6件）。
- 最新記録の保持で無関係sourceも入るケースがあり、precisionが低下する。

これらを都合よくgoldから削除しない。本体の検索方式を全面変更せず、上限を守った状態の制約として報告する。後続実評価で重要度や回答設計を検討する材料であり、今回上限を増やす判断はしていない。

## 5. オフライン評価結果

実装SHA上のクリーンな2 run: T050-9a37aa5-a / T050-9a37aa5-b。Git dirty=false。

fixtureVersion=1.0.0、schemaVersion=1、evaluatorVersion=1.0.0。
fixture hash: f2d2fcbdcb7b2fa0c6edd164c2f05984314104c70711554aec97b152a9cb0c1c。

| 項目 | 合成runの結果 |
|---|---|
| 実行完了/期待応答 | 40/40 |
| 機械検証 | pass31、fail0、安全エラーによる引用NA9 |
| HTTP200 | 31/40（安全拒否9件も分母に含む） |
| 手動意味評価 | pending40 |
| 必須根拠保持 | macro87.50%、micro32/36、NA8 |
| 関連source precision | macro79.44%、micro35/54、NA10 |
| 重要反証保持 | 1/1、NA39 |
| 比較両時点保持 | 2/2、NA38 |
| 形式拒否/入力上限/timeout | 2/40、1/40、1/40 |
| mock呼出数 | selection92、answer30 |
| 実usage/費用/速度 | unknown / not_measured / not_measured |

上記は**scripted/oracle選択の配線・保持指標**であり、実モデルの検索成績ではない。version競合・故意のDB混入の安全拒否でも根拠は空になるので集計に残した。空集合を満点にしていない。

生徒カナリアのprompt/回答混入、未認証成功、候補外引用の成功扱いはこの合成検証内で0。外部通信を禁止するmockと、環境変数に偽の本番風資格情報があっても無視するCLIテストを実施した。例外に含む秘密値fixtureはログ/結果へ出ない。

詳細なカテゴリ集計と各case/hashは[T050_OFFLINE_SUMMARY.json](T050_OFFLINE_SUMMARY.json)。mode=offline_mock、semanticQuality=not_evaluatedを維持する。

## 6. 将来の実AI評価の開始条件

使用データの許可、実行環境、model snapshot、対象ケース/回数、料金確認日と単価、総token/費用上限、失敗・usage不明時の保守的見積り、停止条件、手動レビュー担当/rubric、完了率/費用/速度の受入閾値を事前に決める。

後続目標案のmacro recall90%以上、critical反証/比較100%、重大な根拠なし断定/逆結論0等は既達成値ではない。今回live runnerを実装せず、--live/外部データ入力を拒否する。詳細は[評価仕様](../T050_EVALUATION.md)。

## 7. 検証対象SHA・差分・Work依頼

- 開始時remote: 8896d6370888f8cc810c179b4f04b14941851e4b。
- T040実装3f4e9c0、レビュー対象6b896fd、レビュー更新63f47dcを含む最新featureへfast-forwardした。
- 検証対象実装: **9a37aa59cf4378ac1a5d04331d60e29ae12dacfd**。
- 実装push後、git ls-remoteでfeature/student-ai-assistantが上記SHAに一致することを確認済み。
- [実装コミット](https://github.com/kyo10310415/wannav-student-management/commit/9a37aa59cf4378ac1a5d04331d60e29ae12dacfd)
- [開始時からの差分](https://github.com/kyo10310415/wannav-student-management/compare/8896d6370888f8cc810c179b4f04b14941851e4b...9a37aa59cf4378ac1a5d04331d60e29ae12dacfd)

この報告と合成集計JSONを含む最終remote SHAは、push後にチャットで伝える。

Workには、40ケースのgoldアンカー/期待主張、macro/micro/NAと拒否ケースの扱い、scripted指標と実品質の区別、手動rubric/run/hash束縛、最終上限の欠落ケース、live開始条件をレビューしてほしい。コード/テストの自己確認は完了したが、Work承認済み・実品質受入済みにはしていない。T050で停止する。
