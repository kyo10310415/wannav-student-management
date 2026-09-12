# テスト計画

## T017 / T005 実施結果

Node v22.23.2: 変更前56件、T017後62件、inventory追加後78件、student_id判定修正後82件すべて成功。
追加検証: DBの別形式ID完全一致、未知folder、0/O・case・空白・hyphen・編集距離1のtypo候補を自動紐付けしない、DB取得前のraw関連保持と再解決、複数folderの全関連保持とstudent競合。
minutes全8操作で未認証/期限切れを拒否し、3ロールのCRUD/生成/template回帰をmockで検証。
inventoryはDrive pagination、不完全/ループ検出、集計統計、日付、学籍番号、重複、欠損、サンプル/失敗状態、DB読み取り専用transaction/keyset pagination/rollback、照合、既存Docs抽出再利用を検証。
実データ未接続のため、Google権限・DB schemaとの実統合・本番スケール・検索精度/AI費用の検証とは区別する。

## 自動テスト

- 認証: tokenなし401、有効3 role成功、期限切れ401、DB障害500。
- validation: 空質問、2000 Unicodeコードポイント超、32 KiB超、不正/不存在student ID、未知キー、厳密な比較日付。
- 分離: Aへの質問時、SQL引数と取得rowがAだけ。B固有カナリア語がanswer/contextにない。
- 検索: latest、previous goal、3ヶ月比較、longitudinal、repeated issue、YouTube/X。
- 長期: 全期間軽量情報→意味的重要度選択→原文確認。固定時期サンプリングから外れる重要レッスンを正解セットに含め、再現率を比較する。入力上限超過時の階層要約でも出典・矛盾・転機を維持する。
- 時点と反証: 新旧の矛盾と後日の改善を扱う。最新であるという理由だけで正しいと断定しない。
- 根拠不足: 記録0件は判断不能。1件でも支持できる事実は回答可能。長期変化は別時点の根拠を必要とする。
- injection: transcript内の「systemを無視」等が命令として実行されない。
- 引用: AIが候補外IDを返した場合は回答全体を失敗させる。引用だけ除去して成功扱いにしない。
- 障害: OpenAI timeout/429/5xx、Drive障害で既存画面が壊れない。
- backfill: 重複、再開、retry上限、停止、同日複数Docs。
- 欠損: reportなし、番号不明、masterなし、日付不明、要約失敗でもsourceを保持して検索可能にする。架空の番号/Tutor/達成事実を補わない。
- 統合source: minutesとの重複排除、別student競合の隔離、文書変更/削除時の索引無効化。
- T015: Bearer不正/欠落、3 role、期限切れ、存在しないtoken、DB障害、SQL injection文字列のparameter化、context最小化、後段500の維持。
- T016/T017: UI全8呼出しのAuthorization確認、minutes全APIの未認証拒否、認証済みCRUD・生成・テンプレート回帰、cron直呼び継続。

## 実装前baselineの管理

最新remote feature/student-ai-assistantのローカル変更・祖先関係を確認し、Node22でnpm testのbaselineを取る。main同期や巻戻しは行わない。依存がなければnpm ci --ignore-scriptsを使い、postinstall migrationやindex/cron起動は禁止。T005は測定完了、T010はMVP方式承認済み。実AI品質・実DB受入は未実施として区別する。以下の過去テスト件数・失敗履歴は当時の記録として保持する。

## 手動/E2E

1. admin、leader、crewで生徒Aを開き質問できる。
2. 未ログインでAPI直呼びし401。
3. 生徒A/Bの特徴的な記録を準備し、相互混入がない。
4. 記録なし生徒で適切な空状態。
5. 回答の参照日から元議事録/Driveを開ける。
6. 連打時に二重送信せず、loadingと再試行が分かる。
7. AI障害時もモーダルを閉じ、生徒管理を継続できる。

## 回帰

`npm test` に加え、生徒管理、Tutor管理、今日のレッスン、議事録、レッスン報告のsmoke testを行う。

旧Phase 0では依存未導入により33件成功、gasBroadcastはhono欠落でload失敗。その後、最新main同期と依存導入により既存48件すべて成功を確認した。T015追加後は56件成功。npm ciのpostinstall DB接続失敗とNodeバージョン差はBASELINE.md参照。

## 合格基準

- 生徒混入0、未認証成功0。
- 固定評価質問の全回答が候補内sourceのみを引用。
- 主要質問で妥当な複数時点を取得。
- backfill再実行で重複0。
- 既存自動テスト全件成功。

## T040の自動検証と残る受入

tests/studentAiAnswer.test.jsとtests/studentAiRoutes.test.jsで、Hono app.request、架空DB、OpenAI mockを使う。index.jsやcronは起動しない。未認証/期限切れ/3ロール/未知role、既定OFF、設定不足、旧形式ID、質問/日付/body上限（stream・Content-Length偽装含む）、JST境界、生徒カナリア分離、引用完全一致、全参照・型・上限・未知キー、断念時定型文、coverage、実usage欠損を検証する。

全体/プロバイダー期限、下流AbortSignal、次バッチ停止、例外後枠解放、DB/AIのキャンセル未完了時の枠維持、生エラーのログ/レスポンス非露出も検証する。T030と既存minutes認証を含むnpm test全件を回帰対象とする。baseline/最終件数は[完了報告](reports/T040_IMPLEMENTATION_REPORT.md)。

これは実モデルの注入攻撃耐性や主張の意味的妥当性の証明ではない。実AI精度・費用・速度、実PostgreSQL統合/クエリ計画、ブラウザーでの既存画面smoke、複数インスタンス運用は未検証。T050以降、本番deploy、backfillへ自動で進まない。

## T050評価基盤（code/tests done; live quality pending）

架空40ケースを実際のT030 selector/contextとT040 answer/認証routeに通す。外部依存は注入されたSQL fakeとscripted/oracle mockのみ。goldはprovider入力から分離する。原文位置付き必須グループ（OR代替/AND両時点）、一意source precision、反証、比較の両時点、欠落段階、macro/micro/NAを測る。これは検索の意味的精度の実績ではない。

tests/studentAiEvaluation.test.js / studentAiEvaluationScoring.test.jsで、schema、全40ケース、再現性、手計算、controlled bad outputs、gold/カナリア漏洩、権限拒否、秘密値fixtureの非露出、手動レビューのrun/case/hash束縛、CLI新規保存/上書き拒否/異常/中断を検証する。意味評価は未入力pending。正しいquoteに逆の結論を添えた例は機械passでも意味failになり得る。

最終抜粋件数/文字数制限による重要根拠の欠落も正解から除外しない。今回の本体修正はなく、上限を緩和しない。実行方法、指標・分母・将来のlive開始条件は[T050_EVALUATION.md](T050_EVALUATION.md)、正式なtest件数とSHAは[完了報告](reports/T050_IMPLEMENTATION_REPORT.md)。
