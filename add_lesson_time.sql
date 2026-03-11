-- Add lesson_time column to lessons table
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS lesson_time VARCHAR(10);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_lessons_time ON lessons(lesson_time);
