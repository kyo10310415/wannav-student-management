-- Create helper_requests table
CREATE TABLE IF NOT EXISTS helper_requests (
  id SERIAL PRIMARY KEY,
  lesson_date DATE NOT NULL,
  lesson_time VARCHAR(50),
  student_id VARCHAR(100) NOT NULL,
  student_name VARCHAR(200) NOT NULL,
  notion_url TEXT,
  requesting_tutor_id VARCHAR(100),
  requesting_tutor_name VARCHAR(200),
  lesson_progress INTEGER,
  reason TEXT NOT NULL,
  notes TEXT,
  deadline TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  accepted_by_tutor_id VARCHAR(100),
  accepted_by_tutor_name VARCHAR(200),
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add helper counters to tutors table
ALTER TABLE tutors 
  ADD COLUMN IF NOT EXISTS helper_request_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS helper_accepted_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_helper_requests_status ON helper_requests(status);
CREATE INDEX IF NOT EXISTS idx_helper_requests_deadline ON helper_requests(deadline);
CREATE INDEX IF NOT EXISTS idx_helper_requests_lesson_date ON helper_requests(lesson_date);
