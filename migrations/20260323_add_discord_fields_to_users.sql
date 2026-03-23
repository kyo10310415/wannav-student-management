-- Add Discord integration fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(255);

-- Add index for discord_user_id lookups
CREATE INDEX IF NOT EXISTS idx_users_discord_user_id ON users(discord_user_id);

-- Add comments
COMMENT ON COLUMN users.discord_webhook_url IS 'Discord Webhook URL for notifications';
COMMENT ON COLUMN users.discord_user_id IS 'Discord User ID for mentions';
