# WannaV 生徒様管理システム

VTuber育成スクール「WannaV」の生徒様情報を一元管理するシステム

## 🎯 プロジェクト概要

複数のTutorが生徒様に関する様々な情報を管理・共有できるWebアプリケーションです。

### 主な機能

#### ✅ 実装済み機能

1. **生徒一覧**
   - Notion APIから生徒情報を取得
   - 学籍番号、生徒名、ステータス、契約プラン、キャラクター名、担任Tutor

2. **Tutor一覧**
   - Notion APIからTutor情報を取得
   - 氏名、従業員ID、メールアドレス、所属チーム、Notion名、月の業務可能時間

3. **レッスン予約状況**
   - Googleカレンダーから生徒様の予約状況を取得
   - 学籍番号による照合
   - 先月・今月・来月の予約状況表示
   - 月ごとの予約回数による色分け表示
     - 0回: 赤色
     - 1回: 黄色
     - 2回: 無色
     - 3回以上: 濃い黄色

4. **担当Tutor絞り込み**
   - 担当Tutor別に生徒を絞り込み表示

5. **レッスンリマインド送信**
   - レッスン日の前日にDiscordに自動通知
   - 毎日10:00 JST（01:00 UTC）に自動実行
   - 手動送信ボタンも実装

#### 🚧 未実装機能

1. **Google Sheets API統合**
   - Discord送信先情報の取得（スプレッドシート連携）
   - 現在はプレースホルダー実装

## 📋 技術スタック

- **Backend**: Node.js + Hono
- **Database**: PostgreSQL (Render)
- **Frontend**: Vanilla JavaScript + Tailwind CSS
- **APIs**: 
  - Notion API
  - Google Calendar API
  - Discord.js
- **Deployment**: Render
- **Cron**: node-cron

## 🗂️ プロジェクト構造

```
wannav-student-management/
├── src/
│   ├── index.js              # メインサーバー
│   ├── db/
│   │   ├── connection.js     # PostgreSQL接続
│   │   └── migrate.js        # データベースマイグレーション
│   ├── services/
│   │   ├── notionService.js  # Notion API統合
│   │   ├── calendarService.js # Google Calendar API統合
│   │   ├── discordService.js # Discord Bot統合
│   │   └── reminderService.js # リマインド送信
│   └── routes/
│       ├── students.js       # 生徒API
│       ├── tutors.js         # TutorAPI
│       ├── lessons.js        # レッスンAPI
│       └── reminders.js      # リマインドAPI
├── public/
│   └── app.js                # フロントエンドJavaScript
├── package.json
├── render.yaml               # Render設定
└── .env.example              # 環境変数テンプレート
```

## 🚀 セットアップ

### 1. 環境変数設定

`.env.example` を `.env` にコピーして必要な値を設定：

```bash
# Database (Renderが自動設定)
DATABASE_URL=postgresql://...

# Notion API
NOTION_API_TOKEN=your_token
NOTION_STUDENT_DB_ID=your_student_db_id
NOTION_TUTOR_DB_ID=your_tutor_db_id

# Google Calendar API
GOOGLE_CALENDAR_ID=your_calendar_id
GOOGLE_CREDENTIALS_JSON=your_credentials_json

# Discord Bot
DISCORD_BOT_TOKEN=your_bot_token

# Server
PORT=3000
NODE_ENV=production
```

### 2. ローカル開発

```bash
# 依存関係インストール
npm install

# データベースマイグレーション
npm run db:migrate

# 開発サーバー起動
npm run dev
```

### 3. Renderデプロイ

#### 方法1: render.yaml使用

1. GitHubにプッシュ
2. Renderで「New Blueprint」を選択
3. リポジトリを接続
4. 環境変数を設定
5. デプロイ

#### 方法2: 手動セットアップ

1. Renderで新しいWeb Serviceを作成
2. リポジトリを接続
3. 設定:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
4. 環境変数を追加
5. PostgreSQLデータベースを作成して接続

## 📡 API エンドポイント

### 生徒 API

- `GET /api/students` - 全生徒取得
- `GET /api/students/sync` - Notionから同期
- `GET /api/students/:id` - 生徒詳細
- `GET /api/students/tutor/:tutorName` - Tutor別生徒一覧

### Tutor API

- `GET /api/tutors` - 全Tutor取得
- `GET /api/tutors/sync` - Notionから同期
- `GET /api/tutors/:id` - Tutor詳細

### レッスン API

- `GET /api/lessons` - 全レッスン取得
- `GET /api/lessons/sync/:year/:month` - Googleカレンダーから同期
- `GET /api/lessons/month/:year/:month` - 月別レッスン取得
- `GET /api/lessons/student/:studentId` - 生徒別レッスン取得
- `GET /api/lessons/stats/:year/:month` - 月別統計情報

### リマインド API

- `POST /api/reminders/send` - リマインド手動送信
- `POST /api/reminders/test` - テストリマインド送信

## 🔐 必要なAPI設定

### 1. Notion API

1. [Notion Developers](https://www.notion.so/my-integrations)でインテグレーション作成
2. 生徒データベースとTutorデータベースに接続
3. トークンを環境変数に設定

### 2. Google Calendar API

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクト作成
2. Calendar APIを有効化
3. サービスアカウント作成
4. カレンダーをサービスアカウントと共有
5. 認証情報JSONを環境変数に設定

### 3. Discord Bot

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーション作成
2. Botを作成してトークン取得
3. 必要な権限:
   - Send Messages
   - Read Message History
4. サーバーに招待

## 📅 Cronスケジュール

- **毎日 10:00 JST** (01:00 UTC): レッスンリマインド自動送信

## 🔧 次のステップ

1. **Google Sheets API統合**
   - Discord送信先情報の自動取得
   - スプレッドシート「❶RAW_生徒様情報」との連携

2. **追加機能実装**
   - 生徒詳細ページ
   - レッスン履歴表示
   - エクスポート機能

3. **UIの改善**
   - モバイル対応強化
   - ダッシュボード追加
   - グラフ表示

## 📄 ライセンス

MIT

## 👥 開発者

WannaV Development Team
