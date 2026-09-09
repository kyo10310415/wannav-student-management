# 全期間バックフィル計画

## 前提と棚卸し

現環境にGoogle/DB認証情報がないため、対象件数・期間・平均文字数は未計測。最初に読み取り専用inventoryを実行し、本文を保存せず次だけを出力する。

- folderCount、documentCount、student別件数
- 最古/最新のファイル日付
- 文字数の平均・中央値・p95（サンプル段階では母数も表示）
- DB登録済みdrive file ID数、同日複数文書数、ID欠損数

## 状態管理案

本書は暫定案。T005でinventoryを先行し、T010/T020確定前にT090本実装へ進まない。

- `minutes_backfill_runs`: id, status, parent_folder_id, dry_run, batch_size, cursor, totals, started_by, timestamps
- `minutes_backfill_items`: run_id, student_id, folder_id, drive_file_id UNIQUE, file_name, lesson_date, status, attempts, error_code, next_retry_at, timestamps

本文や認証情報は状態テーブルへ保存しない。itemを先に列挙してからclaimし、statusをpending→processing→succeeded/skipped/failedへ更新する。長時間processingはlease期限後に再取得可能にする。

## レッスン情報が欠ける過去文書

lesson_reportsなし、lesson_number不明、lesson_contents不一致を理由に原文を検索対象から除外しない。現行minutes.lesson_numberは既にnullableだが、手動生成APIは番号未解決で409、自動jobはskipするため、既存生成処理をそのままbackfillへ流用できない。

| 候補 | 利点 | 課題 |
|---|---|---|
| A: minutesへ番号なしで保存 | 読取先の追加が少ない。DBの番号nullableは既存で対応 | 生成serviceのmaster前提、同日唯一制約、品質評価集計への影響 |
| B: 簡易議事録生成 | masterなしでも原文から課題・目標・変化を整理できる | 保存先は別途必要。要約失敗時にも原文取得状態を保持する必要 |
| C: AI検索sourceテーブル | 日付/番号欠損や同日複数原文を既存minutesへ影響なく保持 | 統合検索・同期・削除・引用UIの追加実装が必要 |

暫定推奨はC+B。`student_ai_sources` にstudent_id、drive_file_id UNIQUE、日付nullable、日付根拠、原文、簡易要約、要約状態、取得時刻、modifiedTime、任意minutes_idを保持する。source登録とAI要約を別工程にし、要約失敗でもsourceを削除/除外しない。未要約原文は限定断片検索の対象とし、その範囲・未要約件数を回答のcoverageへ反映する。

簡易要約は原文から確認できる事実、課題、目標、実施結果、助言だけ。不存在のlesson masterや番号を推測で補完せず、「不明」を保持。Tutor品質評価と生徒カルテ要約を混同しない。日付不明はcreatedTimeをレッスン日と断定せず、時系列比較の不確かさを表示する。

同一Drive IDがminutesとsource両方にある場合はminutesを優先して重複排除する。異なるstudent IDへの同一ファイル割当は競合として隔離し、自動再割当しない。modifiedTime更新・削除時に要約/検索索引も無効化する。生徒がDBにないフォルダはinventoryへ残し、身元照合前に別生徒へ紐付けない。件数と欠損率をT005で確認し、T010/T020で採否を最終決定する。

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
