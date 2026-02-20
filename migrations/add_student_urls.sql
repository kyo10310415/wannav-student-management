-- Add notion_url and discord_url columns to students table

ALTER TABLE students ADD COLUMN IF NOT EXISTS notion_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS discord_url TEXT;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_students_notion_url ON students(notion_url);
CREATE INDEX IF NOT EXISTS idx_students_discord_url ON students(discord_url);

-- Add comment
COMMENT ON COLUMN students.notion_url IS 'Notion page URL for the student';
COMMENT ON COLUMN students.discord_url IS 'Discord chat URL for the student';
