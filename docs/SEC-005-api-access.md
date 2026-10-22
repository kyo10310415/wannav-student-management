# SEC-005 業務APIの認証

## 変更点

- `/api/*`は既存DBのsessions・有効期限・現在のusers.roleを毎回検証する。ブラウザは既存のsessionTokenをAuthorization: Bearerとして同一originのAPIだけへ送る。外部URLへは送らない。
- 不正/期限切れは401、権限不足・初期パスワード変更前は403、認証DB障害は503。保護APIはno-store。ブラウザは401時ログイン画面へ戻る。
- 管理者専用: ユーザー管理（相談担当一覧を除く）、DB管理、Tutorレッドリスト、延長審査AI、パスワードリセット。
- リーダー以上: ファネル・VQ・議事録・教材管理、不参加集計/承認、当選者管理、通知・システム設定変更、Tutor設定変更、レッスン報告削除。crewの書込みは列挙した日報・担当生徒更新・助っ人・自身の不参加申請・既存配信APIに限定し、未列挙の操作は拒否する。
- crewの担当更新はDBのusers.email→tutors→students.homeroom_tutorで照合する。日報/助っ人の本人性はDBのtutor ID/employee IDで確認。コメント投稿者・レッスン報告者・不参加承認者はログイン本人から取得する。
- 生徒/Tutor等の共有閲覧はREADMEの既存crew仕様を維持する。全APIの全業務上の権限再設計ではない。組織別・担当別の閲覧分離が必要なら別途仕様を定義する。

## 明示した公開・機械経路

- POST `/api/auth/login`だけログイン前に許可。
- ルーレットはGET `/api/roulette/verify/:token`とPOST `/api/roulette/spin`だけ、64桁ランダムトークンを持つ生徒に公開。既存ルートがDBでトークンと有効期限を再検証する。生成・一覧・結果の学籍番号指定・管理操作は匿名利用できない。
- `/api/gas-broadcast/*`は既存の専用APIキーmiddleware、GET `/api/email-reminders/batch`は既存の専用Bearerキー検証を維持。ブラウザのsessionとは代替しない。
- その他GASは新しい`GAS_SYNC_API_KEY`（32文字以上のランダム値）をサーバー環境変数とGASスクリプトプロパティへ所有者が設定し、`X-Sync-API-Key`ヘッダーで送る。適用/値の生成は今回行っていない。
- syncキーの許可範囲はGET `/api/external/lesson-start-dates`、GET `/api/students/sync`、GET `/api/tutors/sync`、POST `/api/survey/responses`、GET `/api/vq-diagnosis/status`だけ。全業務APIの共通管理者キーではない。その他のGAS API依存は適用前に棚卸しし、必要な経路だけ別途設計する。
- `gas-notion-cache-sync.js`と`docs/gas-cache-full-modified.gs`はプロパティからキーを取得し、redirectを追わない。キー未設定なら当該処理を開始しない。GASへの貼り替え/プロパティ設定は未実施。
- 定期同期・スタンプラリー・Tutorレッドリストの自己HTTP通信は同一プロセス内dispatchへ置換。メモリ内ランダム資格情報と列挙済み経路で認証し、ネットワークやINTERNAL_API_BASEの任意ホストを使わない。プロセス起動時に登録するため新しい永続secret不要。

## 適用前・検証・切戻し

1. 現在の利用者role、メールとTutorの紐付け、crew担当情報、公開生徒リンク、GAS/外部ジョブのAPI利用を管理者が確認する。
2. 一時DBと外部API mockでログイン、初期パスワード変更、各role、担当/非担当、公開トークン、GASキー、内部定期処理を確認する。
3. 通常のinstallは既存postinstallがDB migrationを呼ぶため、レビュー/テスト時は`npm ci --ignore-scripts`。本番DBをテストへ渡さない。
4. コード・DBschema・既存セッション形式の破壊的変更はない。元リリースへの切戻しが必要な場合、匿名業務APIを再公開せず上流アクセス制限または公開停止を先に行う。既存GASコードへ戻す場合もバックエンド認証を解除しない。

Node.js本体・依存CVE・固定鍵履歴の失効・外部URL制限等はこのSEC-005の修正では更新していない。本番適用、DB変更、Push、デプロイは実施しない。
