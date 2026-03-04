-- Add YouTube channel ID and X account ID columns to students table

ALTER TABLE students ADD COLUMN IF NOT EXISTS youtube_channel_id VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS x_account_id VARCHAR(255);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_students_youtube_channel_id ON students(youtube_channel_id);
CREATE INDEX IF NOT EXISTS idx_students_x_account_id ON students(x_account_id);

-- Add comments
COMMENT ON COLUMN students.youtube_channel_id IS 'YouTube channel ID for the student';
COMMENT ON COLUMN students.x_account_id IS 'X (Twitter) account ID for the student (without @)';
