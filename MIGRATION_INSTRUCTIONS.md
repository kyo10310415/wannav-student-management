# Discord設定機能 - マイグレーション手順

## 問題
`discord_webhook_url` と `discord_user_id` カラムが users テーブルに存在しないため、Discord設定の保存に失敗しています。

## 解決方法

### 方法1: Render シェルで run-migration.js を実行（推奨）

1. Render ダッシュボードで「Shell」タブを開く
2. 以下のコマンドを実行:
```bash
node run-migration.js
```

### 方法2: psql で直接実行

Render の Shell で以下を実行:

```bash
psql $DATABASE_URL << 'SQL'
-- Add Discord integration fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(255);

-- Add index for discord_user_id lookups
CREATE INDEX IF NOT EXISTS idx_users_discord_user_id ON users(discord_user_id);

-- Add comments
COMMENT ON COLUMN users.discord_webhook_url IS 'Discord Webhook URL for notifications';
COMMENT ON COLUMN users.discord_user_id IS 'Discord User ID for mentions';
SQL
```

### 方法3: マイグレーションファイルを直接実行

Render の Shell で以下を実行:

```bash
psql $DATABASE_URL -f migrations/20260323_add_discord_fields_to_users.sql
```

## 確認方法

マイグレーション実行後、以下で確認:

```bash
psql $DATABASE_URL -c "\d users"
```

以下が表示されればOK:
```
discord_webhook_url | text
discord_user_id     | character varying(255)
```

## 実行後

1. ブラウザでハードリロード（Ctrl+Shift+R）
2. ユーザー管理ページで Discord設定を保存
3. 正常に保存されることを確認
