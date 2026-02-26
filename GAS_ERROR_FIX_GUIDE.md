# GASスクリプトエラー修正ガイド

## ❌ 問題の原因

GASスクリプトの冒頭で必要な定数がコメントアウトされていたため、スクリプトが正常に動作していませんでした。

### エラーログ:
```
2026/02/26 13:47:46 情報	アクセス可能なTutorカレンダー: 0件（Notion: 634件中）
2026/02/26 13:47:46 情報	⚠️ 警告: アクセス可能なTutorカレンダーがありません
```

## ✅ 修正内容

### 1. **定数のアンコメント**

**修正前（コメントアウトされていた）:**
```javascript
//const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
//const SHEET_NAME = 'レッスン予約データ';
//const NOTION_TUTOR_API_TOKEN = 'YOUR_NOTION_API_TOKEN';
//const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID';
```

**修正後（有効化）:**
```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';  // 実際のIDに置き換える
const SHEET_NAME = 'レッスン予約データ';
const NOTION_TUTOR_API_TOKEN = 'YOUR_NOTION_API_TOKEN';  // 実際のトークンに置き換える
const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID';  // 実際のIDに置き換える
```

### 2. **デバッグログの追加**

より詳細なデバッグ情報を出力するようにログを追加：

```javascript
// アクセス可能なカレンダーのサンプルを表示
const accessibleEmailsSample = Array.from(accessibleEmailsSet).slice(0, 5);
Logger.log(`アクセス可能なカレンダーサンプル: ${accessibleEmailsSample.join(', ')}...`);

// エラー時の対処方法を表示
if (TUTOR_EMAILS.length === 0) {
  Logger.log('⚠️ 警告: アクセス可能なTutorカレンダーがありません');
  Logger.log('💡 対処方法:');
  Logger.log('1. Googleカレンダー設定で、Tutorのカレンダーが共有されているか確認');
  Logger.log('2. Notionのメールアドレスとカレンダーのメールアドレスが一致しているか確認');
  Logger.log('3. GASスクリプトの実行権限を確認（OAuth承認が必要）');
  return;
}
```

## 📋 適用手順

### **Step 1: GASエディタを開く**

1. Google Sheetsを開く
2. 「拡張機能」→「Apps Script」をクリック

### **Step 2: コードを置き換え**

1. 既存のコードをすべて削除
2. 修正版のコード（`gas-calendar-sync-incremental-fixed.js`）をコピー&ペースト

### **Step 3: 設定値の確認**

以下の定数が正しく設定されているか確認：

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';  // ✅ 実際のスプレッドシートIDに置き換える
const SHEET_NAME = 'レッスン予約データ';  // ✅ シート名
const NOTION_TUTOR_API_TOKEN = 'YOUR_NOTION_API_TOKEN';  // ✅ 実際のNotionトークンに置き換える
const NOTION_TUTOR_DB_ID = 'YOUR_TUTOR_DATABASE_ID';  // ✅ 実際のNotionデータベースIDに置き換える
```

### **Step 4: テスト実行**

1. 関数リストから `testIncrementalSync` を選択
2. 「実行」ボタンをクリック
3. 初回実行時はOAuth承認が必要（承認画面が表示される）
4. 実行ログを確認

### **Step 5: トリガーの設定**

正常に動作することを確認したら、定期実行トリガーを設定：

1. 関数リストから `setupIncrementalTrigger` を選択
2. 「実行」ボタンをクリック
3. トリガーが設定される（30分ごとに自動実行）

## 🔍 確認ポイント

### **正常動作時のログ例:**

```
========== レッスン差分同期開始 ==========
Notionから634件のTutorメールアドレスを取得
メールアドレスサンプル: tutor1@example.com, tutor2@example.com, ...
アクセス可能なカレンダー: 33件
アクセス可能なカレンダーサンプル: tutor1@example.com, tutor2@example.com, ...
アクセス可能なTutorカレンダー: 15件（Notion: 634件中）
更新対象期間: 2026/02/19 13:47:30 ～ 2026/04/27 13:47:30
既存データ: 1250件
...
========== 差分同期完了 ==========
実行時間: 45秒
Notion Tutor総数: 634件
アクセス可能カレンダー: 15件
新規: 5件、更新: 3件、削除: 1件
```

### **問題がある場合:**

1. **「アクセス可能なカレンダー: 0件」**
   - GASの実行権限を確認
   - CalendarApp.getAllCalendars()の権限承認が必要

2. **「アクセス可能なTutorカレンダー: 0件」**
   - Tutorカレンダーが共有されているか確認
   - Notionのメールアドレスとカレンダーのメールアドレスが一致しているか確認
   - メールアドレスの大文字/小文字が異なる場合も不一致扱いになる（スクリプトは小文字に統一）

3. **「Notion API エラー」**
   - NotionトークンとデータベースIDを確認
   - Notionの権限設定を確認

## 📝 今後の対応

### **定期的なメンテナンス:**

- 月1回: ログを確認してエラーがないかチェック
- 四半期に1回: トリガーが正常に動作しているか確認

### **トラブルシューティング:**

問題が発生した場合は、以下の順序で確認：

1. 実行ログを確認（Apps Script → 実行数）
2. エラーメッセージから原因を特定
3. 設定値（トークン、ID）を再確認
4. 必要に応じて `testIncrementalSync` で手動テスト

## ✅ チェックリスト

- [ ] 定数のコメントを外した
- [ ] スプレッドシートIDが正しい
- [ ] NotionトークンとデータベースIDが正しい
- [ ] `testIncrementalSync`でテスト実行成功
- [ ] ログに「アクセス可能なTutorカレンダー: X件」が表示される（X > 0）
- [ ] `setupIncrementalTrigger`でトリガー設定完了
- [ ] トリガー一覧で30分ごとの実行が確認できる

## 📞 サポート

問題が解決しない場合は、以下の情報を共有してください：

- 実行ログ全文
- エラーメッセージ
- Notionの権限設定スクリーンショット
- Googleカレンダーの共有設定スクリーンショット
