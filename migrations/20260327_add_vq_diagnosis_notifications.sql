-- VQ診断通知履歴テーブル
CREATE TABLE IF NOT EXISTS vq_diagnosis_notifications (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  student_name VARCHAR(255),
  total_score INTEGER,
  diagnosis_type VARCHAR(100),
  overview TEXT,
  details TEXT,
  diagnosis_date VARCHAR(20),
  discord_message_id VARCHAR(100),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'sent',
  error_message TEXT,
  sheet_row_number INTEGER
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_vq_diagnosis_student_id ON vq_diagnosis_notifications(student_id);
CREATE INDEX IF NOT EXISTS idx_vq_diagnosis_sent_at ON vq_diagnosis_notifications(sent_at);

-- コメント追加
COMMENT ON TABLE vq_diagnosis_notifications IS 'VQ診断結果のディスコード通知履歴';
COMMENT ON COLUMN vq_diagnosis_notifications.student_id IS '生徒ID（studentsテーブルへの外部キー）';
COMMENT ON COLUMN vq_diagnosis_notifications.student_name IS '生徒名';
COMMENT ON COLUMN vq_diagnosis_notifications.total_score IS '合計点（G+I+K列）';
COMMENT ON COLUMN vq_diagnosis_notifications.diagnosis_type IS 'タイプ+型（P列）';
COMMENT ON COLUMN vq_diagnosis_notifications.overview IS '概要（S列）';
COMMENT ON COLUMN vq_diagnosis_notifications.details IS '詳細（T列）';
COMMENT ON COLUMN vq_diagnosis_notifications.diagnosis_date IS '診断日（A列から抽出）';
COMMENT ON COLUMN vq_diagnosis_notifications.sent_at IS '送信日時';
COMMENT ON COLUMN vq_diagnosis_notifications.status IS 'ステータス（sent/error）';
COMMENT ON COLUMN vq_diagnosis_notifications.sheet_row_number IS 'スプレッドシートの行番号';

-- システム設定にVQ診断通知のON/OFF設定を追加
INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
VALUES 
  ('vq_diagnosis_notification_enabled', 'false', 'VQ診断通知のON/OFF', 'system'),
  ('vq_diagnosis_last_checked_row', '1', 'VQ診断スプレッドシートの最終チェック行', 'system')
ON CONFLICT (setting_key) DO NOTHING;
