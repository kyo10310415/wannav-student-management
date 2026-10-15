# レッスン前日メール（Google Workspace / GAS）

既存のDiscord前日リマインドは変更せず継続する。メールは送信元Workspaceアカウントが所有する新規GASプロジェクトから送信する。SMS・AO列の読み取り・新規有料サービス・DB変更はない。

## 構成

- Renderの`GET /api/email-reminders/batch`をGAS専用Bearerキーで認証。メール連携が無効・未設定ならデータを返さない。ブラウザーへのキー配布やURLクエリへのキー埋め込みは禁止。
- 対象予約は既存Discordと同じ`fetchLessonsForTomorrow`を利用。本文も共通関数を利用し、メールではメンション・太字記号だけを付けない。件名は「【WannaV】明日のレッスンのご案内」。
- 予約シートのE列が日付のみの場合はJ列（lesson_time）の時刻を組み合わせる。E列が日時付きの場合はその時刻を優先する。どちらの形式も同じ日時なら同じ送信キーになる。不正日付・時刻不明のメールは推測で送らない。Discord本文にもJ列の時刻を反映する。
- GASが「❶RAW_生徒様情報」のB列（学籍番号）とAL列（38列目、メールアドレス）を一括で読み、学籍番号をtrim/大文字化して照合。宛先はAPIから受け取らずシートから取得する。空欄・不正な単一宛先・同一学籍番号で異なるアドレスがある場合は送らず件数を記録する。他人の宛先が見えるCC/BCC配信はしない。
- 送信元は`k.sakamoto@oneloopinc.net`。実行アカウントが異なる場合は停止。MailAppを使うためGmail受信箱の読み取りは不要。
- 本文・メールアドレス・APIキーをログ出力しない。APIはno-store、GASのUrlFetchはリダイレクト追従禁止。

## 設定手順（まだ自動送信を有効にしない）

1. マージ・Renderのデプロイ完了後、Renderの環境変数に以下を設定する。
   - `EMAIL_REMINDERS_ENABLED=true`
   - `GAS_EMAIL_REMINDER_API_KEY`：パスワードマネージャー等で生成した32文字以上のランダムな専用秘密値。既存の認証情報を使い回さず、チャット・Git・ログに貼らない。
   - このフラグをtrueにしてもGASのトリガーと有効化がなければメールは送られない。Discordの`DISCORD_REMINDERS_ENABLED`とは独立している。
2. 上記Workspaceアカウントで https://script.google.com/ を開き、**新規の独立プロジェクト**を作る。既存キャッシュGASに追記しない。
3. `docs/gas-lesson-email-reminders.gs`の全文を貼り付ける。プロジェクトのタイムゾーンはAsia/Tokyoとする。**ウェブアプリ公開は不要**。
4. プロジェクトの設定→スクリプトプロパティに以下を追加する。
   - `APP_BASE_URL` = `https://wannav-student-management.onrender.com`
   - `GAS_EMAIL_REMINDER_API_KEY` = Renderと同じ専用秘密値
   - `EMAIL_REMINDERS_ENABLED` = `false`
5. `checkLessonEmailSetup`を手動実行して、メール送信・Sheets読み取り・外部接続・アカウント確認を認可する。対象スプレッドシートへの読み取り権限が必要。ログに翌日の日付・予約件数・有効な宛先件数・送信残枠だけが出る。この関数はメールを送らない。
6. `sendLessonEmailTestToSelf`を明示的に実行し、送信元アカウントのみにテスト送信する。翌日の予約がない場合は停止する。実際の生徒向けメールは送らないが、テスト本文には先頭1件の生徒名・予約情報が含まれる。受信・From・本文を確認する。
7. 確認後、GASの`EMAIL_REMINDERS_ENABLED`を`true`にし、`installLessonEmailTrigger`を1回実行する。同じプロジェクトにこのトリガーがあれば重複作成しない。既存トリガーは削除しない。

## 実行・重複防止・障害対応

- 5分間隔のトリガーで、日本時間17:00以降20:00未満のみ送信する。Googleのトリガー時刻には揺らぎがあるため、Discordの17:00と秒単位では一致せず、通常は17時以降最初の実行になる。完了した日の後続実行はAPIを呼ばない。
- その時点の翌日予約を取得し、学籍番号＋日時のSHA-256を送信キーにする。同じ日時の同じ生徒の重複行は1件にまとめる。1生徒に異なる日時のレッスンがある場合は各レッスン1件。本文だけの変更では同じ予約を再送しない。予約日時が変わると別キーになる。
- ScriptLockで同時実行を防止し、送信前にスクリプトプロパティへ`sending`、成功時は`sent`、例外時は`uncertain`を保存する。送信済み/送信中/不明のキーは自動再送しない。送信中のクラッシュは到達不明として扱い、Gmail送信済み等を人が確認してから該当キーだけを操作する。全プロパティや完了日を一括削除しない。
- 残り日次枠がゼロなら送信せず17〜20時の後続実行で再確認する。1実行最大50件。送信枠は同じアカウントの他のGASと共有する。GASの実行制限などで途中終了した場合、未着手の予約のみ後続実行で再開する。
- 空欄/不正/重複連絡先はスキップする。`uncertain`または連絡先スキップがあっても、その日のバッチは完了扱いになることがあるためログの件数を確認する。修正後に個別対応する。20時を過ぎた未着手分の自動遡及送信はしない。
- 送信履歴のキーは35日分保持し、この機能の古いキーだけ削除する。プロジェクトの複製・別アカウントのトリガー作成・プロパティ消去は履歴を引き継がず重複の原因になるため行わない。
- 一時停止はGASの`EMAIL_REMINDERS_ENABLED=false`。Render側フラグでも取得を停止できる。いずれもDiscordリマインドを止めない。
- Google側の送信受付成功は受信箱への到達保証ではない。バウンス/迷惑メールを確認する。

## 検証と未検証

共通本文・学籍番号照合・B/AL列番号・翌日JST・予約重複・専用API認証・無効時・送信元チェック・不正/競合連絡先・残枠ゼロ・到達不明の重複防止・自分宛テスト・トリガー重複防止をモックで検証する。本番DB/予約データ/メールアドレスの取得、GAS認可・実行、実メール送信、Google Workspace管理者による制約、メール到達は未検証。認可・設定と自分宛テスト後に有効化する。

公式資料：
- https://developers.google.com/apps-script/reference/mail/mail-app
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/reference/script/clock-trigger-builder
