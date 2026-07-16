# mintoドキュメント

- ローカル環境:
  - mintoをローカル環境セットアップ: https://github.com/maachang/minto/blob/main/docs/setup.md
  - mintoのローカル開発説明: https://github.com/maachang/minto/blob/main/docs/howto.md
  - ローカルS3エミュレータ(localS3)説明: https://github.com/maachang/minto/blob/main/docs/localS3.md

- Lambda生成 デプロイ
  - mintoのローカル環境の AWS Lambda デプロイ: https://github.com/maachang/minto/blob/main/docs/lambda.md

- 開発・動作確認
  - mintoのテスト環境: https://github.com/maachang/minto/blob/main/docs/testing.md

- モジュール（S3データベース。書き込み頻度に応じて使い分ける）
  - s3MasterTable.js（書き込み頻度が少なく読み込み頻度が多い用途向け）: https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md
  - s3IndexTable.js（書き込み頻度が多い用途向け）設計ドキュメント: https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md

- テーブル管理コマンド
  - createTable/dropTable/alterTable/alterIndex（`bin/tableTool`）: https://github.com/maachang/minto/blob/main/bin/README.md