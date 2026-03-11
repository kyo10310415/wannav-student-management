-- Add lesson_time column to lessons table
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS lesson_time VARCHAR(10);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_lessons_time ON lessons(lesson_time);

COMMENT ON COLUMN lessons.lesson_time IS 'Lesson time in HH:MM format (e.g., 13:00, 15:30)';
