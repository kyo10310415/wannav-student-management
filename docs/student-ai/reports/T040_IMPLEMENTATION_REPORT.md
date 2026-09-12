# T040 Implementation Report

実施日: 2026-09-12。担当: Codex。Workレビュー未実施。

## 1. Outcome

T040の認証付き回答API、回答生成service、引用/構造検証、入力予算、同時実行制限、キャンセル伝播を実装し、mockテストを完了した。feature/student-ai-assistantへ実装をpush済み。

機能フラグは既定OFF。実AI・実DBによる受入は未実施。本番deploy、migration、本番DB更新、OpenAI/Google実データ呼び出し、backfill、main mergeは実行していない。T050以降のstatusは変更せず、T040で停止する。

## 2. 変更ファイル・API契約

- src/routes/studentAi.js: createStudentAiRoutes、認証/role/フラグ/入力/安全なエラー、枠と期限管理。
- src/services/studentAiAnswerService.js: prompt、JSON/引用/参照検証、sources/coverage/usage構築。
- src/services/studentAiRuntime.js: lazy client・ログを出さない専用read-only DB境界・共通キャンセル処理。
- src/services/studentAiContextService.js / studentAiSelectionService.js: T030への限定修正。signal伝播、DB/選択前後の停止判定、JST既定日、usage欠損call保持、出力とframing予算、store:false。
- src/index.js: importとapp.routeの2行追加のみ。
- tests/studentAiAnswer.test.js / studentAiRoutes.test.js: 架空fixtureとHono/OpenAI/DB mockによる検証。
- .env.example、docs/student-ai/T040_API.md、TASKS.md、ARCHITECTURE.md、SECURITY.md、TEST_PLAN.md、T030_CONTEXT.md: 設定・契約・制約・受入状況を更新。

POST /api/student-ai/:studentId/questions。bodyはquestion（必須string、空白のみ不可、2000 Unicodeコードポイント以内）とcompareAt（任意の実在YYYY-MM-DD）のみ。実bodyは32 KiBまで。旧形式studentIdもDB完全一致で確認する。

成功は200と{success:true,data:{status,answer,evidence,changes,recommendedActions,confidence,sources,coverage,usage}}。全応答にno-store。401/403/404/400/413/429/504/503/502/500に加え、記録更新409、処理上限422を安全な固定日本語に対応付けた。

指示書案からの明確化: evidenceへサーバー由来metadataを追加。sourcesはsourceIdで重複排除しevidenceIdsを保持、Tutor名を補完しない。changes/actionの参照は実際に引用したIDに限定。changesには異なるsourceと異なる既知日付を要求。判断不能の本文は定型文へ置換する。詳細は[API仕様](../T040_API.md)。

## 3. 認証・引用・入力予算・キャンセル

共通createRequireAuthを使い、admin/leader/crewだけを許可する。未認証/期限切れ/未知roleの拒否は生徒検索・AIより前。STUDENT_AI_ENABLED=trueの明示時だけ有効。

既存connection.queryは生error.message、shared poolはidle errorをログへ出すため、新APIの認証と生徒検索は専用lazy poolを通す。read-only、接続待ち5秒、statement_timeout60秒、pool最大2。SSL設定は既存と同じ。共有認証SQL・minutes API・postinstallは変更しない。新規依存/依存更新はない。

context.studentIdを要求IDに照合する。生成JSONの必須/未知キー、型、上限、列挙値を検査し、evidenceId whitelistと指定抜粋内の完全一致quoteを確認する。改行/Unicodeを正規化せず、全参照を検査する。架空ID・改変quote・JSON破損・refusal・打ち切りは回答全体を拒否し、修復retryはしない。

sources/coverageはサーバー構築。summaryとstored_transcript_unverifiedの区別、未取り込み/欠損/未参照coverageを維持する。生成に渡した抜粋IDと引用先を区別し、全履歴精読を主張しないpromptとする。質問/資料はuser JSON内に限定し、資料の命令をsystemへ昇格させない。

OPENAI_MODEL流用を避け、専用の選択/回答設定を採用した。既定はgpt-4.1-mini-2025-04-14、同snapshotとgpt-4.1-miniだけを許可。[公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-4.1-mini)と導入済みSDK6.45.0の型/APIを確認。messages全体のtoken counterを注入可能とし、既定はUTF-8 byte数による保守的推定。入力＋出力予約＋1024余白が100000以下であることを確認する。選択出力1200、回答出力2000。推定値は実usageへ混ぜない。usage欠損はmetricごとにnullとし、選択/回答/合計を分ける。

