# 全期間バックフィル計画

## 前提と棚卸し

現環境にGoogle/DB認証情報がないため、対象件数・期間・平均文字数は未計測。最初に読み取り専用inventoryを実行し、本文を保存せず次だけを出力する。

- folderCount、documentCount、student別件数
- 最古/最新のファイル日付
- 文字数の平均・中央値・p95（サンプル段階では母数も表示）
- DB登録済みdrive file ID数、同日複数文書数、ID欠損数

## 状態管理案

- `minutes_backfill_runs`: id, status, parent_folder_id, dry_run, batch_size, cursor, totals, started_by, timestamps
- `minutes_backfill_items`: run_id, student_id, folder_id, drive_file_id UNIQUE, file_name, lesson_date, status, attempts, error_code, next_retry_at, timestamps

本文や認証情報は状態テーブルへ保存しない。itemを先に列挙してからclaimし、statusをpending→processing→succeeded/skipped/failedへ更新する。長時間processingはlease期限後に再取得可能にする。

## 冪等性

第一キーは`drive_file_id`。既存minutesに同IDがあればskip。IDが欠ける旧データだけ `(student_id, lesson_date)` を補助照合する。同日複数Docsの実態を確認するまで現行UPSERTを流用しない。

## バッチ・再開・retry

- inventory既定page size: Drive API上限内で100〜200、全pageTokenを処理。
- AI生成batch初期値: 10件。実測後に20件まで増やす。
- 1 itemごとにcommitし、run cursorではなくitem statusを再開根拠にする。
- 429/5xx/timeoutのみ最大3回、指数backoff＋jitter。一意制約、権限不足、文書空は再試行しない。
- run停止フラグを各item間で確認する。

## コスト算定

inventory後、50件以下の代表サンプルをtokenizeする。

`推定総額 = 対象件数 × (平均入力token × モデル入力単価 + 平均出力token × モデル出力単価)`

単価は実行直前の公式価格と採用モデルで確定する。10%/中央値/p95を併記し、20%の再試行余裕を別表示する。approval budgetを超えるrunは開始しない。

## Google API負荷

フォルダ一覧・文書metadata・Docs本文を段階分離し、同じpageを再読込しない。403/429はGoogle推奨backoffを用いる。同時Docs取得は初期1、実測後も少数に制限する。

## 本番実行順序

1. dry-run inventoryのみ
2. 1生徒、最大2件
3. 3生徒
4. 合計10〜20件
5. 約50件
6. 件数・失敗率・費用・重複をレビュー
7. admin承認後、全期間run

各段階で、成功/skip/error、重複、DB件数差、OpenAI usage、Googleエラー率を確認する。全期間を自動開始しない。

## 検証

- 同じrun/itemを再実行してminutes件数が増えない。
- 処理途中でプロセスを終了し、再起動後に未完了だけ継続する。
- 同日2文書、日付なしファイル、空文書、権限なし文書をfixtureで確認する。
- 1生徒の取り込みで他生徒のstudent IDが保存されない。
