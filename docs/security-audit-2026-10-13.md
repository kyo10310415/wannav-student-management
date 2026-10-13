# 認証情報セキュリティ監査（2026-10-13）

## 原因と修正

`statsReportService.js` に環境変数未設定時の固定Webhookがあったため、公開ソースから通知権限を取得できた。Axiosエラー全体のログ出力・再throwも、リクエストURL等が呼び出し元のログ/API応答に流れる経路だった。

固定値を除去し、`DISCORD_STATS_WEBHOOK_URL` のみ参照する。未設定・空白の場合も統計を生成し、Discord送信だけスキップする。正常時の通知本文・username・avatar・集計方法は維持した。失敗時は値を含まない固定ログと固定エラーに置き換え、既存呼び出し元のcatch/HTTP 500処理を維持した。

## 調査範囲・方法

- Git管理対象179ファイル（修正前）と、全ローカル/リモート追跡refから到達可能な715コミットを調査。shallow repositoryではない。
- Gitleaks 8.30.1（公式リリース・SHA-256確認）の標準ルールと、Discord Webhook/DB接続URLの追加ルールを使用。全履歴は`git --log-opts=--all`で調査。
- 追加の文字列検査で、認証情報代入、秘密鍵形式、環境設定ファイルを確認。対象統計Webhookは全715コミットのファイル内容を照合した。
- 検出値はレポートへ保存せず、ファイル・行番号・種類・コミット情報のみ記録。認証情報を外部APIへ送って有効性を試す検査は行っていない。
- 修正後の現行ファイルスキャンは、明示的ダミー値と公開Discord IDを除外して検出0件。未取得ref、削除済みremote branch、fork、GitHubキャッシュ、到達不能オブジェクト、実行環境の秘密は網羅しない。検出0件は未知の機密情報が存在しない保証ではない。

## 検出結果

行番号は原則として修正前HEADの位置。履歴のみの項目は検出コミットでの位置。

| ファイル | 行 | 種類 | リスク | 推奨対応 | 今回修正 |
| --- | --- | --- | --- | --- | --- |
| src/services/statsReportService.js | 18 | Discord Webhook | 高 | 無効化・再発行、Render環境変数で管理 | 固定値削除・安全なskip/error追加 |
| src/routes/roulette.js | 9 | 同じDiscord Webhook | 高 | 上記と同じ失効対応、環境変数で管理 | 固定値削除、未設定時の通知skip |
| src/services/broadcastService.js | 759 | 別のDiscord Webhook（テスト用） | 高 | 無効化・再発行、テスト送信先を環境変数へ | 固定値削除 |
| .env.example | 8 | 外部PostgreSQL接続認証情報 | 高 | DB認証情報更新、依存サービスの接続設定更新 | 実値削除 |
| check_external_db.js | 4 | 上記外部DB接続認証情報 | 高 | EXTERNAL_DATABASE_URLを使用 | 固定値削除、未設定ガード |
| run-migration-render.cjs | 5 | PostgreSQL接続認証情報 | 高 | 対象DB認証情報更新、DATABASE_URLを使用 | 固定fallback削除、未設定ガード |
| BROADCAST_DEPLOYMENT.md | 87 | PostgreSQL接続認証情報 | 高 | 対象DB認証情報更新 | ダミー値へ置換 |
| src/routes/withdrawalRequests.js（履歴のみ） | 8 | Discord Webhook | 高 | 対応するWebhookの失効を確認 | ファイルは既に削除済み、履歴は維持 |
| src/routes/broadcast.js（履歴のみ） | 361 | Discord Webhook | 高 | 対応するWebhookの失効を確認 | 現行コードに残存なし、履歴は維持 |
| README.md | 338, 399 | DB URLの例 | なし（誤検知） | ダミー値のみ維持 | 実質変更なし |
| BROADCAST_DEPLOYMENT.md | 113, 117, 123 | Authorizationの例 | なし（誤検知） | YOUR_SESSION_TOKENはダミー | 変更なし |
| wireframes/03_discord_roulette.html | 364 | モック用URL token | なし（誤検知） | example.com上の固定ダミー | 変更なし |
| src/services/broadcastService.js、tests/gasBroadcast.test.js | 760, 292 | Discord ID | なし（非認証情報） | Webhook tokenと区別 | 変更なし |

標準ルールでDiscord Bot Token、GitHub PAT、AWSキー、Google秘密鍵、実値のNotion/OpenAI APIキー、JWT Secretの追加漏洩は検出していない。GASのトークン設定例はプレースホルダーだった。Git管理対象の`.env`・秘密鍵ファイルは検出せず、`.env.example`のみが管理対象だった。既存の初期/リセットパスワード運用は今回変更せず、未変更アカウントが残っていないか管理者が確認すること。

## 対象WebhookのGit履歴

