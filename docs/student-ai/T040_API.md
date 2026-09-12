# T040: 認証付き回答API

コード/mockテスト実装。実データ受入とWorkレビューは未完了。本番deploy、migration、Drive/OpenAI実データ呼び出し、backfill、UIは本変更に含まない。

## リクエスト

`POST /api/student-ai/:studentId/questions`

有効なBearer sessionとadmin/leader/crewのいずれかが必要。全3ロールは全生徒を参照できる。担当者限定ルールは追加しない。Content-Typeはapplication/json。

```json
{"question":"この生徒の現在の課題は？","compareAt":"2026-06-01"}
```

- question: 必須string、空白のみ不可、Unicodeコードポイント2000以内。
- compareAt: 任意の実在日付YYYY-MM-DD。null、不正日付、時刻付きは400。曖昧な比較は指定を促す400。
- 未知キーは400。studentId/context/evidence/messages/model/nowはbodyに指定できない。
- studentId: URLのみ、空白のみ不可、128コードポイント以内、制御文字不可。既存形式を固定正規表現で排除せず、DB完全一致で存在を確認する。
- 実bodyは32 KiB以下。Content-Lengthの有無や偽装に関係なくstreamの受信bytesを数え、超過時はreaderをcancelする。
- nowはサーバーのJST暦日。UTC 15:00が翌日との境界。

## 応答

成功は200で `{success:true,data:{...}}`。全応答にCache-Control:no-storeを設定する。

dataはstatus、answer、evidence、changes、recommendedActions、confidence、sources、coverage、usage。statusはanswered/insufficient_evidence、confidenceはhigh/medium/lowで実測正答率ではない。

| 項目 | 契約 |
|---|---|
| answer | 非空string、4000コードポイント以内 |
| evidence | 最大12件。statement（800以内）、evidenceId、quote（1000以内） |
| changes | 最大5件。description（800以内）、evidenceIds |
| recommendedActions | 最大5件。action/reason（各800以内）、evidenceIds |
| evidenceIds | 1〜12件、重複不可、evidenceで引用済みのIDのみ |

すべてのモデルオブジェクトで必須キー、未知キー、型、列挙値、上限を検証する。JSON解析前の回答文字列も128 KiBまでとする。各フィールドの上限に加え、総出力token上限も満たす必要がある。answeredには1件以上の引用が必要。同じevidenceIdの重複は拒否する。quoteは指定IDに対応するtextの空でない完全一致部分文字列。改行・Unicodeの正規化をしない。changesには異なるsourceIdかつ異なる既知日付の2時点以上を必要とする。

モデルのメタデータを採用せず、各引用にsourceId/lessonDate/version/field/start/end/sourceKindをサーバーから追加する。start/endはT030抜粋全体のUnicodeコードポイント位置（end exclusive）で、quote固有の位置ではない。

sourcesは実際に引用したsourceIdごとに1件とし、sourceId/lessonDate/version/driveUrl/evidenceIdsを返す。Drive IDは英数字・underscore・hyphen、1〜200文字のみ許可してencodeURIComponentし、サーバーでURLを構築する。不正/欠損ならnull。日付欠損はnull、未知Tutor名を作らない。

insufficient_evidenceはlow、空evidence/changes/recommendedActions/sourcesと日本語定型文。T030で根拠ゼロなら回答AIを呼ばない。AIが判断不能と返した場合も、構造検証後に本文を定型文へ置換して事実の断定が混じることを防ぐ。判断不能なのに引用や提案が入った出力は502。

## coverage / usage

T030 coverageを保ち、answerEvidenceIds、answerSourceIds、answerUsesExcerptsOnly:trueを追加する。前2項目は生成に渡す抜粋/資料を示し、sourcesは実際の引用先を示す。

scope=stored_minutes_only、driveBackfillComplete=falseの意味を維持する。allStoredSummariesReviewedやsummaryScannedIdsは全文やDrive全期間を精読した証明ではない。rawScannedIdsも生成モデルが全文を読んだ意味ではない。summaryとstored_transcript_unverifiedを確定原文字起こしへ昇格しない。

usageは以下の形。callsは実行したプロバイダー呼び出しごとのallowlist済み実usage。各metricは非負safe integerまたはnull。推定token数を混ぜない。

```json
{
  "selection": {"calls": [{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}],
                "total": {"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}},
  "answer": {"calls": [{"prompt_tokens":20,"completion_tokens":3,"total_tokens":23}],
             "total": {"prompt_tokens":20,"completion_tokens":3,"total_tokens":23}},
  "total": {"prompt_tokens":30,"completion_tokens":5,"total_tokens":35}
}
```

あるcallでmetricが欠損/不正なら、そのmetricのstage totalと全体totalもnull。既知metricのみ合算し、欠損を推測しない。呼び出しゼロのstageだけはcalls:[]と合計0（未呼び出しという既知事実）になる。T030はusage欠損callもnullとして保持する。

## 設定・モデル・入力予算

STUDENT_AI_ENABLEDが文字列trueの場合だけ有効。未設定・falseなら認証/role確認後503。

