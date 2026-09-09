# テスト計画

## 自動テスト

- 認証: tokenなし401、有効3 role成功、期限切れ401、DB障害500。
- validation: 空質問、1000文字超、不正/不存在student ID。
- 分離: Aへの質問時、SQL引数と取得rowがAだけ。B固有カナリア語がanswer/contextにない。
- 検索: latest、previous goal、3ヶ月比較、longitudinal、repeated issue、YouTube/X。
- 長期: 1年以上を四半期サンプリングし、複数時点をsourcesへ含める。
- 最新性: 現在質問で古い矛盾より最新情報が優先され、変化として説明される。
- 根拠不足: 記録0件/1件では判断不能または低確信度。
- injection: transcript内の「systemを無視」等が命令として実行されない。
- 引用: AIが候補外IDを返した場合に除去/失敗させる。
- 障害: OpenAI timeout/429/5xx、Drive障害で既存画面が壊れない。
- backfill: 重複、再開、retry上限、停止、同日複数Docs。

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

Phase 0時点のbaselineは依存パッケージ未導入のため、node標準だけの33件が成功し、`tests/gasBroadcast.test.js` は`hono`未導入でload失敗した。依存導入後に正式なbaselineを取り直す。

## 合格基準

- 生徒混入0、未認証成功0。
- 固定評価質問の全回答が候補内sourceのみを引用。
- 主要質問で妥当な複数時点を取得。
- backfill再実行で重複0。
- 既存自動テスト全件成功。
