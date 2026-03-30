-- レッスン報告テーブルに担当Tutor列を追加
ALTER TABLE lesson_reports ADD COLUMN IF NOT EXISTS tutor_name TEXT;

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_lesson_reports_tutor_name ON lesson_reports(tutor_name);

-- コメント追加
COMMENT ON COLUMN lesson_reports.tutor_name IS '担当Tutor名';