OPENAI_API_KEYを既存機能と共用するが、STUDENT_AI_SELECTION_MODELとSTUDENT_AI_ANSWER_MODELはOPENAI_MODELから独立させる。既存議事録の設定変更がAIカルテのAPI互換性/予算を変えないため。両方の既定値はgpt-4.1-mini-2025-04-14。許可値はこのsnapshotとgpt-4.1-miniのみ。別モデルの追加はAPI/予算を再確認してコードレビューする。

OpenAI SDK 6.45.0のChat Completionsを既存T030と合わせて使用。JSON modeを使い、サーバーの厳密検証を最終ゲートにする。JSON schemaだけでは引用一致・複数時点を検証できないため、モデルJSONの無検証透過はしない。toolsなし、store:false、SDK logLevel:off、retryなし。client生成は最初の有効リクエスト時まで遅延し、環境変数不足でmodule importを落とさない。

公式[GPT-4.1 mini仕様](https://developers.openai.com/api/docs/models/gpt-4.1-mini)で、snapshot、Chat Completions対応、context window 1,047,576、最大出力32,768を確認（2026-09-12）。本実装はこれより小さい100,000の総予算と、選択1,200/回答2,000の出力上限を使用する。実アカウントでのモデル利用可否は未確認。

serializeしたmessages全体（system指示、質問、JSON資料・metadata・coverage）をcountTokensへ渡す。標準はUTF-8 byte数による保守的推定で、実測token数ではない。選択は推定入力+1,200+1,024、回答は推定入力+2,000+1,024が100,000以下であることを確認する。1,024はframing余白。文字数だけでは判定しない。T030の既存40,000 JS string unitsの選択入力上限も維持する。

createStudentAiRoutes/各serviceにはcounter、予算、時計、deadline、provider timeout、client/queryなどを注入できる。数値上限は正のsafe integerで本番既定上限以下のみ。リクエストbody/環境変数から数値上限を上書きする入口は追加しない。

将来の承認済み検証環境で有効化する場合のみ、既存DATABASE_URL/OPENAI_API_KEYと上記モデル設定を用意し、STUDENT_AI_ENABLED=trueを明示してプロセスを起動する。モデル/client設定は初回成功後に保持されるため、設定変更は再起動で反映する。今回、有効化・起動・deployは実行していない。

## 期限・同時実行・DB・ログ

入力検証後、1ユーザー1件、プロセス全体2件まで。選択と回答を含む全体期限120秒、各プロバイダー呼び出し60秒以内、回答生成は1回。各AI requestにAbortSignal/timeout/maxRetries:0を渡す。全体期限やクライアント中断はT030のDB境界と各選択バッチにも伝える。

504を返すためにraceは使用するが、同時に実処理をabortし、workerが終了するまで枠を保持する。中断後に新しいDB/選択/回答呼び出しを開始しない。クライアントの中断に従わないテスト用provider/進行中DBが残っていても早期に枠を解放しない。通信障害等で永続的にsettleしない処理があれば可用性は落ちるが、追加処理を許可して上限を超過させない。

pgの進行中queryをAbortSignalで強制キャンセルする機能は今回追加していない。専用poolはmax:2、接続待ち5秒、DB側statement_timeout:60秒、default_transaction_read_only:on。応答済みのdeadline後も進行中DBが終了するまで枠を保持し、結果から後続AIを始めない。実DBでのtimeout・schema・SSL統合は未検証。

既存connection.queryは失敗時に生error.messageを出力するため、新APIは認証SQLを含め専用lazy poolを使用する。共有poolの生idle error出力も通らない。専用queryは固定エラーだけをthrowし、idle error payloadをログ出力しない。SSL設定は既存接続と同じ。共有middlewareの認証SQL/既存minutes APIの動作は変更しない。

同時実行制限は単一プロセスのdefault routeインスタンス内。複数インスタンス合計や日次課金額を制限しない。body受信・認証処理は120秒の生成期限外（bodyはbytes制限、認証DBはpool timeoutの対象）。チャット履歴、質問/原文/回答ログ、永続ファイルは保存しない。

## エラー

失敗は `{success:false,error:"固定の日本語メッセージ"}`。内部code/message/stackは返さない。

| HTTP | 条件 |
|---|---|
| 400 | JSON/型/キー/studentId/日付不正、比較時点不足 |
| 401 | 認証なし・無効・期限切れ |
| 403 | 許可外role |
| 404 | 生徒不存在 |
| 409 | SOURCE_CHANGED（再実行案内） |
| 413 | body超過 |
| 422 | source/選択/回答入力/呼び出し上限、縮約不能 |
| 429 | 同時実行枠超過 |
| 500 | 生徒scope違反、DB/内部異常 |
| 502 | JSON/構造/引用不正、refusal、出力打ち切り |
| 503 | フラグOFF、設定不足、プロバイダー一時利用不可 |
| 504 | 全体/プロバイダー期限、クライアント中断 |

## 未検証事項

引用の完全一致は主張の意味的妥当性を保証しない。promptの構造境界テストは実モデルのprompt injection耐性の証明ではない。実AI精度・費用・速度、実DB、ブラウザーsmoke、複数インスタンス運用、全Drive履歴の取り込みは未検証。T050以降の受入を今回のcode/tests完了と区別する。
