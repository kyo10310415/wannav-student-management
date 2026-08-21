# WannaV 中央管理システム

VTuber育成スクール「WannaV」の情報を一元管理するシステム

## 🔐 ログイン機能

### 認証システム

システムへのアクセスには**ログインが必須**です。

**権限レベル:**
- **管理者（admin）**: 全機能 + ユーザー管理 + 月別不参加集計閲覧
- **リーダー（leader）**: 全機能（ユーザー管理を除く） + 月別不参加集計閲覧
- **クルー（crew）**: 全機能（ユーザー管理・月別不参加集計を除く）

**初期セットアップ（本番環境のみ）:**
```bash
# 1. マイグレーション実行
node run-migration.js

# 2. 管理者ユーザーを作成
node create-admin.js admin@example.com 1111

# 3. ログイン
# メール: admin@example.com
# パスワード: 1111

# 4. 初回ログイン時に新しいパスワードを設定
```

**パスワード管理:**
- 初期パスワード: `1111`
- 初回ログイン時に変更必須
- 管理者はいつでもパスワードをリセット可能（→ 1111に戻る）
- セッション有効期限: 7日間

**ユーザー管理（管理者のみ）:**
- ユーザー追加: メールアドレスと権限を指定
- 権限変更: ドロップダウンから選択
- パスワードリセット: 初期値（1111）に戻す
- ユーザー削除: 完全に削除

**Tutor名の表示:**
- usersテーブルのemailとtutorsテーブルのemailを照合
- 一致すればTutor名を表示
- 一致しなければメールアドレスを表示

---

## 🎯 プロジェクト概要

複数のTutorが生徒様に関する様々な情報を管理・共有できるWebアプリケーションです。

### 主な機能

#### ✅ 実装済み機能

**マルチページシステム**
- **予約管理ページ**: レッスン予約状況、お支払い状況、レッスン日・時間を含む完全な情報表示
  - **NEW**: 予約回数フィルター（すべて / 2回以上 / 2回未満）
  - **NEW**: レッスン日に時間を表示（例: 3/11 13:00）
- **生徒管理ページ**: 基本情報、レッスン進捗、レッスン開始日・継続月数、リザルトスコア、欠席回数を表示（お支払い、予約、レッスン日を除外）
- **Tutor管理ページ**: Tutor情報の一覧表示と統計
  - **NEW**: 助っ人依頼回数・受諾回数・リスケ回数の表示
  - **NEW**: カウンター色分け（5回以上でオレンジ、10回以上で赤）
- **今日のレッスンページ**: 本日レッスンがある生徒様の一覧表示とレッスン報告フォームへのリンク
  - **NEW**: レッスン時間を表示（例: 13:00）
- **NEW: Discord一斉送信ページ**: 生徒への一斉メッセージ送信機能
  - テキスト + 画像の送信対応
  - 送信先チャンネル選択（お知らせ / お役立ち情報 / チャット）
  - ステータス別フィルター（アクティブ生徒のみ）
  - 担当Tutor別フィルター
  - 権限別アクセス制御:
    - **クルー**: 自分の担当生徒のみ送信可能
    - **リーダー/管理者**: 全Tutorの生徒に送信可能
  - テンプレート保存・読み込み機能
  - 送信履歴の閲覧
  - 送信前プレビュー機能
- **NEW: VQ診断管理ページ**: VQ診断結果の自動Discord通知
  - Google Sheets から診断結果を自動取得（GAS）
  - 生徒のDiscordチャンネルに診断結果を自動送信
  - システムON/OFF切り替え機能
  - 送信履歴の閲覧（送信日時、生徒名、合計点、診断タイプ、状態）
  - エラー時の再送信機能
  - 重複送信防止（同一診断タイプを30日以内に複数回送信しない）
  - 月別統計表示（今月の送信数、全期間の送信数、エラー数）

