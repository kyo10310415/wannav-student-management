# Google Apps Script - 特定イベント同期機能

## 📋 概要

特定のTutorアカウントのGoogleカレンダーから、指定したキーワードを含む予定を自動的に収集してスプレッドシートに書き込むGASスクリプトです。

## 🎯 機能

- **対象イベント**: 「ロープレ」「1on1」「チームMTG」「チーム研修」を含む予定
- **対象アカウント**: スプレッドシート「個別取得シート」に記載されたメールアドレス
- **取得期間**: 先月の1日～来月の末日（動的に計算）
- **出力先**: 同じスプレッドシート内に新規作成される「特定イベント一覧」シート
- **自動実行**: 毎日AM5:00に自動同期

## 📁 ファイル構成

```
Google Apps Script プロジェクト
├── コード.gs              # 既存のレッスン予約同期スクリプト
└── SpecialEvents.gs       # 特定イベント同期スクリプト（新規）
```

## 🚀 セットアップ手順

### 1. Google Apps Script エディタを開く

1. スプレッドシートを開く: https://docs.google.com/spreadsheets/d/1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo/edit
2. メニューから「拡張機能」→「Apps Script」をクリック

### 2. 新しいスクリプトファイルを追加

1. 左サイドバーの「ファイル」の横にある「+」ボタンをクリック
2. 「スクリプト」を選択
3. ファイル名を「SpecialEvents」に変更
4. `gas-special-events-sync.js` の内容をすべてコピー＆ペースト
5. 保存（Ctrl+S / Cmd+S）

### 3. 対象アカウントシートを作成

スプレッドシートに「個別取得シート」という名前のシートを作成し、以下の形式でメールアドレスを入力：

| メールアドレス |
|---------------|
| tutor1@example.com |
| tutor2@example.com |
| tutor3@example.com |

**注意事項:**
- 1行目はヘッダー行（「メールアドレス」など）
- 2行目以降にメールアドレスを入力
- A列にメールアドレスを記載

### 4. 初回テスト実行

1. Apps Script エディタで「SpecialEvents.gs」を開く
2. 関数選択ドロップダウンから `testSpecialEventsSync` を選択
3. 「実行」ボタンをクリック
4. 初回実行時は権限の承認が必要:
   - 「権限を確認」をクリック
   - Googleアカウントを選択
   - 「詳細」→「（プロジェクト名）に移動」をクリック
   - 「許可」をクリック

### 5. 自動実行トリガーを設定

1. 関数選択ドロップダウンから `setupSpecialEventsTrigger` を選択
2. 「実行」ボタンをクリック
3. 実行ログに「トリガーを設定しました: 毎日AM5:00に syncSpecialEvents を実行」と表示されれば成功

## 📊 出力データ

### 「特定イベント一覧」シート

| 列名 | 説明 | 例 |
|------|------|-----|
| イベントID | Googleカレンダーのイベント固有ID | abc123... |
| アカウント | イベントを取得したカレンダーのメールアドレス | tutor1@example.com |
| 一致キーワード | 一致した検索キーワード | ロープレ |
| タイトル | イベントのタイトル | チームMTG - 週次定例会 |
| 開始日時 | イベント開始日時 | 2025/03/15 10:00 |
| 終了日時 | イベント終了日時 | 2025/03/15 11:00 |
| 場所 | イベントの場所 | 会議室A |
| 説明 | イベントの説明 | 週次定例会の議題... |
| Meetリンク | Google Meet URL | https://meet.google.com/abc-defg-hij |
| 参加者 | 参加者のメールアドレス | user1@example.com, user2@example.com |
| 取得日時 | データ取得日時 | 2025/03/01 05:00:00 |

### 「特定イベント同期メタ情報」シート

同期の実行状況を記録：
- 最終同期日時
- 取得期間（開始・終了）
- 検索キーワード
- 対象アカウント数
- 取得イベント数
- 成功/失敗カレンダー数
- 実行時間

## 🔧 カスタマイズ

### 検索キーワードを変更

`SpecialEvents.gs` の以下の部分を編集：

```javascript
// 検索キーワード
const SEARCH_KEYWORDS = [
  'ロープレ',
  '1on1',
  'チームMTG',
  'チーム研修'
  // 追加したいキーワードをここに追加
];
```

### 取得期間を変更

`getDateRange()` 関数を編集：

```javascript
function getDateRange() {
  const today = new Date();
  
  // 先月の1日
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  
  // 来月の末日
  const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  
  return { startDate, endDate };
}
```

### トリガー時刻を変更

`setupSpecialEventsTrigger()` 関数を編集：

```javascript
// 毎日AM5:00に実行 → AM8:00に変更する場合
ScriptApp.newTrigger('syncSpecialEvents')
  .timeBased()
  .atHour(8)  // ← ここを変更
  .everyDays(1)
  .create();
```

## 🛠️ テスト関数

### `testSpecialEventsSync()`
特定イベント同期の完全テスト実行

### `testGetTargetEmails()`
対象アカウント一覧の取得テスト

### `testDateRange()`
取得期間の計算テスト

## 🔄 トリガー管理

### トリガーを設定
```javascript
setupSpecialEventsTrigger()
```

### トリガーを削除
```javascript
deleteSpecialEventsTrigger()
```

### 全トリガー一覧を表示
```javascript
listTriggers()  // コード.gs に既存
```

## ⚠️ 注意事項

1. **カレンダーアクセス権限**
   - 対象アカウントのカレンダーに対して「予定の表示」権限が必要
   - 権限がない場合はそのカレンダーをスキップ

2. **APIレート制限**
   - 10カレンダーごとに1秒の待機時間を設定
   - 大量のアカウントがある場合は実行時間が長くなる可能性

3. **既存データの扱い**
   - 毎回「特定イベント一覧」シートを完全に上書き
   - 手動で追加したデータは削除されるので注意

4. **既存スクリプトとの共存**
   - レッスン予約同期（`コード.gs`）と独立して動作
   - 別々のトリガーで実行されるため干渉しない

## 📝 ログ確認方法

1. Apps Script エディタを開く
2. 左サイドバーの「実行数」をクリック
3. 最新の実行をクリックしてログを確認

## 🐛 トラブルシューティング

### イベントが取得できない

**原因1: カレンダーアクセス権限がない**
- 対象アカウントのカレンダーを共有してもらう
- 「予定の表示」権限以上が必要

**原因2: メールアドレスが間違っている**
- 「個別取得シート」のメールアドレスを確認
- スペースや改行が入っていないか確認

**原因3: 期間外のイベント**
- 取得期間（先月1日～来月末日）を確認
- `testDateRange()` で期間を確認

### エラーが発生する

**エラー: "シートが見つかりません"**
- 「個別取得シート」が存在するか確認
- シート名のスペルミスがないか確認

**エラー: "権限がありません"**
- Apps Script の権限を再承認
- `testSpecialEventsSync()` を実行して権限承認

## 📞 サポート

問題が解決しない場合は、以下の情報を含めて報告してください：
- エラーメッセージ
- 実行ログ（Apps Script エディタ → 実行数）
- 対象アカウント数
- 取得期間

---

**作成日**: 2025年3月1日  
**バージョン**: 1.0.0  
**対応スプレッドシート**: https://docs.google.com/spreadsheets/d/1DvjTbwz2qhqwSnNqROTDAvd1hl-Lz9o05LE6rzEQEGo/edit
