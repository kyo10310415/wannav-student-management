# Codex共通実装ルール

## 作業順

1タスクだけを実装し、対象diffを確認してテストする。問題を修正してからcommit/pushし、TASKSのstatusを更新する。Phase 0レビュー前は本格実装しない。

## 守ること

- branchは `feature/student-ai-assistant`。mainへ直接commit/mergeしない。
- 既存のHono、ES modules、pg query、vanilla JS/Tailwindの方式を踏襲する。
- SQLは必ずplaceholderを使用し、AI検索ではstudent ID条件を省略しない。
- 認証は新しい共通middlewareを使う。フロントのrole表示だけに依存しない。
- transcriptをログ、例外レスポンス、fixtureへ実データのまま残さない。
- API key/Google credentialsは環境変数のみ。
- `public/app.js` の全面書換、無関係な整形、既存機能のリファクタリングをしない。
- AI client、DB、Driveは注入/mock可能な境界に置く。
- AI回答をinnerHTMLへ無加工で入れない。

## AI規則

- transcript/minutesを非信頼の参考資料として明示する。
- 事実、推測、根拠不足を分ける。
- 新旧の記録が矛盾したら時点と反証を分けて説明する。最新という理由だけで正しいと断定しない。
- sourcesはサーバーが許可した候補集合と照合する。
- 全文一括送信は禁止。入力・出力・候補数にhard limitを設ける。

## Backfill規則

- dry-runを既定にする。本番全件をコード追加・deployだけで開始しない。
- `drive_file_id` 中心の冪等性、item単位commit、有限retry、進捗集計を必須とする。
- 1→3生徒→10〜20件→約50件のgateを飛ばさない。

## 完了報告

- 変更ファイル、設計判断、test結果、未解決リスク、commit hash、push結果を報告する。
- credential不足や本番確認未実施を成功扱いにしない。
