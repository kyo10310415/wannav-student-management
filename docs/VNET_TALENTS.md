# 熱ボード向けタレント名簿連携

`VNET_TALENTS_READ_TOKEN` に32文字以上の専用ランダム値を設定する。熱ボードの `TALENT_SOURCE_TOKEN` に同じ値、`TALENT_SOURCE_URL` に本サービスのHTTPS URL + `/integrations/vnet/v1/talents` を設定する。秘密値はソース・チャットへ書かない。

`GET /integrations/vnet/v1/talents` のみ。Authorization: Bearer必須、専用トークン未設定503、不一致401、GET以外405。一般業務APIの認証を変更・迂回しない。
返すのはstatusが「アクティブ」の生徒のid（学籍識別ID）・name（character_name＝活動名、空欄は空欄のまま）・youtubeId・xId・status。氏名・メール・Discord ID・レッスン情報は返さない。
5000人を超えた場合は切り捨てず413。DB読込失敗は詳細を露出せず503。Cache-Control:no-store。固定SELECTのみで書込み・同期・通知・DBスキーマ変更なし。
熱ボード側が候補確定の直前にもこのAPIを読んでアクティブ状態を再検査する。

検証: `node --test tests/vnetTalents.test.js tests/apiAccess.test.js`（合成DB）。本番のトークン設定・データ読込・プッシュ・デプロイは未実施。