1ユーザー1件、単一プロセス2件、入力検証後の全体期限120秒、各プロバイダー60秒、retryなし。全体/個別期限/クライアント中断をAbortSignalで伝播する。504返却後もworkerが終了するまで枠を保持する。DBが中断できなくても終了後に追加DB/AIを始めない。複数インスタンス合計や日次課金上限は保証しない。body受信と認証は生成期限外。

## 4. 実行環境・baseline・最終検証

- Node v22.23.2。
- baseline: ec99ffaf7e93971d17fdfa0e4f478f2e1eb225c0、101/101成功、失敗0。
- 最終: 3f4e9c09606650f8252b4a332bb5a2a2787d2d55のコード、npm test 232/232成功、失敗0、skip0。追加131件。
- npmのWindows起動ラッパーによる実行版の曖昧さを避け、Node22からnpm-cli.jsを起動。全子プロセスでNode22以外を拒否する一時preloadも付けてbaseline/最終を確認した。baselineは隔離したdetached worktreeで実行し、実装を巻き戻していない。
- 依存は前回のnpm ci --ignore-scriptsで導入済み。導入時のnpmホストがNode24だったためengine warningはあったが、postinstall/migrationは実行していない。今回の上記テストはNode22である。
- git diff --cached --check成功。実装差分を自己レビューし、public/app.js、共有認証/接続ヘルパー、package.json/package-lock.json、本番設定は未変更。

検証対象は3ロール、未認証/期限切れ、未知role、既定OFF/設定欠落、旧形式ID、JST境界、body stream/Content-Length偽装、引用ID/原文/型/上限/未知キー、JSON破損/打ち切り/refusal、根拠ゼロ、usage欠損、カナリア分離、429/504、DB/AIが中断未完了の場合の枠保持、次バッチ停止、秘密文字列を含む障害fixtureの非露出。T030と既存minutes APIを含む全件が成功した。

独立したlint/typecheck/build scriptはpackage.jsonにない。index.jsをimportしてcronを起動するテストは行っていない。

## 5. 未検証事項

実モデルの回答精度・引用の意味的妥当性・prompt injection耐性、費用・速度、実PostgreSQL schema/SSL/timeout/クエリ計画、Drive/バックフィル、ブラウザー上の既存画面smoke/E2E、複数インスタンス運用は未検証。構造境界や引用一致のmock成功を、実AI品質の合格と扱わない。

原文字起こし由来が未検証の既存transcriptとsummary欠落による検索限界はT030から継続する。進行中DBを即時中断する機能は追加していない。provider/DBが永久にsettleしなければ枠を保持し続けるため、可用性に制約がある。

## 6. GitHubの確認済みSHA・変更リンク

- 開始時remote: ec99ffaf7e93971d17fdfa0e4f478f2e1eb225c0。
- 指定T030: 1605f347985b7ddd3dda7dc394d1ff2e74752097が祖先であることを確認。
- 検証対象の実装commit: **3f4e9c09606650f8252b4a332bb5a2a2787d2d55**。
- 実装push後、git ls-remoteでfeature/student-ai-assistantのremote SHAが上記実装commitに一致することを確認済み。
- [実装コミット](https://github.com/kyo10310415/wannav-student-management/commit/3f4e9c09606650f8252b4a332bb5a2a2787d2d55)
- [開始時点からの差分](https://github.com/kyo10310415/wannav-student-management/compare/ec99ffaf7e93971d17fdfa0e4f478f2e1eb225c0...3f4e9c09606650f8252b4a332bb5a2a2787d2d55)

この報告自体を含む最終commit SHAはpush確認後にチャットで伝える。自己参照SHAは本文へ記載しない。

## 7. Workへのレビュー依頼事項

1. 引用1ID1件、changesの複数source/既知日付要件、判断不能定型文、sources/coverage/usage契約が後続UIに適切か。
2. 専用read-only poolの導入、無ログ境界、認証/生成期限の区分、未完了処理の枠保持と運用上の制約。
3. モデル許可リスト、保守的入力予算、最大出力とJSON形式拒否の頻度を、後続の実AI評価でどう受け入れるか。
4. summary/unverified transcriptと未参照範囲の表示、引用一致では保証しない意味的品質をT050でどう評価するか。

自己レビューとmockテストは完了。Workによるレビュー済み・実データ受入済みとはしていない。