1. **生徒一覧**
   - Notion APIから生徒情報を取得（Google Sheets経由でキャッシュ、1日1回自動更新）
   - 学籍番号、生徒名、ステータス、契約プラン、キャラクター名、担任Tutor、レッスン進捗
   - **NEW**: レッスン開始日と継続月数（外部PostgreSQLから自動取得）
   - ステータス別タブ表示（アクティブ、在籍プラン、正規退会、無断キャンセル）
   - アクティブ内サブタブ（レッスン中、PROプラン、永久会員）

2. **Tutor一覧**（Tutor管理ページ）
   - Notion APIからTutor情報を取得（Google Sheets経由でキャッシュ）
   - 表示項目: 従業員ID、Tutor名、所属チーム、ステータス
   - **NEW**: メールアドレスは非表示（プライバシー保護）
   - **NEW**: 助っ人Tutorカウンター表示
     - 助っ人依頼回数: Tutorが助っ人を依頼した回数
     - 助っ人受諾回数: Tutorが他の依頼を受諾した回数
     - リスケ回数: 期限切れになった依頼の回数
     - カウンター色分け（助っ人依頼・リスケ回数）:
       - 0-4回: 通常色（グレー）
       - 5-9回: オレンジ色（警告）
       - 10回以上: 赤色（注意）
     - 助っ人受諾回数: 常に通常色（グレー）
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
     - 計算式: 表示月の満足度件数 ÷ 対象生徒数 × 100（小数第2位まで）
     - 毎月25日までは、アクティブかつ「永久会員」「在籍プラン」以外の担当生徒を分母に使用
     - 毎月26日以降は、表示月に1回以上レッスンが「実施済み」の生徒だけを分母に使用
     - 26日以降に初回レッスンが実施された生徒は、その時点から分母に追加
     - 条件付き色分け: 50未満は赤文字、50以上は緑文字
     - 満足度アンケートの回答率を可視化
   - **NEW**: 満足度スコアの表示
     - 計算式: レッスン満足度 × 回収率 ÷ 100（小数第2位まで）
     - 例: レッスン満足度99.63、回収率25% → 99.63 × 25 / 100 = 24.91
     - 条件付き色分け: 60未満は赤文字、60以上はインディゴ文字
     - Tutorの総合評価指標として活用
     - モーダル内でも表示、グラフにも追加
     - スプレッドシート書き出しも画面と同じ0-100スケールと計算式を使用
   - **NEW**: レッスン進捗インジケーター
     - 担当生徒のレッスン進捗状況を〇で視覚化
     - 色の判定基準:
       - 🔴 赤: 遅い≥70% OR 非常に遅い≥50% OR 合計≥80%
       - 🟡 黄色: 遅い≥50% OR 非常に遅い≥20% OR 合計≥50%
       - 🔵 青: 上記以外（正常）
       - ⚪ グレー: データなし
     - ホバーで詳細表示（正常・遅い・非常に遅いの内訳と割合）
   - アクティブ/非アクティブ統計表示

3. **レッスン進捗表示**（生徒管理・今日のレッスンページ）
   - Google Sheetsから進捗データを自動取得
   - 学籍番号で照合、最新のレッスン番号を表示
   - **NEW**: レッスン進捗の視覚的色分け（ファーストビュー対応）
     - 進捗目安: 継続月数 × 2
     - 正常（青背景）: 進捗目安の70%以上
     - 遅い（黄色背景）: 進捗目安の40%～69%
     - 非常に遅い（赤背景）: 進捗目安の40%未満
     - 例: 5ヶ月継続 → 目安10レッスン、7レッスン = 70% → 正常
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
   - **NEW**: 予約回数絞り込み機能
     - すべて / 2回以上 / 2回未満でフィルター可能
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
   - **NEW**: 通知にGoogle Meetリンク（H列）を含めて表示
     - 日時、担任講師、Meetリンクを一覧表示
     - リンクが無い場合は「（リンクなし）」と表示
   - 毎日17:00 JST（08:00 UTC）に自動実行
   - 手動送信ボタンも実装

