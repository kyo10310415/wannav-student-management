# アンケートスタンプラリー機能 - ワイヤーフレーム & 仕様書

## 📋 概要

このディレクトリには、アンケートスタンプラリー機能のワイヤーフレーム、デザインカンプ、データベース設計が含まれています。

## 📁 ファイル構成

```
wireframes/
├── README.md                           # このファイル
├── 00_complete_design_comp.html        # 完全統合デザインカンプ（メインドキュメント）
├── 01_student_management_survey.html   # 学生管理画面のアンケート表示UI
├── 02_lesson_today_markers.html        # レッスン予約・Today画面の特典マーカーUI
└── 03_discord_roulette.html            # Discord通知とルーレット画面UI

migrations/
└── 20260319_add_survey_stamp_rally.sql # データベースマイグレーションSQL

src/db/
└── migrate.js                          # マイグレーション実行スクリプト（version 11追加済み）
```

## 🎯 機能の目的

生徒が毎月のアンケートに回答することでスタンプを集め、一定の条件を満たした際に特典（1時間コンサル権）のルーレット抽選に参加できるシステムです。

## 🏆 特典付与条件

1. **2026/3以前開始生徒**: 回答率80%以上
2. **2026/4以降開始生徒**: 6ヶ月連続回答
3. **2026/3以前開始（継続6ヶ月未満）**: 2026/4から100%回答率維持
4. **共通条件**:
   - 最新の延長審査結果が「延長」
   - 生徒ステータスが「アクティブ」
5. **リセット**: 特典付与後は条件2（6ヶ月連続）のみ適用

## 🗄️ データベース設計

### テーブル1: survey_responses
アンケート回答記録を保存

| カラム | 型 | 説明 |
|--------|-------|------|
| id | SERIAL | 連番ID |
| student_id | VARCHAR(50) | 生徒ID |
| response_month | VARCHAR(7) | 回答月（YYYY-MM） |
| responded_at | TIMESTAMP | 回答日時 |
| created_at | TIMESTAMP | 作成日時 |

**制約**: UNIQUE(student_id, response_month)

### テーブル2: roulette_results
ルーレット抽選結果を保存

| カラム | 型 | 説明 |
|--------|-------|------|
| id | SERIAL | 連番ID |
| student_id | VARCHAR(50) | 生徒ID |
| result | VARCHAR(20) | 結果（'当たり' or 'はずれ'） |
| probability | INTEGER | 当選確率（100 or 50） |
| roulette_url | TEXT | ルーレットURL |
| created_at | TIMESTAMP | 抽選日時 |

### テーブル3: stamp_rally_achievements
スタンプラリー達成記録

| カラム | 型 | 説明 |
|--------|-------|------|
| id | SERIAL | 連番ID |
| student_id | VARCHAR(50) | 生徒ID |
| achievement_type | VARCHAR(50) | 達成条件タイプ |
| achievement_date | DATE | 達成日 |
| notified_at | TIMESTAMP | Discord通知日時 |
| roulette_url | TEXT | ルーレットURL |
| created_at | TIMESTAMP | 作成日時 |

**achievement_type**:
- `initial_80`: 条件1（80%以上）
- `continuous_6`: 条件2（6ヶ月連続）
- `catch_up_100`: 条件3（100%達成）
- `reset_6`: リセット後の6ヶ月連続

## 🎨 UI/UXデザイン

### 学生管理画面
- **回答数**: 累計アンケート回答回数を表示
- **回答率**: プログレスバーと数値で視覚化（回答数 ÷ 継続月数 × 100%）
- **ルーレット結果**: 当たり/はずれ/未達成を表示
- **特典対象バッジ**: 金色の「特典対象」バッジをアニメーション付きで表示

### レッスン予約・Today画面
- **ルーレットアイコン（🎰）**: 特典対象生徒に表示
- **S評価**: 金色のグラデーション（必ず当たり）
- **通常評価**: 緑色のグラデーション（50%当たり）
- **回転アニメーション**: ゆっくり回転するエフェクト

