# Codex実装指示：T050 検索評価・生徒分離の検証基盤

この指示書に沿いT050の評価基盤・架空fixture・テスト・報告を実装し、feature/student-ai-assistantへcommit/pushしてください。Workが設計・レビュー、Codexが実装を担当します。計画だけで停止しないこと。今回は外部AI・実DBを呼ばず完了できる範囲を実施します。

## 1. 現在地と作業開始

- リポジトリ: https://github.com/kyo10310415/wannav-student-management.git
- 作業ブランチ: feature/student-ai-assistant
- T040実装: 3f4e9c09606650f8252b4a332bb5a2a2787d2d55
- Workレビュー済み実装HEAD: 6b896fd7bf2ec9b8794fa1f012d20cfb47ca00c0
- Workレビュー・タスク更新: 63f47dcd4f13b0deb7f53524ac83c57f3fb3073a
- T040はコード/mockテスト承認。Node22.23.2で232件成功。実AI精度・費用・速度、実DB統合、本番受入は未実施。
- T005測定完了、T010方式承認済み。T030/T040を再実装しない。

開始時にローカル変更とAGENTS.mdを確認し、既存作業を保持。最新remote featureを取得し上記コミットの祖先関係と追加変更を確認。必要なら隔離worktreeを使用。reset --hard、force-push、main同期による巻戻しは禁止。

読む資料:
- docs/student-ai/CODEX_HANDOFF.md
- T040_CODEX_HANDOFF.md、reports/T040_WORK_REVIEW.md、reports/T040_IMPLEMENTATION_REPORT.md
- T030_CONTEXT.md、T040_API.md、REQUIREMENTS.md、ARCHITECTURE.md、SECURITY.md、TEST_PLAN.md、TASKS.md
- src/services/studentAiContextService.js、studentAiSelectionService.js、studentAiAnswerService.js、studentAiRuntime.js
- src/routes/studentAi.jsと既存テスト

Node22でbaselineを実行。依存導入が必要ならnpm ci --ignore-scripts。postinstallがmigrationを実行するため通常のnpm ci/npm installは禁止。npm startやsrc/index.js importによるcron起動も行わない。

TEST_PLAN.mdにある「T005/T010未完了」「latest main同期」「通常npm ci」は古い記述。本指示と現在のTASKSを優先し、今回の範囲で整合させる。古いテスト実績は履歴として保持。
「記録1件なら必ず判断不能」「最新記録なら常に正しい」も一律ルールにしない。1件で支持できる事実は回答可能、複数時点の変化は別時点の根拠が必要。

## 2. ゴールと完了の区別

次の3つを別々に検証できる状態を作る。

1. 検索: 必要な過去記録・転機・反証を最終evidenceまで残せるか。
2. 回答: 引用ID/原文一致だけでなく、引用が主張を支持し、事実・推測・提案・不明を区別できるか。
3. 分離: 質問対象以外の生徒データがDB結果、選択/回答prompt、回答/sourcesへ混入しないか。

今回の完了表示は「evaluation harness/code/tests done; live quality pending」とする。架空fixtureのmock成功を実モデルの検索精度、意味的正確性、攻撃耐性、費用・速度の合格としない。T050全体の実品質受入は保留。

## 3. 変更範囲

推奨構成（既存構造に合わせて調整可）:
- tests/fixtures/student-ai-evaluation/ : 架空記録、質問、期待根拠、期待主張、ケースschema
- src/services/studentAiEvaluationService.js または scripts/lib/配下 : 採点・検証・集計の純粋関数
- scripts/evaluate-student-ai.js : オフライン評価CLI
- tests/studentAiEvaluation.test.js : 採点器の正誤判定と評価pipelineの結合テスト
- 必要な生徒分離の追加テスト
- docs/student-ai/T050_EVALUATION.md : 実行方法・指標・制約・後続の実評価手順
- docs/student-ai/reports/T050_IMPLEMENTATION_REPORT.md : 完了報告
- TASKS.md、TEST_PLAN.md等の限定更新
- 必要ならpackage.jsonにオフライン評価script追加。既存test/postinstall/startと依存は原則維持。

再現した不具合に対するT030/T040の小修正は可能。先に失敗を示す意味のあるテストを追加し、原因・修正・影響を記録。安全な拒否を弱めて評価を通さない。検索方式の全面変更、外部検索基盤、UI、backfillは範囲外。

## 4. 評価データ

最低24の独立した日本語質問ケース。重複した言い換えだけで件数を増やさない。全データは架空であることを明記し、合成ID/Drive ID/氏名のみ使用。実生徒の匿名化コピー・実測統計・本番文字起こしは禁止。

