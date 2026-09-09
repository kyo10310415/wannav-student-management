# AIカルテ アーキテクチャ

## 候補比較

| 評価軸 | A: PostgreSQL絞込 | B: OpenAI Vector Store | C: pgvector |
|---|---|---|---|
| 初期工数 | 小 | 中 | 大 |
| 既存親和性 | 高 | 中 | 高 |
| 意味検索精度 | 低〜中 | 高 | 高 |
| 長期横断 | 要工夫 | 高 | 高 |
| 更新/削除 | SQLで容易 | 外部同期が必要 | SQLで容易 |
| 個人情報の所在 | 既存DB中心 | OpenAI側にも複製 | 既存DB中心 |
| ベンダーロックイン | 低 | 高 | 低〜中 |
| 運用負荷 | 低 | 中 | 中〜高 |
| MVP適性 | 最適 | 条件付き | 将来候補 |

## 推奨: 段階的ハイブリッド（MVPは案A）

MVPはPostgreSQLだけで、質問意図に応じて日付窓と候補件数を変える。`generated_text` と `quality_evaluation` を優先し、transcriptは根拠確認に必要な候補だけ切り出す。実データで長期質問の再現率が不足した場合にpgvectorを追加する。

理由は、既にminutesへ要約と構造化品質評価があり、外部Vector Storeへ個人情報を複製せず短期間で安全性を検証できるため。単なる最新N件固定にはしない。

## リクエストフロー

1. UIが選択済みstudent IDと質問を送信。
2. `requireAuth` がsessionを検証しuserをcontextへ格納。
3. studentの存在を確認。
4. 質問をルールベースで `latest` / `previous_goal` / `period_compare` / `longitudinal` / `repeated_issue` / `topic` に分類。
5. 必ず `student_id = $1` を条件に候補を取得。
6. 日付と要約による一次選抜後、上限内のtranscript断片を構築。
7. system promptで資料と命令を分離し、JSON回答を生成。
8. サーバーが引用ID/日付を照合し、回答＋sources＋usageを返す。

## 検索戦略

| 意図 | 取得方針 |
|---|---|
| 現在の課題 | 直近6件、最新を強く優先 |
| 前回目標 | 直近2件、next_action/qualityを優先 |
| 3ヶ月比較 | 直近3件＋基準日の前後各2件 |
| 長期成長 | 全期間を四半期/時期に分割し各期間の代表件 |
| 繰り返し課題 | 全期間の要約をテーマ検索し、異なる3時点以上を優先 |
| YouTube/X | generated_textの該当節を検索、直近＋過去代表件 |

## API案

`POST /api/student-ai/:studentId/questions`

Request: `{ "question": "..." }`

Response: `{ success, data: { answer, evidence, changes, recommendedActions, confidence, sources: [{ minutesId, lessonDate, tutorName, driveUrl }] } }`

student IDはUI入力欄を設けず、開いたカードの内部値を使う。ただしサーバーはURL値を信用せず、存在・長さ・形式を検証する。

## データモデル方針

MVP質問機能は既存minutesを読み取り利用する。backfill前に同日複数Docsを実測し、存在するなら `(student_id, lesson_date)` 唯一制約を `drive_file_id` 一意へ移行する。既存データにnull/重複があるため、migrationは監査→補完→制約追加の順とする。

## 品質ゲート

固定質問セットと、他生徒固有のカナリア語を使った分離テストを用意する。長期質問で複数時点を引用できない場合のみpgvector PoCへ進む。
