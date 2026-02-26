# WannaV 生徒様管理システム

VTuber育成スクール「WannaV」の生徒様情報を一元管理するシステム

## 🎯 プロジェクト概要

複数のTutorが生徒様に関する様々な情報を管理・共有できるWebアプリケーションです。

### 主な機能

#### ✅ 実装済み機能

**マルチページシステム**
- **予約管理ページ**: レッスン予約状況、お支払い状況、レッスン日を含む完全な情報表示
- **生徒管理ページ**: 基本情報、レッスン進捗、レッスン開始日・継続月数、リザルトスコア、欠席回数を表示（お支払い、予約、レッスン日を除外）
- **Tutor管理ページ**: Tutor情報の一覧表示と統計
- **NEW: 今日のレッスンページ**: 本日レッスンがある生徒様の一覧表示とレッスン報告フォームへのリンク

1. **生徒一覧**
   - Notion APIから生徒情報を取得（Google Sheets経由でキャッシュ、1日1回自動更新）
   - 学籍番号、生徒名、ステータス、契約プラン、キャラクター名、担任Tutor、レッスン進捗
   - **NEW**: レッスン開始日と継続月数（外部PostgreSQLから自動取得）
   - ステータス別タブ表示（アクティブ、在籍プラン、正規退会、無断キャンセル）
   - アクティブ内サブタブ（レッスン中、PROプラン、永久会員）

2. **Tutor一覧**（Tutor管理ページ）
   - Notion APIからTutor情報を取得（Google Sheets経由でキャッシュ）
   - 表示項目: 従業員ID、Tutor名、メールアドレス、所属チーム、ステータス
   - **NEW**: チーム絞り込み機能
     - ドロップダウンで「全体」または特定チームを選択
     - Tutor一覧のみにフィルター適用（統計情報は全チーム固定表示）
   - **NEW**: 全体統計情報（アクティブTutorのみ）
     - アクティブTutor数、所属チーム数
     - 満足度平均（0-100スケール）
     - 回収率平均（%）
     - 満足度スコア平均
     - 条件付き色分け: 基準値未満は赤文字で警告
   - **NEW**: チーム別統計情報テーブル
     - 全チームの統計を固定表示（チーム絞り込みとは独立）
     - 各チームのTutor数、満足度平均、回収率平均、満足度スコア平均
     - 条件付き色分け: 基準値未満は赤文字
   - **NEW**: アクティブ生徒数の自動計算
     - 担当Tutorがそのtutorの生徒数をカウント（Notion名で照合）
     - ステータス「アクティブ」のみ
     - 契約プラン「永久会員」「在籍プラン」を除外
   - **NEW**: 生徒数上限の手入力（inline編集可能）
   - **NEW**: 残り受け入れ可能人数の自動計算と色分け表示
     - 計算式: 生徒数上限 - アクティブ生徒数
     - 色分け: 0以下（赤/太字）、1-2名（オレンジ）、3名以上（緑）
   - **NEW**: レッスン満足度の表示
     - Google Sheetsから満足度データを取得（「レッスン満足度データ」シート）
     - 計算式: 平均評価 × 10（0-10スケール → 0-100スケール、MAX値100）
     - 表示月の満足度を表示（小数第2位まで）
     - 条件付き色分け: 80未満は赤文字、80以上は紫文字
     - 過去のデータも含めた満足度推移グラフ表示
     - 「満足度」ボタンで詳細モーダルを表示
       - 表示月のフィードバック（生徒名、評価、理由）
       - 評価を2グループに分離表示:
         - 高評価（9以上）: 緑テーマ、スマイルアイコン
         - 改善余地（8以下）: オレンジテーマ、困り顔アイコン
       - 過去の満足度推移グラフ（Chart.js使用）
   - **NEW**: 回収率の表示
     - 計算式: 表示月の満足度件数 ÷ アクティブ生徒数 × 100（小数第1位まで）
     - 条件付き色分け: 50未満は赤文字、50以上は緑文字
     - 満足度アンケートの回答率を可視化
   - **NEW**: 満足度スコアの表示
     - 計算式: レッスン満足度 × 回収率 ÷ 100（小数第2位まで）
     - 例: レッスン満足度99.63、回収率25% → 99.63 × 25 / 100 = 24.91
     - 条件付き色分け: 60未満は赤文字、60以上はインディゴ文字
     - Tutorの総合評価指標として活用
     - モーダル内でも表示、グラフにも追加
   - アクティブ/非アクティブ統計表示

