# 現行システム調査

調査対象: `main` commit `f139960`（2026-09-09取得）。本書はコード上の事実と、実環境未接続の項目を分ける。

## 1. 文字起こし取得フロー

`driveService.fetchTranscript(studentId, lessonDate)` が `LESSON_DRIVE_FOLDER_ID`（未設定時は指定親フォルダID）直下のフォルダを最大500件取得し、フォルダ名の完全一致、次に前方一致で生徒フォルダを解決する。子フォルダのGoogle Docsを最大200件取得し、ファイル名の日付が対象日または前日に一致するものから新しい1件を選ぶ。Docs APIのtabsを再帰展開し、「文字起こし」を含むタブを使用する。見つからなければ末尾タブ、さらに本文へフォールバックする。

制約: 現行関数は「指定日前後の1件」専用であり、全フォルダ列挙、pagination、全期間取得には未対応。前方一致は似た学籍番号がある場合に誤選択リスクがある。

## 2. 議事録生成フロー

- 手動: `POST /api/minutes/generate`
- 自動: `minutesAutoGenerate`（直近7日、実施済みlesson report、品質評価済み議事録を除外）
- Drive取得後、lesson master、前回議事録、Tutor情報を解決し、`minutesService.buildMinutesResult` がOpenAI Chat Completionsを呼ぶ。
- 既定モデルは `OPENAI_MODEL`、未設定時 `gpt-4o-mini`。JSON回答をテンプレートへ反映する。
- `(student_id, lesson_date)` のUPSERTで `minutes` に保存する。

## 3. minutesテーブル

| 列 | 型/意味 |
|---|---|
| id | SERIAL PK |
| student_id | VARCHAR(50), NOT NULL |
| student_name | VARCHAR(255) |
| lesson_date | DATE, NOT NULL |
| lesson_number | TEXT（migration 48で変更） |
| drive_file_id | VARCHAR(255) |
| drive_file_name | TEXT |
| transcript | TEXT |
| generated_text | TEXT |
| template_id | minutes_templates FK |
| created_by | VARCHAR(255) |
| tutor_name / tutor_employee_id | Tutor識別 |
| quality_evaluation | JSONB |
| created_at / updated_at | TIMESTAMP |

索引はstudent、日付、Tutor+日付、quality JSONB。唯一制約は `(student_id, lesson_date)`。同日に複数文書が存在すると1件しか保持できず、`drive_file_id` の一意制約はない。

## 4. 生徒管理UI

`public/app.js` の単一巨大ファイルで状態、API、HTML文字列描画を管理する。`renderStudentsPage` → `renderStudentRowsSimple` がカードを生成し、現状の生徒名はクリック要素ではない。各カードにはVQ履歴・議事録等の小ボタンがあるため、AIカルテも同じ領域のボタン＋動的モーダルが最小変更となる。値のHTML挿入が多く、追加UIでは必ずescape/textContentを使う。

## 5. 認証構造

ログイン時にランダムなsession tokenを `sessions` に保存し、有効期限は7日。ブラウザはtokenをlocalStorageに保存してAuthorization Bearerで送る。`users.role` はadmin/leader/crew。

重大事項: 全API共通の認証middlewareは存在しない。`broadcast.js`、`redList.js` 等は各route内で独自middlewareを持つが、`minutes.js` は認証を確認していない。従って現行minutes APIは、UI表示制御とは別に直接アクセス可能な構造である。新機能では共通認証部品を作り、API側へ適用する必要がある。

## 6. 再利用できるコード

- Google認証、Docs tab展開、本文抽出: `driveService.js`
- OpenAI client初期化、JSON生成パターン: `minutesService.js`
- parameterized SQLとpool: `db/connection.js`
- 生徒/直前議事録/Tutor解決: `minutesContextService.js`
- 生徒一覧カード、モーダルのUIパターン: `public/app.js`
- Session検証SQL: `auth.js`、`broadcast.js`
- lesson参照正規化: `lessonReferenceService.js`

## 7. 新規実装が必要なコード

- 共通 `requireAuth` middleware
- 質問意図分類、候補検索、入力上限制御を行うAI context service
- 回答生成serviceと `POST /api/student-ai/:studentId/questions`
- Drive棚卸し/全期間列挙API（pagination込み）
- backfill job/state tables、runner、管理API/CLI
- `drive_file_id` を主キー相当に扱うデータモデル改善
- 生徒カードのAIボタン、質問モーダル、引用表示
- 分離、認証、検索戦略、prompt injection、再開性テスト

## 8–14. Drive/コスト実測

現在の実行環境では `GOOGLE_CREDENTIALS_JSON`、`DATABASE_URL`、`OPENAI_API_KEY` が未設定のため、以下は計測不能であり推測値を記載しない。

| 項目 | 状態 |
|---|---|
| 学籍番号フォルダ数 | 計測待ち |
| 過去文字起こし総件数 | 計測待ち |
| 最古/最新日 | 計測待ち |
| 生徒1名あたり平均件数 | 計測待ち |
| 平均文字数 | 計測待ち |
| 全期間バックフィル費用 | 件数・文字数・採用モデル確定後に算出 |

実測は読み取り専用棚卸しを先に行い、本文を保存せず集計値だけ出力する。費用式は `入力token/1M × 入力単価 + 出力token/1M × 出力単価`。概算tokenは日本語では文字数からの単純換算に頼らず、採用モデルのtokenizerでサンプル計測する。

## 15–19. 結論

方式比較と推奨は `ARCHITECTURE.md`、セキュリティは `SECURITY.md`、backfillは `BACKFILL_PLAN.md`、タスクは `TASKS.md` を参照する。
