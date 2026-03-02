-- Migration: Add approval status to absence requests
-- Date: 2026-03-02

-- Add status column to absence_requests table
ALTER TABLE absence_requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved'));

-- Add leader_email column to track who approved
ALTER TABLE absence_requests ADD COLUMN IF NOT EXISTS leader_email TEXT;

-- Add approved_at timestamp
ALTER TABLE absence_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_absence_requests_status ON absence_requests(status);

-- Comments
COMMENT ON COLUMN absence_requests.status IS 'Approval status: pending or approved';
COMMENT ON COLUMN absence_requests.leader_email IS 'Email of the leader who approved the request';
COMMENT ON COLUMN absence_requests.approved_at IS 'Timestamp when the request was approved';