- 初回追加: `90537856b35369fd4fb087b75925094fdf7a5c16`、2026-03-03 18:00:13 JST（当時10行目）。
- 対象ファイルに同じWebhookが残るコミット: 確認した715コミット中493コミット。複数branchを含む到達可能履歴の数であり、線形の連番範囲ではない。
- 確認時の最新の残存版: `b55d7f44507acf6690c72f68bbe36c9862cfbad4`、2026-10-08 21:39:18 JST。管理者がこのPRをマージするまでmainの現行版にも残る。
- 過去コミット・PRの削除行・clone/fork/キャッシュから取得できる。FriendlyScannerの削除主張やHTTP 200だけでは、現在の失効を確認できない。

履歴削除は、まず認証情報を失効した後に管理者判断で実施する。現段階では必須の復旧手段は失効/ローテーションであり、履歴削除だけでは漏洩を解消しない。

履歴を書き換える場合は、開発作業と自動デプロイを一時停止し、対象branch/tag・fork・PR・保護設定・利用者を棚卸しする。隔離したmirrorで`git filter-repo`等を実施して再スキャンし、管理者の明示承認後に更新する。既存cloneは再cloneが必要となり、古い履歴を再Pushしない。GitHubのキャッシュ/PR参照除去は必要に応じてGitHub Supportへ相談する。今回は履歴書き換え・強制Push・branch/tag削除を行っていない。

## 再発防止

- `.gitignore`で`.env.*`（`.env.example`を除く）と代表的な秘密鍵/サービスアカウントファイルを除外。
- `.env.example`に実値を置かず、統計/ルーレット/一斉送信テストの環境変数名を追記。既存名は維持。
- `scripts/scan-secrets.cjs`はGit管理対象と、指定されたPRの新規履歴をGitleaksで検査し、検出値や生のエラーを出力しない。
- GitHub ActionsはPR・週次・手動で実行。contents: readのみ、checkout認証情報の永続化なし、第三者Actionは追加せず、公式CLIを固定バージョン+checksumで取得する。既存CI/CDの必須チェックやデプロイ設定は変更せず、導入時はadvisory jobとする。
- アプリの依存ライブラリ追加はない。

## 管理者による作業（承認・デプロイ前）

1. Discordの対象チャンネル「設定 → 連携サービス → Webhook」で、漏洩したWebhookが無効化済みか確認する。残っていれば削除/失効し、新しいWebhookを発行する。テスト用と履歴に残るWebhookも確認する。こちらから削除・発行・実送信はしていない。
2. Render Dashboardで対象Web Serviceを開き「Environment」を確認する。`DISCORD_STATS_WEBHOOK_URL`を新しいURLに設定する。必要なら`DISCORD_ROULETTE_WEBHOOK_URL`（省略時はSTATSを使用）と`DISCORD_BROADCAST_TEST_WEBHOOK_URL`も設定する。実値をチャット・PR・スクリーンショットに貼らない。
3. 露出した各DB接続先の認証情報を更新する。Render/外部DB管理者と連携し、このアプリと依存サービスのDATABASE_URL/EXTERNAL_DATABASE_URL等を同時に更新して接続を確認する。固定接続先を利用していた手動診断・migrationスクリプトにも環境変数が必要になる。
4. GitHubでSecret scanning/Push protectionの利用可否を確認し、有効化する。露出した認証情報の失効を確認してからalertを解決する。
5. PRをレビュー・承認し、管理者の判断でマージ/デプロイする。その後、統計API、認証、日次レポート、ルーレット通知、一斉送信テストの本番確認を行う。Webhook未設定時はAPIの既存レスポンス構造を維持し、実送信は行われない。

Render設定はこの作業では認証済みアクセスを確保できておらず、環境変数の有無・有効性を確認していない。値の照会や既存Webhookへのアクセスによる確認は行っていない。

## 検証と影響範囲

- 97テスト成功（既存92＋統計通知5）。正常時の本文全体と送信payload、未設定/空白時の集計継続と送信skip、Axios失敗時のログ/伝播エラーの機密情報非出力、内部API/DB失敗時の処理をモックで確認。
- 変更JSの構文確認・diff whitespace確認・現行シークレットスキャンを実施。
- 認証処理、DB構造、UI、APIのURL/レスポンス形式、統計計算、通知本文は変更していない。関連呼び出し元のcatchを確認した。
- 実Discord送信、実DB接続、認証済み本番APIの疎通、Render環境変数、GitHub上のActions実行はローカル検証と区別する。実環境の確認は承認後に行う。
- リスク: 未失効のWebhook/DB認証情報、過去履歴・fork・キャッシュ・削除行、未知/検出外の機密情報。advisory scanは強制ブロックではない。
- 初期確認のツール出力に対象WebhookとDB接続情報の機密値が含まれた。以後の確認・スキャンは値を伏せたが、この会話のツール出力も漏洩先として扱い、必ず失効/ローテーションする。値をこの文書やPR本文へ再掲していない。
- PRのGitHub Actions「Secret scan (advisory)」も成功を確認した。これは本番API/Discord送信の実動作確認とは別である。
