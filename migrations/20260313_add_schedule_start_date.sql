-- Add schedule_start_date column to broadcast_messages table
-- This column stores the reference date for biweekly schedules

ALTER TABLE broadcast_messages 
ADD COLUMN IF NOT EXISTS schedule_start_date TIMESTAMP;

-- Set default start date to created_at for existing scheduled broadcasts
UPDATE broadcast_messages 
SET schedule_start_date = created_at 
WHERE is_scheduled = true AND schedule_start_date IS NULL;

COMMENT ON COLUMN broadcast_messages.schedule_start_date IS 'Reference date for biweekly schedules - determines which weeks to send';