3. **レッスン進捗表示**（生徒管理・今日のレッスンページ）
   - Google Sheetsから進捗データを自動取得
   - 学籍番号で照合、最新のレッスン番号を表示
   - **NEW**: レッスン進捗の視覚的色分け（ファーストビュー対応）
     - 進捗目安: 継続月数 × 2
     - 正常（青背景）: レッスン進捗 ≥ 進捗目安
     - 遅い（黄色背景）: 進捗目安の50%以上100%未満
     - 非常に遅い（赤背景）: 進捗目安の50%未満
   - 一目で進捗状況を把握可能

4. **レッスン開始日・継続月数**（生徒管理ページ）
   - 外部PostgreSQL（wannav-extension-db）からレッスン開始日を自動取得
   - バックエンドAPI経由でGASスクリプトがデータを取得
   - 開始日から現在までの継続月数を自動計算して表示
   - **NEW**: 休会期間を考慮した継続月数表示
   - 休会歴がある生徒は継続月数から休会期間を減算
   - データソース: 
     - レッスン開始日: `notion_students_cache` テーブルの `lesson_start_date` カラム
     - 休会期間: スプレッドシート「フォームの回答 1」（H列: 学籍番号、K列: 休会期間）

5. **リザルトスコア表示**（生徒管理・今日のレッスンページ）
   - 前月のリザルトスコア（総合評価のみ）を表示
   - スプレッドシートから自動取得（シート名: 評価結果_YYYY-MM）
   - **NEW**: S～Dランクの色分け表示
     - S: 紫（太字）、A: 青（太字）、B: 緑、C: 黄色、D: 赤
   - シンプルで分かりやすい評価表示

6. **欠席回数表示**（生徒管理ページ）
   - レッスン進捗スプレッドシートから欠席回数を集計
   - 色分け表示: 3回超（赤/太字）、1回以上（オレンジ）、0回（グレー）

7. **レッスン予約状況**（予約管理ページのみ）
   - Google Apps Script（GAS）が定期的にGoogleカレンダーからデータを取得
   - Googleスプレッドシートに保存
   - アプリはスプレッドシートから予約状況を読み込み
   - 学籍番号による照合
   - 先月・今月・来月の予約状況表示
   - 月ごとの予約回数による色分け表示
     - 0回: 赤色
     - 1回: 黄色
     - 2回: 無色
     - 3回以上: 水色
   - **差分更新**: 16,000件以上のイベントを効率的に処理（約30〜60秒）
   - メールアドレスの大文字小文字を正規化してカレンダー照合の精度向上

8. **お支払い状況表示**（予約管理ページのみ）
   - スプレッドシート「RAW_支払い状況」から前月と今月の支払い状況を取得
   - 表示月に応じて適切な月の支払い状況を表示（例: 2月表示時は1月の支払い状況）
   - 色分け表示:
     - 支払い完了: 緑色
     - 未払い・未払い（連絡なし）: 赤色・太字
     - 未払い（遅れ）: 赤色
   - 月ごとの年月情報も保存（例: 2026/1, 2026/2）

9. **担当Tutor絞り込み**
   - 担当Tutor別に生徒を絞り込み表示（Tutor名で表示）
   - 当月のレッスン日表示（予約管理ページのみ）

10. **レッスンリマインド送信**（予約管理ページのみ）
   - レッスン日の前日にDiscordに自動通知
   - 毎日10:00 JST（01:00 UTC）に自動実行
   - 手動送信ボタンも実装

11. **NotionとDiscordへのリンク**
   - 各生徒のNotionページへの直接リンク（アイコンボタン）
   - Discordチャンネルへの直接リンク（アイコンボタン）

12. **NEW: 今日のレッスンページ**（デフォルト表示ページ）
   - アプリ起動時に最初に表示されるページ
   - 本日レッスンがある生徒様の一覧表示
   - レッスン報告フォーム（Googleフォーム）へのリンクボタン
   - 担当Tutor絞り込み機能
   - レッスン進捗、継続月数、リザルト総合、欠席回数を表示
   - 進捗状況の色分け表示（青/黄/赤背景）
   - NotionとDiscordへの直接リンク

