-- Add satisfaction_avg column to red_list table
ALTER TABLE red_list ADD COLUMN IF NOT EXISTS satisfaction_avg NUMERIC(4, 2);

COMMENT ON COLUMN red_list.satisfaction_avg IS 'Actual satisfaction average (0-10 scale)';
