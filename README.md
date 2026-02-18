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

# Notion API (別々のインテグレーションを使用する場合)
NOTION_STUDENT_API_TOKEN=your_student_token
NOTION_TUTOR_API_TOKEN=your_tutor_token
NOTION_STUDENT_DB_ID=your_student_db_id
NOTION_TUTOR_DB_ID=your_tutor_db_id

# Google Calendar API (複数カレンダー対応)
# 複数のカレンダーIDをカンマ区切りで指定
GOOGLE_CALENDAR_IDS=calendar_id_1,calendar_id_2,calendar_id_3
# または単一カレンダーの場合
# GOOGLE_CALENDAR_ID=your_calendar_id

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

1. **生徒データベース用のインテグレーション作成**
   - https://www.notion.so/my-integrations にアクセス
   - 「**New integration**」をクリック
   - 名前を入力（例: WannaV Students）
   - 「**Submit**」をクリック
   - 「**Internal Integration Token**」をコピー → `NOTION_STUDENT_API_TOKEN`
   - 生徒データベースページを開く
   - 右上の「**...**」→「**Add connections**」→作成した統合を選択

2. **Tutorデータベース用のインテグレーション作成**
   - 同様の手順で別のインテグレーションを作成
   - 名前を入力（例: WannaV Tutors）
   - トークンをコピー → `NOTION_TUTOR_API_TOKEN`
   - Tutorデータベースに統合を接続

3. **データベースIDの取得**
   - 生徒データベースのページを開く
   - URLをコピー: `https://www.notion.so/{database_id}?v=...`
   - `database_id` の部分（32文字のハイフン付き文字列）をコピー → `NOTION_STUDENT_DB_ID`
   - Tutorデータベースも同様に取得 → `NOTION_TUTOR_DB_ID`

### 2. Google Calendar API

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクト作成
2. Calendar APIを有効化
3. サービスアカウント作成
4. **各TutorのカレンダーIDを取得**
   - 各Tutorのカレンダーを右クリック→「**設定と共有**」
   - 「**カレンダーの統合**」セクション
   - 「**カレンダーID**」をコピー
   - 全TutorのカレンダーIDをカンマ区切りで環境変数に設定
   - 例: `GOOGLE_CALENDAR_IDS=tutor1@example.com,tutor2@example.com,tutor3@example.com`
5. **各カレンダーをサービスアカウントと共有**
   - 各カレンダーの「設定と共有」→「特定のユーザーと共有」
   - サービスアカウントのメールアドレスを追加
   - 権限: 「予定の表示」
6. 認証情報JSONをBase64エンコードして環境変数に設定
   ```bash
   cat credentials.json | base64 -w 0
   ```

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
