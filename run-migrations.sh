#!/bin/bash
# Run all pending migrations

echo "Running migrations..."

# Migration 1: Add lesson_progress column
psql $DATABASE_URL << 'SQL'
ALTER TABLE students ADD COLUMN IF NOT EXISTS lesson_progress TEXT;
CREATE INDEX IF NOT EXISTS idx_students_lesson_progress ON students(lesson_progress);
SQL

# Migration 2: Add job_type and status columns to tutors
psql $DATABASE_URL << 'SQL'
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS job_type TEXT;
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS status TEXT;
CREATE INDEX IF NOT EXISTS idx_tutors_job_type ON tutors(job_type);
CREATE INDEX IF NOT EXISTS idx_tutors_status ON tutors(status);
CREATE INDEX IF NOT EXISTS idx_tutors_active_tutor ON tutors(status, job_type) WHERE status = 'アクティブ';
SQL

echo "Migrations completed successfully!"
