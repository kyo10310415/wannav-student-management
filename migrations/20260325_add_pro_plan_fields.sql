-- PROプラン関連のカラムを追加
ALTER TABLE students
ADD COLUMN IF NOT EXISTS pro_plan_start_date DATE;

-- コメント追加
COMMENT ON COLUMN students.pro_plan_start_date IS 'PROプラン開始日（月初の1日）';

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_students_pro_plan_start_date ON students(pro_plan_start_date);
