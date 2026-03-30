-- レッスン報告テーブル作成
CREATE TABLE IF NOT EXISTS lesson_reports (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  lesson_date DATE NOT NULL,
  lesson_result TEXT NOT NULL,  -- '実施済み', '生徒様都合でリスケ', 'Tutor都合でリスケ', '無断キャンセル'
  lesson_number TEXT NOT NULL,  -- '1'～'28', 'PROプラン'
  pro_curriculum TEXT,  -- PROプランの場合のみ設定
  pro_text_number TEXT,  -- PROプランの場合のみ設定
  reported_by TEXT,  -- 報告者（ユーザー名）
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, lesson_date)  -- 同じ学籍番号・日付の重複報告を防ぐ
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_lesson_reports_student_id ON lesson_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_lesson_date ON lesson_reports(lesson_date);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_lesson_result ON lesson_reports(lesson_result);

-- コメント追加
COMMENT ON TABLE lesson_reports IS 'レッスン報告データ';
COMMENT ON COLUMN lesson_reports.student_id IS '学籍番号';
COMMENT ON COLUMN lesson_reports.lesson_date IS 'レッスン実施日';
COMMENT ON COLUMN lesson_reports.lesson_result IS 'レッスン結果（実施済み、生徒様都合でリスケ、Tutor都合でリスケ、無断キャンセル）';
COMMENT ON COLUMN lesson_reports.lesson_number IS 'レッスン番号（1～28、PROプラン）';
COMMENT ON COLUMN lesson_reports.pro_curriculum IS 'PROプランカリキュラム名';
COMMENT ON COLUMN lesson_reports.pro_text_number IS 'PROプランテキスト番号（1～12）';
COMMENT ON COLUMN lesson_reports.reported_by IS '報告者';
COMMENT ON COLUMN lesson_reports.reported_at IS '報告日時';
COMMENT ON COLUMN lesson_reports.updated_at IS '更新日時';