11. **NotionとDiscordへのリンク**
   - 各生徒のNotionページへの直接リンク（アイコンボタン）
   - Discordチャンネルへの直接リンク（アイコンボタン）

12. **NEW: 今日のレッスンページ**（デフォルト表示ページ）
   - アプリ起動時に最初に表示されるページ
   - 本日レッスンがある生徒様の一覧表示
   - レッスン報告フォーム（Googleフォーム）へのリンクボタン
   - **NEW**: 各生徒のGoogle Meetリンクをボタン表示
     - 青色の「Meet」ボタンをクリックで直接Google Meetに参加可能
     - リンクが無い場合は「-」と表示
   - **NEW**: Discord自動リマインド通知にGoogle Meetリンク（H列）を追加表示
   - 担当Tutor絞り込み機能
   - レッスン進捗、継続月数、リザルト総合、欠席回数を表示
   - 進捗状況の色分け表示（青/黄/赤背景）
   - NotionとDiscordへの直接リンク

13. **統計情報**（予約管理・生徒管理ページ共通）
   - **集計対象**: ステータス「アクティブ」かつ契約プラン「レッスン中」または「PROプラン」のみ
   - 「レッスン中」= PROプラン、永久会員、在籍プラン以外のアクティブ生徒
   - **予約管理ページ**: 総生徒数、予約0回、予約1回、予約3回以上（担当Tutor絞り込みに連動）
   - **生徒管理ページ**: 総生徒数、レッスン中人数、PROプラン人数

14. **NEW: スプレッドシート風フィルター・ソート機能**（生徒管理ページ）
   - **カラム別フィルター**: 各カラムのフィルターアイコンをクリックして絞り込み
     - 対応カラム: 学籍番号、生徒名、ステータス、契約プラン、キャラ名、担任Tutor、リザルト総合
     - **テキスト検索**: モーダル上部の検索ボックスで手入力検索
       - リアルタイムで選択肢をフィルタリング
       - 部分一致検索（大文字小文字を区別しない）
       - リストにない値も入力可能
     - **選択式**: ラジオボタンで既存値から選択
     - 複数カラムで同時にフィルター適用可能
     - 他のフィルター適用中でも全選択肢を表示
   - **カラム別ソート**: 各カラムのソートアイコンをクリックして昇順/降順切り替え
     - 対応カラム: 上記フィルター対応カラム + レッスン進捗、開始日、継続月数、欠席回数
     - 数値・日付フィールドは適切にソート
     - ソート中のカラムはアイコンで視覚的に表示
   - **フィルター・ソートクリアボタン**: ワンクリックで全フィルター・ソートをリセット
   - **Tutor名の自動変換**: 表示名（XXX先生）とNotion名（先生XXX）を自動変換

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

#### ⚠️ 本番環境でのマイグレーション実行

本番環境（Render）でマイグレーションを実行する場合:

```bash
# Renderのシェルから実行
node run-migration.js
```

または、Render環境変数 `DATABASE_URL` を使用してローカルから実行:

```bash
# 環境変数を設定（Renderの DATABASE_URL を使用）
export DATABASE_URL="postgresql://user:password@host:5432/database"

# マイグレーション実行
npm run db:migrate
```

**最新のマイグレーション:**
- `20260323_add_is_test_to_roulette_results.sql` - テスト抽選フラグ追加

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

