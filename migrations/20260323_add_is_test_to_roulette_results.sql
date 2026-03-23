-- Add is_test column to roulette_results table
ALTER TABLE roulette_results 
ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN roulette_results.is_test IS 'テスト抽選フラグ（TRUE=テスト抽選、FALSE=本番抽選）';

-- Create index for filtering production results
CREATE INDEX IF NOT EXISTS idx_roulette_results_is_test ON roulette_results(is_test);
