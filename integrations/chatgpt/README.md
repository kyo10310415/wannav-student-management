# WannaV ChatGPT 読み取り専用接続（Pro向け）

5システムを横断する閲覧・検索・分析用の独立MCPサーバーです。中央管理と同じリポジトリに置き、Renderでは別Web Serviceに配置します。OpenAI APIキーは不要です。ChatGPT側の利用枠とRenderの実行費用は別です。

## 構成と接続範囲

ChatGPT Pro（Web） → このサーバー `/mcp` → 各システムの `/integrations/chatgpt/v1/catalog`・`/query`。

- ログインはGoogleの `oneloopinc.net` ドメインに限定。アカウントごとにOAuth認証し、全員共通の閲覧範囲を付与します。ChatGPTアカウント自体のメールドメインは問いません。
- 生徒名・個別記録を含みます。Googleログイン後に閲覧範囲を表示して同意を求めます。
- 公開ツールは **search / fetch** の2つのみ。更新・同期・通知・任意SQL・任意URLの中継はありません。
- 各ソースは独立したBearerトークンで認証。既存ブラウザーセッション・SSO・Googleログインの権限を変更しません。
- PostgreSQLはREAD ONLYトランザクション、SQLiteは固定SELECTだけを実行します。ソース側に新しい業務テーブルや定期ジョブは作りません。
- OAuthのクライアント、認可コード、トークン、認可情報は専用PostgreSQLスキーマに保存。再起動で認証情報が消えません。トークンはハッシュで保存し、クライアントシークレット等の認証メタデータはDB内で保護してください。

| source    | 配置リポジトリ / 本番ブランチ          | 主なデータ                                                      |
| --------- | -------------------------------------- | --------------------------------------------------------------- |
| central   | wannav-student-management / main       | 生徒、予約、実施・欠席報告、Sheetsの満足度回答、Tutor週次保存値 |
| extension | extended-management / main             | 生徒キャッシュ、審査回別保存値、月次・週次・当月暫定KPI         |
| ep        | WannaV_EP / main                       | 生徒、学習進捗、日別利用、EP満足度回答                          |
| sales     | wannav-sales / main                    | 報告行、既存定義で重複除去した面接・成約等のイベント            |
| payment   | payment-management / codex/initial-app | 対象月の支払い統合一覧、既存定義のMAU・ARPU                     |

## 配置手順

以下は配置のための手順です。リポジトリの変更だけでは本番接続は完了しません。

1. 5リポジトリの変更を確認し、それぞれ上記の本番ブランチへ反映します。各ソースには`chatgpt-readonly/`と起動ファイルの小さな変更があります。
2. パスワードマネージャーなどで**サービスごとに異なる**32文字以上のランダムトークンを生成。各既存Renderサービスの`CHATGPT_READ_TOKEN`と、共通サーバーの対応する`CENTRAL_TOKEN`等に同じ値を安全に設定します。値をチャット・ログ・コマンド履歴に出さないでください。
3. 共通サーバーのRender Web Serviceを作成します。Blueprintパスは`integrations/chatgpt/render.yaml`。既存のルート`render.yaml`は変更しません。ソースコードが配置されたブランチを指定し、サービスのリージョン・実行プランを確認します。新サービスURLを`PUBLIC_URL`へ設定します。
4. OAuth用PostgreSQLを用意します。既存中央DBに専用スキーマ・専用ロールを用意することも可能ですが、既存業務テーブルの権限は付与しません。`AUTH_DATABASE_URL`はこの認証ストアだけを指します。管理者が接続先と差分を確認し、**一度だけ明示的に**`npm run db:migrate`を実行します。起動時の自動DDLはありません。実行ロールには`chatgpt_oauth.records`のSELECT/INSERT/UPDATE/DELETEとスキーマUSAGEが必要です。
5. Google Cloudで社内用のWeb OAuthクライアントを用意します。リダイレクトURIに`https://<MCPサービス>/oauth/google/callback`を登録。`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`はRenderで設定します。クライアントの同意画面・公開範囲は社内利用に合わせます。
6. 各`*_URL`には該当システムのHTTPS origin（パスなし）を設定します。Sheets満足度は中央管理の既存`GOOGLE_CACHE_SHEET_ID`または`GOOGLE_SHEET_ID`と認証設定を利用します。追加のGoogle書き込み権限は不要です。
7. ChatGPTの接続設定で表示される**正確なOAuth callback URI**を`CHATGPT_REDIRECT_URIS`へ設定します。任意のURLを登録可能にせず、表示値のみ許可します。初期設定で登録が拒否された場合は、callbackを確認して設定後に再試行します。クライアントID/secretを手動指定する方式でも、登録済みOAuthクライアントを使う必要があります。
8. ソース5サービスと共通サーバーを配置します。`/health`はプロセスの生存確認です。データ取得可能性はMCPの`fetch("catalog")`と各データの試験で確認してください。
9. ChatGPT ProのWeb画面でカスタムMCP接続を追加し、endpointに`https://<MCPサービス>/mcp`、認証にOAuthを指定。Googleで社内ログインし、読み取りに同意します。UI名・利用可否はアカウントへの提供状況によって異なります。[公式接続案内](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)を確認してください。Proは読み取り接続を対象とし、無料・Plusは今回の検証対象外です。
10. 接続したツールを会話で選び、「WannaVの利用できるデータを確認して」「学籍番号○○の情報を各システムで確認して」「保存済みの先月と今月の延長率を比較して」と質問します。集計値と既存画面を照合してから社内展開します。

