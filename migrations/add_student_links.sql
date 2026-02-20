-- Add notion_url and discord_url columns to students table

-- Add notion_url column (generated from notion_page_id)
-- Note: This will be computed on the fly, so we don't store it

-- Add discord_url column for storing Discord channel/DM link
ALTER TABLE students ADD COLUMN IF NOT EXISTS discord_url TEXT;

-- Create index for discord_url
CREATE INDEX IF NOT EXISTS idx_students_discord_url ON students(discord_url);

-- Comments
COMMENT ON COLUMN students.discord_url IS 'Discord channel or DM URL for the student';