### 2026-03-27: VQ診断通知システムの実装（GAS不要版）
- **要望**: VQ診断結果をスプレッドシートから自動取得してDiscordに送信したい
- **実装内容**:
  - **データベース**: `vq_diagnosis_notifications` テーブル追加（送信履歴を記録）
    - 学籍番号で紐付け（`student_id` は `students.id` への外部キー）
    - 診断日（A列のタイムスタンプから抽出）
    - スプレッドシートの行番号を記録
  - **自動チェック**: 5分に1回、スプレッドシートをチェック
    - Google Sheets API で直接読み取り（GAS不要）
    - 前回チェックした最終行を記憶（増分チェック）
    - R列（メール送信済み）が空欄の行のみ処理
    - 送信後、R列に「完了」を書き込み
  - **データ取得**: スプレッドシート「診断結果」シートから以下を読み取り
    - A列: タイムスタンプ（日付のみ抽出）
    - B列: 学籍番号（生徒との紐付けに使用）
    - G列 + I列 + K列: 合計点
    - P列: 診断タイプ
    - S列: 概要
    - T列: 詳細
    - R列: メール送信済み（チェック＆更新）
  - **API**: VQ診断関連のエンドポイント追加
    - `GET /api/vq-diagnosis/status`: システム状態取得
    - `POST /api/vq-diagnosis/toggle`: システムON/OFF切り替え
    - `POST /api/vq-diagnosis/check`: 手動チェック実行
    - `GET /api/vq-diagnosis/history`: 送信履歴取得
    - `GET /api/vq-diagnosis/student/:studentId`: 学籍番号で生徒の全履歴取得
    - `POST /api/vq-diagnosis/resend/:id`: 再送信
  - **Discord送信**: `sendDiscordVQDiagnosis()` 関数追加
    - Webhook URLで送信（生徒のDiscordチャンネル）
    - Embedメッセージ形式（診断日、合計点、診断タイプ、概要、詳細）
    - 紫色テーマ（VQ診断専用）
  - **フロントエンド**: VQ診断管理ページ追加
    - システムON/OFFトグル
    - 手動チェックボタン（即座にチェック＆送信）
    - 統計カード（送信済み、エラー、今月の送信、システム状態）
    - 送信履歴テーブル（診断日、送信日時、学籍番号、生徒名、合計点、診断タイプ、状態）
    - 学籍番号クリックで生徒の全診断履歴を表示（モーダル）
    - スプレッドシートへのリンク
  - **履歴管理**: 1人の生徒に複数の診断レコードが存在可能
    - 学籍番号をクリックすると、その生徒の全診断履歴を時系列で表示
    - 各診断の詳細（診断日、合計点、タイプ、概要、詳細）を確認可能
