-- Check distinct status values in students table
SELECT status, COUNT(*) as count
FROM students
GROUP BY status
ORDER BY count DESC;

-- Show first 5 students with their status
SELECT student_id, name, status, homeroom_tutor
FROM students
LIMIT 5;