#### 🚧 未実装機能

（現在すべての主要機能が実装済み）

## 📋 技術スタック

- **Backend**: Node.js + Hono
- **Database**: PostgreSQL (Render) + 外部PostgreSQL (wannav-extension-db)
- **Frontend**: Vanilla JavaScript + Tailwind CSS
- **Calendar Sync**: Google Apps Script (GAS) + Google Sheets
- **APIs**: 
  - Notion API
  - Google Sheets API
  - Google Calendar API (via GAS)
  - Discord.js
  - External PostgreSQL API (レッスン開始日取得用)
- **Deployment**: Render (Backend) + Google Apps Script (Calendar Sync)
- **Cron**: node-cron (Backend) + Time-based Triggers (GAS)

## 🗂️ プロジェクト構造

```
wannav-student-management/
├── src/
│   ├── index.js              # メインサーバー
│   ├── db/
│   │   ├── connection.js     # PostgreSQL接続
│   │   ├── externalConnection.js # 外部PostgreSQL接続
│   │   └── migrate.js        # データベースマイグレーション
│   ├── services/
│   │   ├── notionService.js  # Notion API統合
│   │   ├── sheetsService.js  # Google Sheets API統合
│   │   ├── calendarService.js # Google Calendar API統合（レガシー）
│   │   ├── discordService.js # Discord Bot統合
│   │   ├── reminderService.js # リマインド送信
│   │   ├── cacheService.js   # キャッシュデータ取得
│   │   └── externalDbService.js # 外部DBからレッスン開始日取得
│   └── routes/
│       ├── students.js       # 生徒API
│       ├── tutors.js         # TutorAPI
│       ├── lessons.js        # レッスンAPI
│       ├── reminders.js      # リマインドAPI
│       └── external.js       # 外部DBデータAPI
├── public/
│   └── app.js                # フロントエンドJavaScript
├── gas-calendar-sync.js          # GASスクリプト（全件更新版・初回セットアップ用）
├── gas-calendar-sync-incremental.js # GASスクリプト（差分更新版・本番運用推奨）
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

# External Database (レッスン開始日・継続月数取得用)
EXTERNAL_DATABASE_URL=postgresql://wannav_user:password@dpg-d5kbgqvgi27c739nefs0-a.oregon-postgres.render.com/wannav_extension

# Notion API (別々のインテグレーションを使用する場合)
NOTION_STUDENT_API_TOKEN=your_student_token
NOTION_TUTOR_API_TOKEN=your_tutor_token
NOTION_STUDENT_DB_ID=your_student_db_id
NOTION_TUTOR_DB_ID=your_tutor_db_id

# Google Calendar API (via Google Sheets)
# GASスクリプトがカレンダーからデータを取得してスプレッドシートに保存
# アプリはスプレッドシートから読み取り
GOOGLE_SHEET_ID=your_spreadsheet_id
GOOGLE_CREDENTIALS_JSON=your_credentials_json

# Discord Bot
DISCORD_BOT_TOKEN=your_bot_token

# Discord Reminders (一時的にオフにする場合は false に設定)
DISCORD_REMINDERS_ENABLED=false

# Server
PORT=3000
NODE_ENV=production
```

**重要**: 
- システム完成までDiscord通知をオフにする場合は `DISCORD_REMINDERS_ENABLED=false` に設定
- 完成後に有効化する場合は `DISCORD_REMINDERS_ENABLED=true` に変更（または削除）

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
- `GET /api/lessons/sync-from-sheet` - Googleスプレッドシートから同期（GAS経由）
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

### 2. Google Calendar API（GAS経由）

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクト作成
2. **Calendar API** と **Sheets API** を有効化
3. サービスアカウント作成してJSONキーをダウンロード
4. 認証情報JSONをBase64エンコードして環境変数に設定
   ```bash
   cat credentials.json | base64 -w 0
   ```

### 3. Google Sheets + GAS セットアップ

#### スプレッドシート作成