## データの使い方・正確性

`fetch(id="catalog")`にデータ項目・クエリ形式・接続失敗したソースが表示されます。通常の日本語質問をChatGPTが構造化クエリに変換し、`search(query=<JSON文字列>)`で参照IDを得て`fetch(id=<参照ID>)`で取得します。

```json
{
  "dataset": "central.lesson_reports",
  "filters": [
    { "field": "lesson_date", "op": "gte", "value": "2026-10-01" },
    { "field": "lesson_date", "op": "lt", "value": "2026-11-01" }
  ],
  "groupBy": ["lesson_result"],
  "metrics": [
    { "as": "students", "op": "distinct", "field": "student_id" },
    { "as": "reports", "op": "count" }
  ]
}
```

```json
{
  "dataset": "extension.monthly_kpi",
  "filters": [{ "field": "year_month", "op": "gte", "value": "2026-09" }],
  "groupBy": ["year_month"],
  "metrics": [
    {
      "as": "extended",
      "op": "sum",
      "field": "snapshot_data.exam1stExtensionCount"
    },
    {
      "as": "targets",
      "op": "sum",
      "field": "snapshot_data.exam1stTargetCount"
    }
  ],
  "ratios": [
    {
      "as": "extension_rate",
      "numerator": "extended",
      "denominator": "targets"
    }
  ]
}
```

```json
{ "dataset": "payment.metrics", "month": "2026-11" }
```

- 延長率＝延長人数÷審査対象人数。対結果お伝え＝延長人数÷結果お伝え済み人数。分母0はnull。未保存の分母や結果を推測しません。既存KPIに「結果お伝え済み人数」がない場合は算出不可として回答します。
- 審査回の保存値は**現在値**です。対象月や当時の担当を推測して月次要因分析に使用しません。過去月のKPIが未保存なら、その事実を返します。過去の生徒別要因分析には、その時点の対象者・担当・進捗等の履歴が別途必要です。
- `history`: `current`=現在の保存状態、`event`=日付付き業務記録（後で訂正される場合あり）、`event_cached`=外部キャッシュの回答、`snapshot`=保存済み集計、`provisional`=暫定集計、`reconstructed`=現在保存されている契約等から対象月を再計算。
- 学籍番号がない・重複しているレコードは勝手に氏名照合しません。右側が一人一行のデータセットのみ学籍番号で左結合でき、不一致件数を返します。複数行の学習・支払い・審査記録同士の自動結合はしません。
- 中央管理の満足度（0〜10）とEP満足度（1〜5）は別指標です。年月はAPIでYYYY-MMにそろえます。暫定・確定、対象者の条件も区別します。
- 支払い一覧・MAU・ARPUは既存の合成・集計処理を再利用します。銀行の生明細・口座情報・ログイントークンは出力しません。
- 売上`reports`は生の報告行です。`events`は既存の人物・面接日キーと結果定義で重複除去し、interviews/contracts等の0/1フラグを返します。複数面接担当者が混在するイベントの担当はnullにします。eventsのフラグの合計で集計し、reportsの件数を面接数とみなしません。
- フィルター後の最大1万行を取得し、サーバー側で全件を集計してから最大200行ずつ表示します。上限超・4MiB超・取得失敗時は、集計を返さず絞り込みを求めます。ページ間やソース間では更新があり得るため、厳密な同時点の全社スナップショットではありません。
- 空欄と0を区別します。数値集計は`*_known`/`*_unknown`を添えます。回答に期間・条件・更新/取得日時・データ参照を含める指示をMCPに設定しています。関連性から因果関係は断定しません。

## 運用と失効

認可コードは2分、アクセスは1時間、認可・refreshは30日。PKCE S256、クライアント・redirect・resource検証、ブラウザーと結び付けたGoogle state/nonce、同意フォームのOrigin検証、refreshローテーションを使用します。ログにデータ・メール・秘密値を出しません。

OAuthのrevoke endpointで接続の認可単位を失効できます。管理者が退職者等を明示失効する場合は、認証DBの`chatgpt_oauth.records`から`kind='grant' AND data->>'email'=$1`に該当する行をパラメーター付きSQLで削除してください。Googleアカウントの停止だけでは、既存の認可が即時失効する仕組みではありません。ソースAPIトークンを変更すると、該当ソースへのアクセスを停止できます。

この機能を戻す場合は、共通サーバーを停止し、各サービスの`CHATGPT_READ_TOKEN`を削除します。既存業務データや既存ログインには変更しません。

## 検証

このディレクトリで`npm ci` → `npm test`。OAuth・MCPの実HTTP/SDK接続、認可コード・refreshの再利用拒否、失効、集計・欠損・重複・結合を検証します。Google認証と本番データは試験では模擬します。

各ソースリポジトリでは`npm run test:chatgpt`。5リポジトリを同じ親ディレクトリにcloneした環境では、`WANNAV_SOURCE_ROOT=<親ディレクトリ> npm run test:contracts`で原本のテーブル定義から隔離DBを作り、固定SQLを検証できます（Node 24のnode:sqliteを使用）。支払い管理では追加の実SQL試験で既存の月別合成・MAU/ARPUとの整合を検証します。

本番Google認証、ChatGPT Proの実接続、本番DB・Sheets上の件数・履歴網羅性は、設定後の受け入れ確認が必要です。
