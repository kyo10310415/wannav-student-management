# テスト計画

## T017 / T005 実施結果

Node v22.23.2: 変更前56件、T017後62件、inventory追加後78件、student_id判定修正後82件すべて成功。
追加検証: DBの別形式ID完全一致、未知folder、0/O・case・空白・hyphen・編集距離1のtypo候補を自動紐付けしない、DB取得前のraw関連保持と再解決、複数folderの全関連保持とstudent競合。
minutes全8操作で未認証/期限切れを拒否し、3ロールのCRUD/生成/template回帰をmockで検証。
inventoryはDrive pagination、不完全/ループ検出、集計統計、日付、学籍番号、重複、欠損、サンプル/失敗状態、DB読み取り専用transaction/keyset pagination/rollback、照合、既存Docs抽出再利用を検証。
実データ未接続のため、Google権限・DB schemaとの実統合・本番スケール・検索精度/AI費用の検証とは区別する。

## 自動テスト

- 認証: tokenなし401、有効3 role成功、期限切れ401、DB障害500。
- validation: 空質問、1000文字超、不正/不存在student ID。
- 分離: Aへの質問時、SQL引数と取得rowがAだけ。B固有カナリア語がanswer/contextにない。
- 検索: latest、previous goal、3ヶ月比較、longitudinal、repeated issue、YouTube/X。
- 長期: 全期間軽量情報→意味的重要度選択→原文確認。固定時期サンプリングから外れる重要レッスンを正解セットに含め、再現率を比較する。入力上限超過時の階層要約でも出典・矛盾・転機を維持する。
- 最新性: 現在質問で古い矛盾より最新情報が優先され、変化として説明される。
- 根拠不足: 記録0件/1件では判断不能または低確信度。
- injection: transcript内の「systemを無視」等が命令として実行されない。
- 引用: AIが候補外IDを返した場合に除去/失敗させる。
- 障害: OpenAI timeout/429/5xx、Drive障害で既存画面が壊れない。
- backfill: 重複、再開、retry上限、停止、同日複数Docs。
- 欠損: reportなし、番号不明、masterなし、日付不明、要約失敗でもsourceを保持して検索可能にする。架空の番号/Tutor/達成事実を補わない。
- 統合source: minutesとの重複排除、別student競合の隔離、文書変更/削除時の索引無効化。
- T015: Bearer不正/欠落、3 role、期限切れ、存在しないtoken、DB障害、SQL injection文字列のparameter化、context最小化、後段500の維持。
- T016/T017: UI全8呼出しのAuthorization確認、minutes全APIの未認証拒否、認証済みCRUD・生成・テンプレート回帰、cron直呼び継続。

## 実装前baselineの管理

最新main同期後のアプリコードがmainと同じ状態でnpm ci/npm testを実行し、T015後の結果と分ける。Node指定22.xと実行環境の差、依存インストール・postinstall migrationの失敗は、機能テストの失敗と区別してBASELINE.mdへ記録する。T005とT010は未完了ゲートのまま保持する。

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