1. 新しいGoogleスプレッドシートを作成: `WannaV レッスンデータ同期`
2. URLからスプレッドシートIDをコピー
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```
3. スプレッドシートをサービスアカウントと共有
   - 「共有」ボタンをクリック
   - サービスアカウントのメールアドレスを追加
   - 権限: **閲覧者**

#### GASスクリプト設定

**推奨**: 差分更新版（`gas-calendar-sync-incremental.js`）を使用

1. スプレッドシート内で「拡張機能」→「Apps Script」
2. `gas-calendar-sync-incremental.js` の内容をコピー&ペースト
3. 設定を変更:
   ```javascript
   const SPREADSHEET_ID = 'your_spreadsheet_id';
   const NOTION_TUTOR_API_TOKEN = 'your_tutor_notion_token';
   const NOTION_TUTOR_DB_ID = 'your_tutor_database_id';
   ```
4. **初回実行**: 関数 `testIncrementalSync` を実行（権限承認）
5. **トリガー設定**: 関数 `setupIncrementalTrigger` を実行
   - 30分ごとに自動同期（差分更新版）

**全件更新版**（初回セットアップ用）:
- `gas-calendar-sync.js` を使用
- `setupHourlyTrigger` で1時間ごとに実行
- データが0件の場合や、全件洗い替えが必要な場合に使用

#### GAS処理フロー

```
1. Notion API → Tutorメールアドレス取得（小文字に正規化）
2. 各Tutorのカレンダー → イベント取得（差分期間のみ）
3. Googleスプレッドシート → データ保存（新規・更新・削除を検知）
4. Renderアプリ → スプレッドシートから読み込み
```

**差分更新の特徴**:
- 初回: 約90〜120秒（全件処理）
- 2回目以降: 約30〜60秒（差分のみ）
- 16,000件以上のイベントを効率的に処理
- GAS実行時間制限（6分）以内に完了
- 更新対象期間: 過去7日〜未来60日（カスタマイズ可能）
- メールアドレスの大文字小文字を自動正規化

**差分更新の仕組み**:
1. 既存データを読み込み（イベントIDをキーにしたマップ）
2. カレンダーから差分期間のイベントを取得
3. 新規・更新・削除を検出
   - 新規: イベントIDが存在しない → 追加
   - 更新: イベントIDは存在するが内容が変更 → 更新
   - 削除: 差分期間内のイベントIDがカレンダーに存在しない → 削除
4. バッチ更新で一度に反映（APIコール数を最小化）

### 4. Discord Bot

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーション作成
2. Botを作成してトークン取得
3. 必要な権限:
   - Send Messages
   - Read Message History
4. サーバーに招待

## 📅 自動実行スケジュール

### Renderアプリ（Backend）
- **毎日 10:00 JST** (01:00 UTC): レッスンリマインド自動送信

### Google Apps Script
- **30分ごと**: カレンダーデータ同期（差分更新・推奨）
- **1時間ごと**: カレンダーデータ同期（全件更新・初回セットアップ用）
- 実行時間: 約30〜60秒（差分更新）/ 約90〜120秒（全件更新）
- 16,000件以上のイベントを効率的に処理

## 📝 最新の更新履歴

### 2026-02-26: 今日のレッスンページの修正
- **問題**: 今日のレッスンページでデータが表示されない
- **原因**: `loadLessonDates()` が「表示中の月」のデータしか取得せず、今日の日付と一致しない
- **修正内容**:
  - `renderApp()` と `changePage()` を async 関数に変更してデータ読み込みを適切に待機
  - `renderTodayLessonsPage()` で `loadTodayLessonDates()` を呼び出し、常に現在月のデータを取得
  - デバッグログを追加して今日の生徒数フィルタリングを追跡
  - ローカル開発用の PM2 ecosystem 設定ファイルを追加
- **デプロイ**: GitHub プッシュ完了、Render.com で自動デプロイ中

## 🔧 次のステップ

1. **Discord送信先情報の自動取得**
   - スプレッドシート「❶RAW_生徒様情報」からDiscord URLとIDを自動取得
   - 現在はプレースホルダー実装

2. **追加機能実装**
   - 生徒詳細ページ
   - レッスン履歴表示
   - エクスポート機能
   - カレンダー表示

3. **UIの改善**
   - モバイル対応強化
   - ダッシュボード追加
   - グラフ表示（Chart.js）

4. **パフォーマンス最適化**
   - データベースインデックス最適化
   - キャッシュ機構追加
   - ページネーション実装

## 📄 ライセンス

MIT

## 👥 開発者

WannaV Development Team
