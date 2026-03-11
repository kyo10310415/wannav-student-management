# Discord一斉送信機能 デプロイ手順

## ✅ 完了した実装

### Phase 2: バックエンド API
- ✅ `src/routes/broadcast.js` - API ルート実装完了
- ✅ `src/services/broadcastService.js` - 送信ロジック実装完了
- ✅ `src/index.js` - ブロードキャストルート登録完了

### Phase 3: フロントエンド UI
- ✅ ナビゲーションボタン追加（生徒関係セクション）
- ✅ 送信フォームUI実装
- ✅ テンプレート管理UI実装
- ✅ 送信履歴UI実装
- ✅ プレビュー機能実装

## 🚀 デプロイ手順

### 1. データベースマイグレーション（Render.com Shell）

Render.comダッシュボードで以下のSQLを実行してください：

```sql
-- Create broadcast_messages table
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  channel_type VARCHAR(50) NOT NULL,
  target_status VARCHAR(50) DEFAULT 'active',
  target_tutor VARCHAR(100),
  created_by VARCHAR(255) NOT NULL,
  is_template BOOLEAN DEFAULT false,
  is_scheduled BOOLEAN DEFAULT false,
  schedule_cron VARCHAR(100),
  schedule_enabled BOOLEAN DEFAULT false,
  last_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create broadcast_logs table
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id SERIAL PRIMARY KEY,
  broadcast_message_id INTEGER REFERENCES broadcast_messages(id),
  student_id VARCHAR(50) NOT NULL,
  student_name VARCHAR(255),
  discord_id VARCHAR(100),
  channel_type VARCHAR(50) NOT NULL,
  webhook_url TEXT,
  status VARCHAR(50) DEFAULT 'pending',
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
```

#### マイグレーション実行方法

**Option 1: Render.com Dashboard (推奨)**
1. Render.com ダッシュボードにログイン
2. `wannav-db` データベースを選択
3. **Shell** タブを開く
4. 以下のコマンドで上記SQLファイルを実行:
```bash
psql $DATABASE_URL < /path/to/migrations/20260311_add_broadcast_messages.sql
```

または直接SQLをコピー＆ペースト:
```bash
psql $DATABASE_URL
# 上記のCREATE TABLE文をペースト
```

**Option 2: ローカルpsql**
```bash
psql "postgresql://wannav_student_management_user:9vkJU0jKJC8LBt2sSdvMSCT0s8TpRElH@dpg-cu1jqebqf0us73949s1g-a.oregon-postgres.render.com/wannav_student_management?sslmode=require"
# 上記のCREATE TABLE文をペースト
```

### 2. コードデプロイ

GitHubにpushすると自動デプロイされます（既に完了）：
```bash
git push origin main
```

Render.comで自動デプロイが開始されます（約2-3分）。

### 3. 動作確認

デプロイ完了後、以下を確認してください：

#### 3.1 ページアクセス確認
1. https://wannav-student-management.onrender.com にアクセス
2. ログイン
3. 生徒関係セクションに「一斉送信」ボタンが表示されることを確認
4. 「一斉送信」をクリックして、ページが正常に表示されることを確認

