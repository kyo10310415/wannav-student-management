-- アンケートリマインド通知履歴テーブル
CREATE TABLE IF NOT EXISTS survey_reminder_notifications (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL,
  lesson_date DATE NOT NULL,
  notification_type VARCHAR(50) NOT NULL, -- 'survey_reminder_12h', 'survey_reminder_24h'
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  discord_message_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed'
  error_message TEXT,
  CONSTRAINT unique_survey_reminder UNIQUE (student_id, lesson_date, notification_type)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_survey_reminder_student_date ON survey_reminder_notifications(student_id, lesson_date);
CREATE INDEX IF NOT EXISTS idx_survey_reminder_sent_at ON survey_reminder_notifications(sent_at);
CREATE INDEX IF NOT EXISTS idx_survey_reminder_type ON survey_reminder_notifications(notification_type);

-- コメント追加
COMMENT ON TABLE survey_reminder_notifications IS 'アンケートリマインド通知の送信履歴';
COMMENT ON COLUMN survey_reminder_notifications.student_id IS '生徒ID';
COMMENT ON COLUMN survey_reminder_notifications.lesson_date IS 'レッスン日';
COMMENT ON COLUMN survey_reminder_notifications.notification_type IS '通知タイプ (survey_reminder_12h: 12時間後, survey_reminder_24h: 24時間後)';
COMMENT ON COLUMN survey_reminder_notifications.sent_at IS '送信日時';
COMMENT ON COLUMN survey_reminder_notifications.discord_message_id IS 'Discord メッセージID';
COMMENT ON COLUMN survey_reminder_notifications.status IS 'ステータス (sent: 送信済み, failed: 失敗)';
COMMENT ON COLUMN survey_reminder_notifications.error_message IS 'エラーメッセージ';
