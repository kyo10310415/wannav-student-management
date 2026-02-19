-- Add lesson_progress column to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS lesson_progress TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_students_lesson_progress ON students(lesson_progress);
