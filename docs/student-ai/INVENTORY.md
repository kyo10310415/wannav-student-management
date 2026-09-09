# T005 読み取り専用inventory

## 現在の状態

CLIとunit testを実装済み。実測は未完了。現環境で実行すると `GOOGLE_CREDENTIALS_JSON_UNSET` / `DATABASE_URL_UNSET`、reconciliation=unmeasured、status=incompleteを返す。0件と未測定を混同しない。

T017 remote commit: `5c922e5d221f8ae6a069c7764268c9a5e13be11a`。
T017で全minutes routeを認証保護し、Node22.23.2で62/62テスト成功。inventory追加後は78/78成功（同Node22）。

## 実行方法

GoogleとDBの既存認証が安全に設定された環境で、Node22を利用する。秘密情報はチャットやGitHubへ貼らない。DBはSELECT専用アカウントを推奨。Google scopeはdrive.readonly/documents.readonly。

```bash
node -v
node scripts/student-ai-inventory.js
node scripts/student-ai-inventory.js --text-limit=all
```

既定は全フォルダ/全Docs metadataと、最大50文書の文字数計測。`all` は全文書の文字数計測。`--text-limit=0` は本文取得を省略する。出力はstdoutのJSON。原文・Google credentials・DB接続文字列は出力しない。出力に学籍番号・文書ID・未認識フォルダ名は含むため、集計結果を公開GitHubへそのままcommitしない。

## 取得指標と定義

| 分類 | 指標 |
|---|---|
| Drive構造 | folderCount、studentFolderCount、totalDocs、perStudent、lessonsPerStudentの平均/最大 |
| Drive日付 | oldestFileDate/newestFileDate（ファイル名のYYYY/MM/DDまたはYYYY-MM-DD、UTC変換で日をずらさない）、dateMissingCount |
| Drive異常 | unrecognizedFolders、duplicateStudentFolders、similarStudentFolders、similarIdPairs、multiFolderDocs |
| Drive重複 | sameDayMultipleDocs（生徒＋ファイル名日付、2件以上のグループとID。削除対象とは断定しない） |
| 文字量 | characters: count/total/mean/median/p95/max、attempted/population/fullPopulation、fallbackCount |
| DB | totalMinutes、perStudent、withDriveId/withoutDriveId、missingLessonNumber |
| DB重複/孤立 | duplicateDriveIds、sameDaySources、unknownStudentIds |
| DB文字量 | generatedCharacters/transcriptCharactersの総量等、perStudentCharacters |
| 照合 | matchedDriveDocs、notImportedByFileId、sameDaySourceCandidates、conflictingStudentAssignments、unknownStudentIds |

学籍番号認識は例示形式 `OL[A-Z]{2}数字6桁-英数字2桁` の完全一致。別形式は削除/無視せずunrecognizedFoldersに残す。類似判定は大小文字・空白・接尾文字による候補と、認識IDの編集距離1以内。似ているIDを自動的に同一人物扱いしない。同じ文書が異なる生徒フォルダにある場合はstudentIdを未確定とし、multiFolderDocsに残す。

文字数はUnicodeコードポイント数（DB CHAR_LENGTHに対応）。サンプルはファイルID順に均等抽出し、無作為標本ではない。fullPopulation=falseの平均/中央値/p95はサンプル値。p95はnearest-rank。文字起こしタブがない場合の既存末尾タブ/本文fallbackを再利用し、fallbackCountで区別する。その文字数を厳密な文字起こし量とは断定しない。ファイル名日付欠損はcreatedTimeをレッスン日へ代用しない。

## 総数の読み方

`総Drive Docs = minutesとfile ID一致 + file ID未一致`。
`既存minutes = drive_file_idあり + なし`。

未一致には、IDが記録されていないだけで既に取り込まれた文書が含まれ得る。同日候補を確認する。重複候補と情報欠損は別軸で重なるため、すべてを足して総数にしない。DBの1生徒あたり件数にはstudentsの0件生徒も含め、orphan IDも候補として加える。Drive集計は認識済みIDのみで、母数はDBと同一とは限らない。

## 読み取り専用の保証範囲

- DBはREPEATABLE READ / READ ONLY transaction、SELECTでmetadataとCHAR_LENGTHだけ取得しROLLBACK。statement timeout 30秒。
- Googleはfiles.list/documents.getのみ。親直下フォルダの1階層を全pageTokenで列挙。共有Drive対応flagsあり。
- INSERT/UPDATE/DELETE、migration、OpenAI生成、cron、HTTPサーバー起動なし。
- 取得失敗は件数を0とせずpartial/incompleteを出す。自動retryなし。429/権限エラー時は待機・権限確認後に手動再実行。
- DriveはAPI間のsnapshotが保証されないため実行中の追加/移動は次回照合。DBは読取snapshot。
- 独立したinventoryでありバックフィル本実装ではない。大量metadataはメモリに保持するため実測で上限・実行時間も確認する。

## T010への引継ぎ

件数・文字量はこのinventoryで計測可能。正確なtoken量は採用候補tokenizerでの別計測が必要（文字数から確定換算しない）。検索精度・回答遅延・AI API費用は本inventoryから得られない。これらの実測は、匿名化した正解セットと評価手順をT010で設計し、生成禁止のinventoryとは分離する。

実測前の最終推奨は未確定。A（PostgreSQL）は既存親和性と複製の少なさ、B（Vector Store）は外部同期/削除/保存費用、C（pgvector）はembedding・索引運用費用を比較する。まず生徒別最大文字量が二段階検索の予算内か、階層化が必要か、重要レッスン再現率が満たせるかを確認する。T005未完了のままT010を最終確定せず、T030/T090へ進まない。
