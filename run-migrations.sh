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

# Migration 3: Add notion_url and discord_url columns to students
psql $DATABASE_URL << 'SQL'
ALTER TABLE students ADD COLUMN IF NOT EXISTS notion_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS discord_url TEXT;
CREATE INDEX IF NOT EXISTS idx_students_notion_url ON students(notion_url);
CREATE INDEX IF NOT EXISTS idx_students_discord_url ON students(discord_url);
SQL

# Migration 4: Add payment_status column to students
psql $DATABASE_URL << 'SQL'
ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT '未払い';
CREATE INDEX IF NOT EXISTS idx_students_payment_status ON students(payment_status);
SQL

# Migration 5: Add separate payment status columns for last and current month
psql $DATABASE_URL << 'SQL'
ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status_last_month TEXT DEFAULT '未払い';
ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_status_current_month TEXT DEFAULT '未払い';
ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_year_month_last TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_year_month_current TEXT;
CREATE INDEX IF NOT EXISTS idx_students_payment_last ON students(payment_status_last_month);
CREATE INDEX IF NOT EXISTS idx_students_payment_current ON students(payment_status_current_month);
SQL

echo "Migrations completed successfully!"