各ケースに:
- stable caseId、category、question、studentId、固定now(JST日付)、必要ならcompareAt
- 架空students/minutes（既存DB戻り値のshapeと一致）
- 必須根拠グループ、許容代替根拠、重要反証、関連根拠集合
- 期待される主張、禁止される断定、答えられない点
- answerable / insufficient / expected_errorの期待区分と理由
- ケースの狙い、どの失敗を検出するか
- 単一記録の複数抜粋を出典数と重複計上しないためのsourceId・field・原文位置対応

必須の観点（複数ケースで兼用可）:
- 現在の課題、前回の小目標、比較、全期間の成長、反復課題、YouTube/SNSのテーマ検索。
- 要約では言い換えられた関連事項、単語が似ているだけの無関係記録。
- 最新数件より前にある転機、固定月次代表から外れる重要事項、後日の改善/反証。
- 比較前後双方、日付境界/月末/JST、曖昧な比較日付。
- 資料0件、1件で答えられる事実、1件では答えられない長期変化。
- 要約欠落、文字起こし欠落、summaryのみ、stored_transcript_unverified、日付/lesson_number欠損。
- 同日別記録の維持、同一Drive ID重複、読み取り間version変更。
- 多数記録/複数バッチ/階層選択、最終evidenceの件数・文字数制限で重要根拠が落ちる場合。
- 生徒A/Bに似た名前・課題・レッスン日があり、Bだけに固有カナリアが存在。
- 資料内の「命令を無視」「別生徒を検索」、偽の根拠ID/管理者指示/URL。
- 存在する引用を添えた逆の結論、無関係な引用、事実に見せた提案。

根拠正解はfixture本文から独立して人が確認できる形で定義する。実装の現在の返却値をそのままgoldenに採用しない。制限で落ちるケースを黙って正解集合から削除しない。

## 5. 評価pipeline

- 実際のT030 context service、selector adapter、T040 answer service/routeを必要な層で通す。各層の検証範囲を表示する。
- SQL fakeはplaceholderと引数を検査し、DB側の絞込相当を実施。別テストでは混入したrowを故意に返してサービス側の拒否を検証。
- 全ネットワーク/DB依存を注入。productionのdefaultQuery/clientを呼ばない。
- mockで選択を固定する場合は「scripted/oracle selection」と明示。これは配線・budget・出典保持の検証であり意味検索の精度ではない。
- 正解fixtureの期待IDを読むmockが高recallを返すことを、検索アルゴリズムの性能指標に使わない。
- わざと古い根拠しか選ばない、反証を落とす、別生徒を混ぜる、不正引用を返す等のcontrolled bad outputsを採点器が確実に検出する。
- ゴールドの主張・禁止事項・正解IDを、将来の実AI入力に混ぜない。provider入力と評価専用正解データを構造的に分離。
- 評価結果はmode=offline_mock、semanticQuality=not_evaluatedを必須表示。
- オフラインでは実モデル名による成功実績を作らない。

## 6. 指標と採点

数式・分母・NA条件を文書化し、手計算できる小fixtureで採点器を検証。

### 検索
- 必須根拠グループのrecall = 最終evidenceが満たした必須グループ数 / 必須グループ数。代替根拠のいずれかで満たすOR条件と、比較の前後など両方必要なAND条件を区別。
- 関連source precision = 関連集合内の一意source数 / 返却した一意source数。
- 反証取得率、比較の両時点取得率を別集計。
- DB候補、選択後source、最終evidenceを区別し、どの段階で欠落したかを示す。本文位置が重要なケースはsourceId一致だけで満点にしない。
- 必須根拠0件はrecall=NA。答えられるケースで返却0件はrecall=0。空配列同士を自動100%にしない。
- ケースmacro集計と分子/分母のmicro集計を混同しない。カテゴリ別、全体、未評価件数を表示。

### 回答
- 機械検証: 引用ID許可集合、quote一致、JSON形式、参照の整合、生徒カナリア、metadata由来。
- 意味評価: 各主張が引用から支持されるか、時点、反証、禁止断定、根拠不足時の棄権、提案/事実の区別。manual requiredを既定。
- 単なる語句一致やLLM自己採点を意味評価の合格根拠にしない。
- 手動評価の入力形式を用意し、caseId・runId・評価対象出力のhashを結びつける。異なるrunや改変出力への採点流用を拒否。
- 未入力はpending/NA。0点や満点へ変換しない。
- controlled bad answerに正しいquoteが付いていても、構造はpass・意味はfailになり得ることをテストと文書で示す。