#### 3.2 API動作確認
```bash
# Tutor一覧取得テスト
curl -X GET "https://wannav-student-management.onrender.com/api/broadcast/tutors" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# プレビュー取得テスト
curl -X POST "https://wannav-student-management.onrender.com/api/broadcast/preview" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetStatus": "active", "targetTutor": null}'

# テンプレート一覧取得テスト
curl -X GET "https://wannav-student-management.onrender.com/api/broadcast/templates" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

#### 3.3 機能動作確認

**送信フォーム:**
- [ ] 送信対象（アクティブ）を選択できる
- [ ] 担当Tutorを選択できる
- [ ] 送信先チャンネルを選択できる（お知らせ/お役立ち情報/チャット）
- [ ] メッセージ内容を入力できる
- [ ] 画像URLを入力できる
- [ ] 送信先プレビューが表示される（生徒数）

**プレビュー機能:**
- [ ] 「送信先を確認」ボタンで送信対象生徒一覧が表示される
- [ ] 学籍番号、生徒名、担当Tutorが表示される
- [ ] 「この内容で送信」ボタンが機能する

**権限制御:**
- [ ] クルーは自分の担当生徒のみ送信可能
- [ ] リーダー/管理者は全Tutorを選択可能
- [ ] 担当Tutorドロップダウンが権限に応じて制限される

**テンプレート管理:**
- [ ] 「テンプレート保存」ボタンでテンプレートを保存できる
- [ ] 「テンプレート管理」ボタンで保存済みテンプレートを表示できる
- [ ] テンプレートを読み込んでフォームに反映できる
- [ ] テンプレートを削除できる

**送信機能:**
- [ ] 「送信」ボタンで実際に送信できる
- [ ] 送信確認ダイアログが表示される
- [ ] 送信成功後に成功通知が表示される
- [ ] 送信失敗時にエラー通知が表示される

**送信履歴:**
- [ ] 送信履歴が表示される
- [ ] 送信日時、送信先チャンネル、送信数が表示される
- [ ] 送信成功/失敗数が表示される
- [ ] 「更新」ボタンで履歴を再読み込みできる

### 4. トラブルシューティング

#### エラー: "column 'lesson_time' does not exist"
lesson_timeカラムのマイグレーションが必要です：
```bash
psql $DATABASE_URL -c "ALTER TABLE lessons ADD COLUMN IF NOT EXISTS lesson_time VARCHAR(10);"
psql $DATABASE_URL -c "CREATE INDEX IF NOT EXISTS idx_lessons_time ON lessons(lesson_time);"
```

#### エラー: "table broadcast_messages does not exist"
ブロードキャスト関連テーブルのマイグレーションが必要です（上記手順1を実行）。

#### 送信が失敗する場合
1. Google Sheetsの生徒情報を確認:
   - スプレッドシートID: `1iqrAhNjW8jTvobkur5N_9r9uUWFHCKqrhxM72X5z-iM`
   - シート名: `❶RAW_生徒様情報`
   - 必要なカラム: B列（学籍番号）、G列（Discord ID）、H列（お知らせWebhook）、I列（お役立ち情報Webhook）、M列（チャットURL）

2. Discord Bot設定を確認:
   - 環境変数 `DISCORD_BOT_TOKEN` が設定されているか
   - Botが対象チャンネルにアクセス権限を持っているか

3. ログを確認:
   - Render.com Dashboard → Logs で詳細なエラーメッセージを確認

## 📊 データベーススキーマ

### broadcast_messages テーブル
| カラム | 型 | 説明 |
|--------|-----|------|
| id | SERIAL | 主キー |
| name | VARCHAR(255) | メッセージ/テンプレート名 |
| content | TEXT | メッセージ内容 |
| image_url | TEXT | 添付画像URL |
| channel_type | VARCHAR(50) | チャンネル種別（notice/tips/chat） |
| target_status | VARCHAR(50) | 対象ステータス |
| target_tutor | VARCHAR(100) | 対象Tutor（NULL=全員） |
| created_by | VARCHAR(255) | 作成者メールアドレス |
| is_template | BOOLEAN | テンプレートフラグ |
| is_scheduled | BOOLEAN | 定期送信フラグ |
| schedule_cron | VARCHAR(100) | cron式（定期送信用） |
| schedule_enabled | BOOLEAN | 定期送信有効フラグ |
| last_sent_at | TIMESTAMP | 最終送信日時 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

### broadcast_logs テーブル
| カラム | 型 | 説明 |
|--------|-----|------|
| id | SERIAL | 主キー |
| broadcast_message_id | INTEGER | broadcast_messagesへの外部キー |
| student_id | VARCHAR(50) | 学籍番号 |
| student_name | VARCHAR(255) | 生徒名 |
| discord_id | VARCHAR(100) | Discord ID |
| channel_type | VARCHAR(50) | チャンネル種別 |
| webhook_url | TEXT | Webhook URL |
| status | VARCHAR(50) | 送信状態（pending/sent/failed） |
| error_message | TEXT | エラーメッセージ |
| sent_at | TIMESTAMP | 送信日時 |

## 🔮 今後の拡張機能（Phase 4）

### 定期自動送信機能
- cron式による定期送信設定
- 毎日、毎週、毎月などのスケジュール設定
- 送信時刻の指定
- 自動送信の有効/無効切り替え

**実装予定:**
- `src/services/scheduledBroadcastService.js` - スケジューラサービス
- `src/index.js` - cronタスク登録
- フロントエンド: スケジュール設定UI

## 📞 サポート

問題が発生した場合は、以下を確認してください：

1. **GitHub リポジトリ:** https://github.com/kyo10310415/wannav-student-management
2. **本番環境:** https://wannav-student-management.onrender.com
3. **Render.com Dashboard:** ログとエラーメッセージを確認
4. **実装ドキュメント:** `/home/user/webapp/BROADCAST_IMPLEMENTATION.md`

## ✅ チェックリスト

デプロイ前確認:
- [x] Phase 2: バックエンドAPI実装完了
- [x] Phase 3: フロントエンドUI実装完了
- [x] README.md更新
- [x] GitHubにpush完了

デプロイ後確認:
- [ ] データベースマイグレーション実行
- [ ] Render.com自動デプロイ完了確認
- [ ] ページアクセス確認
- [ ] API動作確認
- [ ] 送信機能テスト
- [ ] テンプレート機能テスト
- [ ] 権限制御確認

---

**最終更新:** 2026-03-11
**コミット:** c01a61b
