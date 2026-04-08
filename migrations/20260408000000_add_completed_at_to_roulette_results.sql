-- Migration: Add completed_at column to roulette_results table
-- Description: Track when a winner's status changed to '実施済み'

-- Add completed_at column
ALTER TABLE roulette_results ADD COLUMN completed_at TIMESTAMP;

-- Add index for querying completed winners
CREATE INDEX idx_roulette_results_completed_at ON roulette_results(completed_at);

-- Add comment
COMMENT ON COLUMN roulette_results.completed_at IS '実施済みに変更された日時';
