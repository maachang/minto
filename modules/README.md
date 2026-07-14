# mintoモジュール

## このディレクトリ以下で定義されているモジュール

- `no-sdk`: llrt-lambda-{cpu名}-no-sdk.zip を利用する場合の aws-sdk(AWS Signature(version4)) を利用する場合のライブラリ群.
- `sdk`:  llrt-lambda-{cpu名}-full-sdk.zip を利用する場合の aws-sdk-V3を利用するライブラリ群.
  - `s3sdk.js`: 最低限のS3 put/get/delete/list操作.
  - `s3MasterTable.js`: テーブル全体を1つのJSONとしてS3に保存するRDBMSライクなデータベース。**書き込み頻度が少なく、読み込み頻度が多い**用途向け。詳細は[docs/s3MasterTable.md](https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md)を参照.
  - `s3IndexTable.js`: 1行=1ファイルでS3に保存する行ファイル型データベース。**書き込み頻度が多い**用途向け(書き込み競合が起きにくい代わりに、検索は事前定義したインデックス経由のみ・複合インデックスは先頭カラムのみ範囲検索可、という制約がある。1テーブル1万件程度の小規模利用を想定)。詳細は[docs/s3-row-store-design.md](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)を参照.
  - `dynamoDbSdk.js`: Amazon DynamoDBのDocument Client相当(marshall/unmarshall)ラッパー。put/get/delete/update(patchのSETのみ)/queryの最低限の操作を提供.
  - `sqsSdk.js`: Amazon SQSの送受信ラッパー。send/receive/deleteの最低限の操作を提供(バッチ操作は非対応).
  - `snsSdk.js`: Amazon SNSの通知送信ラッパー。既存トピックへのpublishのみ提供(トピック作成・購読管理は対象外).
  - `secretsManagerSdk.js`: AWS Secrets Managerの取得ラッパー。getのみ提供、TTL付きメモリキャッシュ(デフォルト60秒)を内蔵.
  - `parameterStoreSdk.js`: AWS Systems Manager Parameter Storeの取得ラッパー。getのみ提供、TTL付きメモリキャッシュ(デフォルト60秒)を内蔵.
  - `sesSdk.js`: Amazon SESのメール送信ラッパー。sendのみ提供(text/html本文のシンプル送信、添付ファイル非対応).
  - `kmsSdk.js`: AWS KMSのエンベロープ暗号化ラッパー。encrypt/decryptを提供。ローカルのAES-256-GCM暗号化にはllrtの制約上crypto.subtle(WebCrypto)を使用.
- `notification`: よく使う slack通知やgithubリポジトリのissue作成を行うライブラリ群.
- `csv`: CSVファイルのパーサーやCSVエクスポート系ライブラリ、メモリーテーブル機能.
- `auth`: パスワードハッシュ化、S3ベースのセッション管理、CORS共通ヘルパーなど認証まわりのライブラリ群(`sdk/s3sdk.js`に依存).

## 利用方法(実装方法)

~~~js
const sendSlack = $loadLib("sendSlack.js");
~~~

利用対象のライブラリの呼び出しは上のように行う事で利用ができる。

一方で `$loadLib` 関数 が内部で本来以下のディレクトリ構成になっている

~~~
- modules
   |
   +-- notification
         |
         +-- sendSlack.js
~~~

内容に対して、検索して利用できるようになっている。

## 利用方法(AWS Lambda環境デプロイ)

一方で AWS Lambda環境で利用する場合は
- mtpk コマンド

これを利用する必要がある。

<モジュール名を指定してpack化する場合>
~~~sh
> mtpk -t {module名} -t {module名} ...
もしくは
> mtpk --target {module名} --target {module名} ...
~~~

ここでのモジュール名 とは `no-sdk` などの modulesディレクトリ以下にあるディレクトリ名を指す。

次に全てのモジュールを pack化したい場合は
~~~sh
> mtpk -t all
もしくは
> mtpk --target all
~~~

これで全てのモジュール群が利用可能となります。

## 注意点

モジュールに存在するファイル名と mintoプロジェクトでの `libディレクトリ` 以下の js ライブラリで、同一名が存在する場合
- `libディレクトリ`

これが優先されて、上書きされてしますので注意が必要です.

