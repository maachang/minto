# mintoドキュメント

- ローカル環境:
  - mintoをローカル環境セットアップ: https://github.com/maachang/minto/blob/main/docs/setup.md
  - mintoのローカル開発説明: https://github.com/maachang/minto/blob/main/docs/howto.md
  - ローカルAWSエミュレータ(localAws、S3+SQS)説明: https://github.com/maachang/minto/blob/main/docs/localAws.md

- Lambda生成 デプロイ
  - mintoのローカル環境の AWS Lambda デプロイ: https://github.com/maachang/minto/blob/main/docs/lambda.md

- 開発・動作確認
  - mintoのテスト環境: https://github.com/maachang/minto/blob/main/docs/testing.md

- モジュール（S3データベース・認証・ログ・ヘルパー）
  - モジュール一覧と利用方法: https://github.com/maachang/minto/blob/main/modules/README.md
  - s3MasterTable.js（書き込み頻度が少なく読み込み頻度が多い用途向け）: https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md
  - s3IndexTable.js（書き込み頻度が多い用途向け）設計ドキュメント: https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md
  - s3tableモジュール詳細 (s3sdk / s3presign / paginate / s3Lock / seqId): https://github.com/maachang/minto/blob/main/modules/s3table/README.md
  - 構造化ログ & 一元化エラー通知 ($log / $notifyError / sendSlack): https://github.com/maachang/minto/blob/main/modules/notification/README.md
  - ロールベース認可 (RBAC / routeGuard): https://github.com/maachang/minto/blob/main/modules/auth/README.md
  - 汎用ユーティリティ (dateEx.js 日付拡張・フォーマット・期間判定): https://github.com/maachang/minto/blob/main/modules/util/README.md

- 認証（GoogleWorkspace企業の社内Webアプリ向け）
  - GASを使った擬似SSOログイン: https://github.com/maachang/minto/blob/main/docs/gasAuth.md
  - session.js（S3ベースセッション管理、Cookie連携・1実行毎キャッシュ）: https://github.com/maachang/minto/blob/main/docs/session.md
  - 動作するサンプル一式: https://github.com/maachang/minto/blob/main/sample/gas-oauth-login/README.md

- テーブル管理コマンド
  - createTable/dropTable/alterTable/alterIndex（`bin/tableTool`）: https://github.com/maachang/minto/blob/main/bin/README.md

- メモ・補足資料
  - s3IndexTable.jsのS3 I/Oコスト試算: https://github.com/maachang/minto/blob/main/docs/memo/s3IndexTable-cost-estimate.md