- **データソース**: [VQ診断結果スプレッドシート](https://docs.google.com/spreadsheets/d/1_yJtJn8DMFkQBtdIkDWHNBE8-kpHyE3-0FY_oe0EhJ0/edit)
- **結果**: 
  - VQ診断結果が5分以内に自動的に生徒のDiscordに届くようになった
  - GAS不要で完全にサーバー内で完結
  - 送信済みデータの重複処理を防止
  - 生徒ごとの診断履歴を簡単に確認可能

### 2026-03-10: Discord自動リマインド通知と今日のレッスンページにGoogle Meetリンクを追加
- **要望**: 今日のレッスンページとDiscordへのリマインド通知にMeetリンク（H列）を追加したい
- **実装内容**: 
  - Google Apps Script (GAS) でカレンダーイベントからMeetリンクを取得
    - Calendar API の `hangoutLink` プロパティを優先取得
    - `conferenceData.entryPoints` から video 形式のエントリーポイントを取得
    - 正規表現による description からの抽出をフォールバックとして実装
  - スプレッドシート「レッスン予約データ」のH列に保存
  - **今日のレッスンページにMeetリンク列を追加**
    - 各生徒の行に青色の「Meet」ボタンを表示
    - クリックで直接Google Meetに参加可能
    - リンクが無い場合は「-」と表示
  - Discordリマインド通知にMeetリンクを表示
    - `/api/reminders/send` (自動実行: 毎日17:00 JST)
    - `/api/reminders/test-notification` (手動テスト)
  - メッセージフォーマット:
    ```
    日時: 2026/03/11 10:00:00
    担任講師: 山田太郎
    Google Meetリンク: https://meet.google.com/xxx-xxxx-xxx
    ```
  - リンクが無い場合は「（リンクなし）」と表示
- **技術詳細**:
  - `extractMeetLinkAdvanced()` 関数を新設（GAS側）
  - イベントID形式の正規化処理（`@google.com`除去、`_`区切り対応）
  - Calendar API 呼び出しのキャッシュ化で実行時間短縮（14,000イベントで約8分 → 2-3分）
  - `needsUpdate()` 関数でMeetリンク列（H列）の変更検出に対応
  - フロントエンド: `loadTodayLessonDates()` でMeetリンクを取得し、各生徒行に表示
- **GASスクリプト**: `/home/user/webapp/gas-calendar-sync-FINAL.js` (1,542行)
- **結果**: 約97%のレッスンイベントでMeetリンクを自動取得・通知可能に

### 2026-02-26 (8): 生徒管理ページに進捗状況の色分け凡例を追加
- **要望**: 生徒管理ページの背景色の色分け条件をUI上に表示したい
- **追加内容**: 
  - 統計情報とステータスタブの間に視覚的な凡例セクションを追加
  - 3つの進捗状態を色分けカードで表示
    - **青色（正常）**: レッスン進捗 ≧ 継続月数×2、チェックマークアイコン
    - **黄色（遅い）**: 進捗目安の50%～99%、感嘆符アイコン
    - **赤色（非常に遅い）**: 進捗目安の50%未満、警告アイコン
  - 計算式の説明: 「進捗目安の計算式: 継続月数 × 2」
  - 具体例: 「例: 3ヶ月継続 → 6レッスンが目安」
- **デザイン**: 
  - レスポンシブ対応（モバイル: 1列、デスクトップ: 3列）
  - 各状態を色分けした枠とアイコンで視覚的に表現
  - 計算式は灰色背景の説明ボックスに表示
- **結果**: ユーザーが背景色の意味を一目で理解できるようになった

### 2026-02-26 (7): getTutorNotionName未定義エラーの修正
- **問題**: Tutorフィルターを変更するとエラーが発生
- **エラー**: `ReferenceError: getTutorNotionName is not defined`
- **根本原因**: 
  - 今日のレッスンページで存在しない `getTutorNotionName()` 関数を呼び出していた
  - この関数は定義されていなかった
- **修正方法**: 
  - `getTutorNotionName(selectedTutor)` の呼び出しを削除
  - 他のページと同様に `selectedTutor` を直接使用
  ```javascript
  // Before (エラー)
  const tutorName = getTutorNotionName(selectedTutor);
  todayStudents = todayStudents.filter(s => s.homeroom_tutor === tutorName);
  
  // After (正常動作)
  todayStudents = todayStudents.filter(s => s.homeroom_tutor === selectedTutor);
  ```
- **結果**: Tutorフィルターが正常に動作するようになった

### 2026-02-26 (6): Tutorフィルターが反応しない問題の根本修正
- **問題**: すべてのページ（予約管理、生徒管理、今日のレッスン）でTutorフィルターのドロップダウンが反応しない
- **根本原因**: HTMLの `onchange` 属性は async 関数と正しく連携しない
  - `onchange="filterByTutor(this.value)"` は async 関数の完了を待たない
  - ブラウザが Promise を無視してしまう
- **修正方法**: 
  - すべての select 要素から `onchange` 属性を削除
  - レンダリング後に `addEventListener` で非同期イベントハンドラーを追加
  - 各ページごとに一意のIDを付与
    - `tutor-filter-reservations` (予約管理ページ)
    - `tutor-filter-students` (生徒管理ページ)
    - `tutor-filter-today` (今日のレッスンページ)
- **コード例**:
  ```javascript
  // Before (動作しない)
  <select onchange="filterByTutor(this.value)">...</select>
  
  // After (正しく動作)
  <select id="tutor-filter-today">...</select>
  <script>
  selectElement.addEventListener('change', async (e) => {
    await filterByTutor(e.target.value);
  });
  </script>
  ```
- **結果**: すべてのページでTutorフィルターが正常に動作するようになった

### 2026-02-26 (5): 今日のレッスンページの背景色を削除
- **要望**: 今日のレッスンビューでは背景色を指定しないでいい
- **変更内容**: 
  - レッスン進捗状況による背景色（青/黄/赤）を削除
  - シンプルな白背景に統一（hover時のみグレー表示）
  - `getLessonProgressStatus()` 呼び出しと `rowBgColor` 変数を削除
- **結果**: 今日のレッスンページがよりシンプルで見やすくなった

### 2026-02-26 (4): 今日のレッスンページのTutorフィルター修正
- **問題1**: 今日のレッスンページでTutor絞り込みをしても反応しない
  - **原因**: `filterByTutor()` 関数が `renderApp()` を await していなかった
  - **修正**: `filterByTutor()` を async 関数にして `await renderApp()` を追加
- **問題2**: 予約管理ページでTutor絞り込みをしてから今日のレッスンに移動すると何も表示されない
  - **原因**: `previousTutorFilter` で古い値（移動前の値）に戻していた
  - **修正**: `previousTutorFilter` ロジックを削除し、`selectedTutor` をそのまま使用
- **問題3**: 背景の塗りつぶしの条件がわからない
  - **回答**: レッスン進捗状況による色分け（生徒管理ページのみ）
    - **進捗目安**: 継続月数 × 2
    - **青色 (bg-blue-100)**: レッスン進捗 ≧ 進捗目安（正常）
    - **黄色 (bg-yellow-100)**: 進捗目安の50%以上100%未満（遅い）
    - **赤色 (bg-red-100)**: 進捗目安の50%未満（非常に遅い）
  - 例: 継続月数3ヶ月の場合、進捗目安は6レッスン
    - レッスン6以上 → 青色
    - レッスン3～5 → 黄色
    - レッスン2以下 → 赤色
  - **注意**: この背景色は生徒管理ページのみで使用。今日のレッスンページでは使用しない

### 2026-02-26 (3): タイムゾーン問題の修正（最終版）
- **問題**: レッスン日が1日ずれて表示される（DBの2/26が画面では2/27と表示）
- **根本原因**: JavaScript Date オブジェクトのタイムゾーン自動変換
  - データベース: `2026-02-26T19:00:00.000Z` (UTC形式で保存)
  - JavaScriptで `new Date('2026-02-26T19:00:00.000Z')` すると、ブラウザのローカル時刻（JST）に自動変換
  - `date.getDate()` → 27日と表示（JST: 2/27 04:00）
- **修正方法**: ISO日付文字列から直接日付部分を抽出
  ```javascript
  // Before
  const date = new Date(lesson.lesson_date);
  const formatted = `${date.getMonth() + 1}/${date.getDate()}`;  // 2/27

  // After  
  const dateStr = lesson.lesson_date.split('T')[0];  // "2026-02-26"
  const [year, month, day] = dateStr.split('-');
  const formatted = `${parseInt(month)}/${parseInt(day)}`;  // 2/26 ✅
  ```
- **変更内容**:
  - `loadLessonDates()`: ISO文字列から日付部分を抽出して表示
  - `loadTodayLessonDates()`: 同様の処理を追加
  - 今日のレッスンフィルター: 文字列比較に変更
  - デバッグログ追加（学籍番号 OLTS240499-HK の日付表示を追跡）

### 2026-02-26 (2): データ更新機能の修正
- **問題**: 「データ更新」ボタンを押してもアプリの表示が更新されない
- **原因**: `refreshData()` 関数が `renderApp()` を await していなかった
- **修正内容**:
  - `refreshData()` で `await renderApp()` を追加
  - データ取得完了後、UIの再描画を適切に待機
- **追加ドキュメント**: `GAS_MANUAL_SYNC_GUIDE.md` - GASスクリプト手動実行ガイド
  - GASスクリプトの手動実行方法
  - トリガー設定の確認・設定方法
  - データフロー（Googleカレンダー → スプレッドシート �
