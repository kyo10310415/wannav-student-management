# Discord一斉送信機能 実装ガイド

## 📋 機能要件

### 基本機能
- ✅ 一斉送信ページの追加（生徒関係セクションにボタン配置）
- ✅ 送信内容の手入力（テキスト + 画像）
- ✅ 送信対象: ステータスが「アクティブ」の生徒
- ✅ 担当Tutorごとに絞り込み
- ✅ 権限による制御（crew/leader/admin）
- ✅ テンプレート保存機能
- ✅ 定期自動送信

### 送信先チャンネル
スプレッドシート: `1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM`  
シート: `❶RAW_生徒様情報`

| チャンネル | 列 | 送信方法 |
|-----------|---|---------|
| お知らせ | H列（お知らせ_WH） | Webhook |
| お役立ち情報 | I列（お役立ち_WH） | Webhook |
| チャット | M列（チャットURL） | Discord Bot |

### 権限制御
- **crew**: 自分の担当生徒のみ
- **leader/admin**: 全Tutor + 全生徒

## 🗄️ データベース構造

### broadcast_messages テーブル
```sql
- id: SERIAL PRIMARY KEY
- name: VARCHAR(255) -- テンプレート名
- content: TEXT -- 送信内容
- image_url: TEXT -- 画像URL
- channel_type: VARCHAR(50) -- 'notice', 'tips', 'chat'
- target_status: VARCHAR(50) -- 'active'
- target_tutor: VARCHAR(100) -- NULL = 全Tutor
- created_by: VARCHAR(255) -- 作成者email
- is_template: BOOLEAN -- テンプレートとして保存
- is_scheduled: BOOLEAN -- 定期送信
- schedule_cron: VARCHAR(100) -- cron式
- schedule_enabled: BOOLEAN
- last_sent_at: TIMESTAMP
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

### broadcast_logs テーブル
```sql
- id: SERIAL PRIMARY KEY
- broadcast_message_id: INTEGER
- student_id: VARCHAR(50)
- student_name: VARCHAR(255)
- discord_id: VARCHAR(100)
- channel_type: VARCHAR(50)
- webhook_url: TEXT
- status: VARCHAR(50) -- 'pending', 'sent', 'failed'
- error_message: TEXT
- sent_at: TIMESTAMP
```

## 🔌 API エンドポイント

### 1. テンプレート管理
```
GET    /api/broadcast/templates      - テンプレート一覧取得
POST   /api/broadcast/templates      - テンプレート作成
PUT    /api/broadcast/templates/:id  - テンプレート更新
DELETE /api/broadcast/templates/:id  - テンプレート削除
```

### 2. 送信機能
```
POST   /api/broadcast/send           - 一斉送信実行
GET    /api/broadcast/preview        - 送信対象プレビュー
```

### 3. ログ管理
```
GET    /api/broadcast/logs           - 送信履歴取得
GET    /api/broadcast/logs/:id       - 送信詳細取得
```

### 4. 定期送信管理
```
GET    /api/broadcast/scheduled      - 定期送信一覧
POST   /api/broadcast/scheduled      - 定期送信設定
PUT    /api/broadcast/scheduled/:id  - 定期送信更新
DELETE /api/broadcast/scheduled/:id  - 定期送信削除
```

## 🎨 フロントエンド構造

### ページ構成
```
/broadcast
  ├── 送信フォーム
  │   ├── テンプレート選択
  │   ├── 送信内容入力
  │   ├── 画像アップロード
  │   ├── チャンネル選択
  │   ├── Tutor絞り込み
  │   └── 送信ボタン
  ├── プレビュー
  │   └── 送信対象生徒一覧
  ├── テンプレート管理
  │   ├── テンプレート一覧
  │   ├── 作成/編集
  │   └── 削除
  └── 送信履歴
      ├── 履歴一覧
      └── 詳細表示
```

### 実装ファイル
- `src/routes/broadcast.js` - API実装
- `src/services/broadcastService.js` - ビジネスロジック
- `public/app.js` - フロントエンド実装
  - `renderBroadcastPage()` - メインページ
  - `renderBroadcastForm()` - 送信フォーム
  - `renderBroadcastTemplates()` - テンプレート管理
  - `renderBroadcastLogs()` - 送信履歴

## 🔧 実装手順

### Phase 1: データベース (完了)
- [x] マイグレーションファイル作成
- [x] sheetsService拡張

### Phase 2: バックエンドAPI (TODO)
1. `src/routes/broadcast.js` 作成
2. `src/services/broadcastService.js` 作成
3. Discord送信ロジック実装
4. 権限チェック実装

### Phase 3: フロントエンド (TODO)
1. ページ追加（ナビゲーション）
2. 送信フォーム実装
3. テンプレート管理UI
4. 送信履歴UI

### Phase 4: 定期送信 (TODO)
1. cronジョブ設定
2. スケジューラー実装

## 📝 実装例

### Discord送信（Webhook）
```javascript
async function sendViaWebhook(webhookUrl, discordId, content, imageUrl) {
  const embed = {
    description: content,
    color: 0x5865F2,
    timestamp: new Date().toISOString()
  };
  
  if (imageUrl) {
    embed.image = { url: imageUrl };
  }
  
  const payload = {
    content: discordId ? `<@${discordId}>` : null,
    embeds: [embed]
  };
  
  await axios.post(webhookUrl, payload);
}
```

### Discord送信（Bot）
```javascript
async function sendViaBot(chatUrl, discordId, content, imageUrl) {
  const channelId = extractChannelId(chatUrl);
  const channel = await client.channels.fetch(channelId);
  
  const mention = discordId ? `<@${discordId}>` : '';
  
  const messageOptions = {
    content: `${mention}\n${content}`
  };
  
  if (imageUrl) {
    messageOptions.files = [imageUrl];
  }
  
  await channel.send(messageOptions);
}
```

## 🚀 デプロイ後の確認

1. マイグレーション実行
```sql
psql $DATABASE_URL -f migrations/20260311_add_broadcast_messages.sql
```

2. API動作確認
```bash
curl -X GET https://wannav-student-management.onrender.com/api/broadcast/templates
```

3. フロントエンド確認
```
https://wannav-student-management.onrender.com/#broadcast
```

## 📌 注意事項

- Discord API制限: 1秒あたり5リクエスト
- 大量送信時はレート制限対策（Sleep）を実装
- エラー発生時はログに記録し、ユーザーに通知
- 画像URLは事前にアップロード（Cloudflare R2など）