### Discord通知
- **見出し**: 「🎉 おめでとうございます！ 🎉」
- **サブ見出し**: 「見事アンケートスタンプラリーを達成しました！！」
- **ルーレットURL**: 一意のURLを生成（30日間有効、1回限り使用可能）
- **特典内容**: 「🎁 1時間コンサル権」

### ルーレット画面
- **抽選前**: ルーレット盤（半分当たり、半分はずれ）
- **回転**: 2秒間の回転アニメーション（720度回転）
- **結果（当たり）**: 🎊 当たり！ 🎊 + 特典内容表示
- **結果（はずれ）**: 😢 残念... + 次回への案内

## 🔧 実装ガイド

### ステップ1: データベースマイグレーション
```bash
# マイグレーションを実行
cd /home/user/webapp
node src/db/migrate.js

# または直接SQLを実行
psql -U username -d database_name -f migrations/20260319_add_survey_stamp_rally.sql
```

### ステップ2: 必要なAPIエンドポイント
- `GET /api/survey/responses/:studentId` - 回答記録取得
- `POST /api/survey/responses` - 回答記録登録
- `GET /api/survey/eligible-students` - 特典対象生徒一覧
- `POST /api/roulette/generate` - ルーレットURL生成
- `POST /api/roulette/spin` - ルーレット抽選実行
- `GET /api/roulette/result/:token` - 抽選結果取得

### ステップ3: フロントエンド実装
1. 学生管理画面に回答数・回答率・ルーレット結果カラムを追加
2. レッスン予約・Today画面に特典マーカー（🎰）を追加
3. ルーレット抽選ページを作成

### ステップ4: バッチ処理
- 日次バッチで特典達成判定を実行
- 達成者にDiscord通知を自動送信
- ルーレットURLを生成してDB保存

### ステップ5: テスト
- 各条件パターンのテスト
- Discord通知のテスト送信
- ルーレット抽選のテスト（S評価/通常評価）

## 📊 技術仕様

### 抽選ロジック
```javascript
// S評価: 必ず当たり
if (student.result_score === 'S') {
  probability = 100;
  result = '当たり';
}
// 通常評価: 50%の確率
else {
  probability = 50;
  result = Math.random() < 0.5 ? '当たり' : 'はずれ';
}
```

### URL生成
```javascript
const token = crypto.randomBytes(32).toString('hex');
const rouletteUrl = `https://olts-system.example.com/roulette?token=${token}`;
const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30日後
```

### セキュリティ
- URLトークンは1回限り有効（使用後は無効化）
- 有効期限: 発行から30日間
- 生徒本人のみアクセス可能（認証必須）

## 📖 ワイヤーフレームの閲覧方法

### メインドキュメント（推奨）
```bash
# ブラウザで開く
open wireframes/00_complete_design_comp.html
```

このファイルには全ての情報が統合されており、ナビゲーション付きで閲覧できます。

### 個別ワイヤーフレーム
各画面の詳細デザインを個別に確認したい場合：
```bash
open wireframes/01_student_management_survey.html
open wireframes/02_lesson_today_markers.html
open wireframes/03_discord_roulette.html
```

## 📝 注意事項

- **実装前の確認**: この資料はワイヤーフレームであり、実装は行われていません
- **データベース**: マイグレーションは本番環境で実行前にバックアップを取得してください
- **Discord通知**: 通知テンプレートは実装時に調整が必要な場合があります
- **ルーレット**: アニメーションはCSS/JSで実装する必要があります
- **セキュリティ**: URLトークンの生成と検証は厳密に実装してください

## 🚀 デプロイチェックリスト

- [ ] データベースマイグレーション実行
- [ ] APIエンドポイント実装
- [ ] フロントエンドUI実装
- [ ] Discord通知機能実装
- [ ] ルーレットページ実装
- [ ] バッチ処理（日次特典判定）実装
- [ ] テストデータでの動作確認
- [ ] 本番環境テスト
- [ ] ドキュメント更新

## 📞 サポート

実装に関する質問や不明点があれば、開発チームにお問い合わせください。

---

**作成日**: 2026年3月19日  
**バージョン**: 1.0.0  
**ステータス**: ワイヤーフレーム完成（実装未着手）
