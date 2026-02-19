-- Add job_type and status columns to tutors table
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS job_type TEXT;
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS status TEXT;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_tutors_job_type ON tutors(job_type);
CREATE INDEX IF NOT EXISTS idx_tutors_status ON tutors(status);

-- Create index for active tutors with Tutor job type
CREATE INDEX IF NOT EXISTS idx_tutors_active_tutor ON tutors(status, job_type) WHERE status = 'アクティブ';
