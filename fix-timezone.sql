-- Fix timezone: Add 9 hours to all lesson_date values to convert from incorrect UTC to correct UTC
-- This assumes the current values are JST times incorrectly stored as UTC (2026-02-26 00:00:00 should be 2026-02-26 10:00:00 for JST 19:00)
-- Actually, we need to add 10 hours for 19:00 JST to become 10:00 UTC (19 - 9 = 10)

-- First, let's see a sample of current data
SELECT id, student_id, lesson_date, tutor_name 
FROM lessons 
WHERE student_id = 'OLTS240499-HK' AND lesson_date::date = '2026-02-26'
LIMIT 5;

-- Update: Add time back based on assumption that 00:00:00 UTC should represent 19:00 JST (10:00 UTC)
-- UPDATE lessons SET lesson_date = lesson_date + INTERVAL '10 hours';
