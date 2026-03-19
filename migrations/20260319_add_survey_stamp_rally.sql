-- アンケートスタンプラリー機能のテーブル作成

-- 1. アンケート回答記録テーブル
CREATE TABLE IF NOT EXISTS survey_responses (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  response_month VARCHAR(7) NOT NULL, -- YYYY-MM形式
  responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (student_id, response_month)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_survey_responses_student_id ON survey_responses(student_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_response_month ON survey_responses(response_month);

-- 2. ルーレット結果テーブル
CREATE TABLE IF NOT EXISTS roulette_results (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  result VARCHAR(20) NOT NULL, -- '当たり' or 'はずれ'
  probability INTEGER NOT NULL, -- 100 (100%当たり) or 50 (50%当たり)
  roulette_url TEXT NOT NULL, -- ルーレットページのURL
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_roulette_results_student_id ON roulette_results(student_id);
CREATE INDEX IF NOT EXISTS idx_roulette_results_created_at ON roulette_results(created_at);

-- 3. スタンプラリー達成記録テーブル
CREATE TABLE IF NOT EXISTS stamp_rally_achievements (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  achievement_type VARCHAR(50) NOT NULL, -- 'initial_80', 'continuous_6', 'catch_up_100', 'reset_6'
  achievement_date DATE NOT NULL, -- 達成日
  notified_at TIMESTAMP, -- Discord通知送信日時
  roulette_url TEXT, -- 送信したルーレットURL
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_stamp_rally_achievements_student_id ON stamp_rally_achievements(student_id);
CREATE INDEX IF NOT EXISTS idx_stamp_rally_achievements_achievement_date ON stamp_rally_achievements(achievement_date);

-- コメント追加
COMMENT ON TABLE survey_responses IS 'アンケート回答記録：生徒ごとの月別アンケート回答を記録';
COMMENT ON TABLE roulette_results IS 'ルーレット結果：スタンプラリー達成者のルーレット抽選結果を記録';
COMMENT ON TABLE stamp_rally_achievements IS 'スタンプラリー達成記録：特典達成条件を満たした生徒を記録';

COMMENT ON COLUMN survey_responses.response_month IS '回答月（YYYY-MM形式）';
COMMENT ON COLUMN roulette_results.probability IS '当選確率（100=必ず当たり、50=50%当たり）';
COMMENT ON COLUMN roulette_results.result IS '抽選結果（当たり/はずれ）';
COMMENT ON COLUMN stamp_rally_achievements.achievement_type IS '達成条件タイプ（initial_80=80%以上、continuous_6=6ヶ月連続、catch_up_100=100%達成、reset_6=リセット後6ヶ月）';
COMMENT ON COLUMN stamp_rally_achievements.notified_at IS 'Discord通知送信日時（NULL=未送信）';
