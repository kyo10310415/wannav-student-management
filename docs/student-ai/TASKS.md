# 実装タスク

| ID | Status | 目的 | 依存 |
|---|---|---|---|
| T001 | Done | 現状調査とPhase 0文書 | - |
| T005 | Done (measurement) | 読み取り専用全期間測定完了。実測詳細は作業報告書で管理 | T001 |
| T010 | Approved (MVP design) | PostgreSQL＋全期間要約の意味選択＋選択原文確認。実精度・速度・費用は実装後評価 | T001,T005 |
| T015 | Done | 共通requireAuth middlewareとunit test（inventory非依存） | T001,baseline test |
| T016 | Investigated | 既存minutes API認証影響調査（本番外部利用者の確認は残る） | T001 |
| T017 | Done (code/tests) | minutes全API認証適用＋Node22回帰62件成功。本番deployは未実施 | T015,T016 |
| T020 | Review | 全期間backfill設計 | T005 |
| T030 | Code/tests done | 質問意図分類・候補取得context serviceと注入可能な選択adapter。T040でAPI接続済み、実データ評価は未実施 | T005,T010,T015 |
| T040 | Approved (code/tests; Work reviewed) | 認証付き回答API・引用/入力予算/キャンセル検証。実AI・実DB・本番受入は未実施。[Workレビュー](reports/T040_WORK_REVIEW.md)・T040_API.md参照 | T030 |
| T050 | Todo | 検索精度・生徒分離テスト | T040 |
| T060 | Todo | 生徒AIカルテmodal追加 | T040 |
| T070 | Todo | 質問例、loading/error、引用UI | T060 |
| T080 | Todo | admin/leader/crew/未ログイン検証 | T015,T070 |
| T090 | Blocked | backfill state/runner本実装（inventoryはT005で先行） | T005,T010最終確定,T020,T015 |
| T100 | Todo | 1→3生徒、10〜20→50件canary | T090 |
| T110 | Blocked | 全期間backfill（明示承認後） | T100 |
| T120 | Todo | E2E | T050,T070,T100 |
| T130 | Todo | セキュリティレビュー | T120 |
| T140 | Todo | 最終回帰テスト | T130 |

## タスク共通フォーマット

各タスク開始時に目的、対象ファイル、変更内容、変更禁止範囲、Acceptance Criteria、Testを確定し、完了時にdiff→test→問題確認→修正→完了判定→commit/pushの順で進める。

## T015

- 目的: AI APIで再利用するサーバー側認証基盤を作る。
- 対象: 新規 `src/middleware/auth.js`、新規unit test。既存routeへの一括適用はしない。
- 変更禁止: login/session発行仕様、role権限、public/app.js。
- Acceptance Criteria: 有効sessionはuserをcontextへ格納、tokenなし/期限切れは401、DB障害は本文を漏らさず500。
- Test: tokenなし、有効、期限切れ、存在しないtoken、3 roleをmock queryで検証。8件追加、全56件成功。期限切れはSQL条件＋空resultのmock検証であり、実DB統合検証はT017に残る。既存routeへの適用は未実施。

## T016 / T017

T016のコード調査: `public/app.js` のlist/all/detail/generate/update/delete/templates取得・更新の全8呼出箇所でAuthorization Bearerを送信済み。自動生成jobはHTTP経由ではなくDB/serviceを直接利用する。リポジトリ内に他のminutes API consumerは見つからない。外部クライアントの存在は本番アクセス情報で確認する。

T017対象: `src/routes/minutes.js` にrequireAuthを適用し全エンドポイントを保護、必要なテスト用依存注入のみ追加。既存画面・cron仕様は変えない。受入条件: 未認証/期限切れは全APIで401、3ロールの既存操作継続、AI/Driveを呼ぶ前に認証拒否。DB障害500、フロントのセッション切れ表示も確認する。今回の実装範囲はT015までだが、T017未完了のままAI機能を公開しない。

## T030概要

parameterized query、全row student ID assert、意図別日付窓、入力文字数上限、最大候補件数を持つ純粋関数中心のserviceとする。AI呼出しは分離してmock可能にする。

## T060概要

`renderStudentRowsSimple` のリンク群にAIボタンを1個追加し、既存modalパターンを利用する。`public/app.js` の全面整形・分割は行わない。

## T030 implementation

詳細はT030_CONTEXT.md。read-only queryとAI selectorを注入し、生徒分離、候補/引用ID検証、全期間軽量情報の段階選択、入力/呼出数上限、未確認範囲を実装。T040のコード接続は実装済み、T090は未着手。実精度・遅延・費用の合格を宣言しない。
