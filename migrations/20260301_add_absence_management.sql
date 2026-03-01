-- Migration: Add absence management for schedules
-- Date: 2026-03-01

-- Add absence counters to tutors table
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS cancel_count INTEGER DEFAULT 0;
ALTER TABLE tutors ADD COLUMN IF NOT EXISTS schedule_reschedule_count INTEGER DEFAULT 0;

-- Create absence_requests table
CREATE TABLE IF NOT EXISTS absence_requests (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  tutor_email TEXT NOT NULL,
  tutor_name TEXT NOT NULL,
  absence_type TEXT NOT NULL CHECK (absence_type IN ('cancel', 'reschedule')),
  reason TEXT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  schedule_date TEXT,
  schedule_time TEXT,
  schedule_title TEXT,
  matched_keyword TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_absence_requests_tutor_email ON absence_requests(tutor_email);
CREATE INDEX IF NOT EXISTS idx_absence_requests_year_month ON absence_requests(year, month);
CREATE INDEX IF NOT EXISTS idx_absence_requests_event_id ON absence_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_absence_requests_absence_type ON absence_requests(absence_type);

-- Comments
COMMENT ON TABLE absence_requests IS 'Tracks tutor absence requests for schedules (cancel/reschedule)';
COMMENT ON COLUMN absence_requests.absence_type IS 'Type: cancel or reschedule';
COMMENT ON COLUMN tutors.cancel_count IS 'Total count of schedule cancellations';
COMMENT ON COLUMN tutors.schedule_reschedule_count IS 'Total count of schedule reschedules';
