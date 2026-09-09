# Phase 0 報告

更新: 方向性はユーザーレビュー済み。最新main `6b5f8c8` を同期しT015まで実装。以下は初回調査時点の報告であり、現在の依存関係・方式候補はTASKS/ARCHITECTURE/BACKFILL_PLAN、検証結果はBASELINEを正とする。T005未完了につきT010最終確定とT030/T090は保留。

## 結論

既存のDrive取得、minutes要約、OpenAI接続、DB、カードUIは再利用できる。ただし、全期間列挙機能とAI検索層はなく、minutes APIはサーバー側認証がない。MVPはPostgreSQLによる意図別候補検索から開始し、精度測定後にpgvector導入を判断する。

## 19項目の回答

1. 文字起こし取得: 親直下の学籍番号フォルダ→対象日/前日のDocs→文字起こしtab。
2. 議事録生成: 実施済みlesson→Drive→lesson master/前回記録/Tutor→OpenAI JSON→minutes UPSERT。
3. minutes: transcript、生成文、品質JSON、Tutor、Drive metadataを持ち、student+dateがunique。
4. UI: `public/app.js` のカード文字列描画。リンク群へのAIボタン＋modalが最小変更。
5. 認証: DB session/Bearer/7日。全体middlewareはなくminutes routeは未保護。
6. 再利用: driveService、minutesServiceのclient pattern、DB query、context、カード/modal。
7. 新規: auth middleware、検索/回答serviceとAPI、全期間inventory/backfill、UI、tests。
8. フォルダ数: 認証情報不足で計測待ち。
9. 文書総数: 同上。
10. 最古日: 同上。
11. 最新日: 同上。
12. 平均件数: 同上。
13. 平均文字数: 同上。
14. 推定費用: 件数/文字数/モデルの実測後に公式単価で算出。
15. 3案比較: `ARCHITECTURE.md` 参照。
16. 推奨: MVP PostgreSQL絞込、精度不足時pgvector。
17. 懸念: 未認証、他生徒混入、prompt injection、XSS、全文送信、コスト暴走、同日複数Docs。
18. Backfill: item state型、drive file ID冪等、10件開始、有限retry、段階gate。
19. タスク: `TASKS.md` 参照。次は実数inventoryとT015共通認証。

## レビューで決める事項

- MVPをPostgreSQL方式で開始してよいか。
- Drive/DB実測を行える安全な実行環境を用意できるか。
- 同日複数Docsを保持する必要があるか。
- backfill管理操作をadmin限定とするか。
- Phase 0承認後、T015からコード実装へ進んでよいか。
