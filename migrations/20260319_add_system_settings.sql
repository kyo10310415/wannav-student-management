-- システム設定テーブル
CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_by VARCHAR(100),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);

-- デフォルト値を挿入
INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
VALUES 
  ('survey_notification_enabled', 'false', 'アンケート特典通知のON/OFF', 'system')
ON CONFLICT (setting_key) DO NOTHING;

-- コメント
COMMENT ON TABLE system_settings IS 'システム全体の設定を管理';
COMMENT ON COLUMN system_settings.setting_key IS '設定キー（一意）';
COMMENT ON COLUMN system_settings.setting_value IS '設定値（JSON文字列も可）';
COMMENT ON COLUMN system_settings.description IS '設定の説明';
COMMENT ON COLUMN system_settings.updated_by IS '最終更新者';
COMMENT ON COLUMN system_settings.updated_at IS '最終更新日時';