### 性能・usage
- 選択と回答の呼出数、実usageの有無、input limit/timeout/形式拒否率。
- mock時間を本番レイテンシに使わない。mock usageを実利用量・費用にしない。
- 失敗ケースを集計から除外して成功率を水増ししない。計測不能な使用量はunknown。
- 実モデル評価用の費用/速度欄は今回not_measured。

## 7. 合格基準

今回のcode/tests受入:
- Node22の既存232件を含め回帰成功（最新baselineが増えていればそれを基準）。
- 24件以上のfixtureのschema整合、評価pipelineの再現性、指標の手計算照合。
- controlled bad outputsの各種欠陥を検知し、正しいcontrolled outputsを誤拒否しない。
- 生徒カナリア混入、未認証成功、候補外引用の成功扱いは0。
- プロンプトへ評価用goldenが漏れない。秘密値を模した障害文字列もログ/出力へ漏れない。
- 同じfixture/version/設定でオフラインの判定と集計が同じになる（時刻や処理時間は分離）。
- 評価未実施・異常終了・空fixtureを合格として出力しない。

後続の実モデル受入基準案（今回計測しない）:
- 生徒混入、未認証成功、候補外/改変引用の成功扱い0。
- 必須根拠macro recall 90%以上、重要反証・比較の両時点取得は指定criticalケースで100%。
- 手動評価で重大な根拠なし断定・逆の結論0。その他の意味評価は採点rubricを先に定義。
- 完了率・遅延・コストは利用条件と予算が未確定のためpending。測定後に都合よく合格閾値を設定しない。
これらは評価設計上の目標値であり、実品質の保証や既達成値ではない。小規模の架空セットで合格しても全実生徒への一般化を宣言しない。

## 8. CLI・保存と将来の実評価

今回のCLIはオフラインのみ動作。引数なしでも外部API/実DBは呼ばず、環境変数に本番キーが存在しても使用しない。--live等は未対応として明確に拒否し、誤って有料処理を開始できない状態にする。

- 入出力パス、fixture schema version、評価器version、seed（使用時）、git SHA、modeを結果へ記録。
- 指定した出力ディレクトリにrunごとの新規結果を保存。既存runを黙って上書きしない。JSONと短いMarkdown summaryを用意。
- 中断/異常時はpartial/failedとし、正常完了と区別。
- exit codeは正常完了と技術失敗を区別。offlineの正常完了でも実品質承認にはしない。
- 手動レビュー用には合成質問・回答・必要な合成根拠を表示可能。本番データを読み込む汎用入口は今回作らない。
- GitHubにcommitするのは架空fixture・技術文書・合成結果のみ。run大量生成物は適切にignore。

T050_EVALUATION.mdに、将来の実評価開始前に決める事項を記載:
使用する架空/許可済みデータ、実行環境、モデルsnapshot、対象ケース・回数、料金の確認日と入力/出力単価、総token/費用上限、停止条件、手動レビュー担当・rubric。
費用上限は失敗呼出しも考慮し、未計測usageを無料とみなさない。今回はlive runnerの実装・資格情報設定・有料呼出しを行わない。

## 9. 変更禁止・報告

- 本番DB/Drive/OpenAI接続、migration、backfill、main merge、deploy、STUDENT_AI_ENABLED有効化は禁止。
- UIのT060/T070、T090以降へ拡張しない。
- ユーザー権限、既存認証、引用検証やbudget上限を緩めない。
- 正解データに合わせたcaseId条件分岐を本体に追加しない。
- 実AI精度未実施を理由にオフライン基盤まで未着手で返さない。
- 出た不具合の再現・修正・回帰を完了してからcommit/push。未解決の設計課題は具体的な失敗ケースと影響を報告。
- TASKS.mdのT050はcode/testsとlive quality pendingを分け、T040の承認を保持。

完了報告は docs/student-ai/reports/T050_IMPLEMENTATION_REPORT.md に保存:
1. Outcomeと未完了の実品質評価
2. 変更ファイル・実行コマンド・Node版・baseline/最終テスト
3. ケース数/カテゴリ、指標の定義、controlled bad outputsの検出結果
4. 発見した不具合・修正・残る検索制約
5. オフライン評価結果とsemantic quality未評価の明示
6. 将来の実AI評価の開始条件と未決事項
7. 検証対象の実装SHA、差分リンク、Workレビュー依頼

報告ファイル内には検証対象の実装SHAを記載。報告自体を含む最終remote SHAはpush確認後にチャットで伝える。完了したらT050で停止してWorkのレビューに回す。
