-- Create broadcast_messages table for storing message templates and history
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  channel_type VARCHAR(50) NOT NULL, -- 'notice', 'tips', 'chat'
  target_status VARCHAR(50) DEFAULT 'active',
  target_tutor VARCHAR(100), -- NULL means all tutors
  created_by VARCHAR(255) NOT NULL,
  is_template BOOLEAN DEFAULT false,
  is_scheduled BOOLEAN DEFAULT false,
  schedule_cron VARCHAR(100), -- cron expression for scheduled messages
  schedule_enabled BOOLEAN DEFAULT false,
  last_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create broadcast_logs table for tracking sent messages
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id SERIAL PRIMARY KEY,
  broadcast_message_id INTEGER REFERENCES broadcast_messages(id),
  student_id VARCHAR(50) NOT NULL,
  student_name VARCHAR(255),
  discord_id VARCHAR(100),
  channel_type VARCHAR(50) NOT NULL,
  webhook_url TEXT,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_messages_created_by ON broadcast_messages(created_by);
CREATE INDEX IF NOT EXISTS idx_broadcast_messages_is_template ON broadcast_messages(is_template);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_broadcast_id ON broadcast_logs(broadcast_message_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_student_id ON broadcast_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_status ON broadcast_logs(status);

COMMENT ON TABLE broadcast_messages IS 'Discord broadcast message templates and scheduled messages';
COMMENT ON TABLE broadcast_logs IS 'Log of sent broadcast messages';
