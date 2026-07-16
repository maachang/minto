# ローカルS3エミュレータ(localS3)説明

## 目次

- [概要](#概要)
- [なぜ必要か](#なぜ必要か)
- [起動方法](#起動方法)
- [利用側(s3sdk.js/s3Lock.js)の設定](#利用側s3sdkjss3lockjsの設定)
- [対応しているS3操作](#対応しているs3操作)
- [注意点](#注意点)

## 概要

`localS3` は、`modules/s3table/s3sdk.js`・`modules/s3table/s3Lock.js`が利用する`@aws-sdk/client-s3`(S3Client)の接続先(endpoint)をローカルのHTTPサーバーに向けることで、実際のAWS S3へ接続せずにファイル/ディレクトリをバックエンドにしたローカル動作確認を行うためのコマンドです。

実装本体は [tools/localS3.js](https://github.com/maachang/minto/blob/main/tools/localS3.js) で、Node標準の`http`/`fs`モジュールのみを使い、本物のS3 REST APIの必要最小限を実装しています。SDK自体は本物の`@aws-sdk/client-s3`をそのまま使うため、ローカルで動作確認したコードは無改修で本番のAWS S3にもそのまま接続できます。

## なぜ必要か

[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md) で説明した通り、`minto`のローカル検証環境で S3 を利用する `modules/s3table/s3sdk.js`・`s3IndexTable.js`・`s3MasterTable.js`・`s3Lock.js`・`session.js` 等を使う場合、通常は実際のAWS環境のIAM Credential(AccessKey等)を設定する必要があります。

`localS3` を使うことで、AWS Credentialやネットワーク接続を用意せずに、ローカルのファイル/ディレクトリだけでこれらの動作確認ができます。

## 起動方法

`localS3` コマンドを実行します(`bin/`にPATHが通っている前提。[bin/README.md](https://github.com/maachang/minto/blob/main/bin/README.md)を参照)。

~~~sh
> localS3
もしくは
> localS3 -p {ポート番号} -d {ストレージ保存先ディレクトリ}
~~~

- `-p` / `--port`: バインドポート(デフォルト `9911`)
- `-d` / `--dir`: バケット内容を保存するローカルディレクトリ(デフォルト `./.localS3`)

起動すると、以下のようにログが出力されます。

~~~
[localS3] listening on http://localhost:9911 (storage root: /path/to/.localS3)
~~~

## 利用側(s3sdk.js/s3Lock.js)の設定

`mkmt`でプロジェクトを作成すると、`minto`コマンド実行時に読み込まれる
`conf/env.json` (詳細は[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md#ローカル実行用環境変数コンフィグ定義)を参照)に、以下の環境変数がデフォルトで設定されます(手動設定は不要です)。

~~~json
{
    "MINTO_LOCAL_S3_ENDPOINT": "http://localhost:9911"
}
~~~

- `MINTO_LOCAL_S3_ENDPOINT`: これが設定されている場合、`s3sdk.js`/`s3Lock.js`は実AWS S3ではなくこのURLへ接続します(`forcePathStyle: true`が自動的に付与されます)。
- AWSクレデンシャル(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)は、**設定不要**です。`MINTO_LOCAL_S3_ENDPOINT`が設定されており、かつ他に明示的なクレデンシャル指定(環境変数や呼び出し元の`options.credentials`)が無い場合、`s3sdk.js`/`s3Lock.js`側で自動的にダミークレデンシャルが使われます(`localS3`側では署名検証を行わないため実害はありません)。これにより、実際のAWSクレデンシャルを誤って`conf/env.json`(プロジェクトディレクトリ内、gitignore対応を忘れるとコミットされ得る場所)に書いてしまうリスクを避けられます。

この環境変数を設定しない場合は、通常通り実際のAWS S3に接続されます。本番のAWS Lambda環境にデプロイする際は、この環境変数を設定しない(または`conf/env.json`はローカル専用のためLambdaには含まれない)ことで、自動的に本番のAWS S3が使われます。実際のAWS環境に接続する場合のクレデンシャル設定方法は[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md#実際の検証環境実行方法＋利用方法を説明)を参照してください。

### クレデンシャル解決の優先順位

`s3sdk.js`/`s3Lock.js`は、以下の優先順位でクレデンシャルを解決します。

1. **`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`環境変数が設定されている場合**: `~/.aws/credentials`の有無に関わらず、その値をそのまま使います(最優先)。
2. **上記が無く、`MINTO_LOCAL_S3_ENDPOINT`も設定されていない場合**: AWS SDKの標準クレデンシャルプロバイダーチェーンに委ねます。`AWS_PROFILE`環境変数が設定されていれば`~/.aws/credentials`の該当プロファイル、無ければ`default`プロファイルやIAMロール等から解決されます。何も解決できない場合は、実際にS3へリクエストを送る際にエラーになります。
3. **上記が無く、`MINTO_LOCAL_S3_ENDPOINT`が設定されている場合**: 自動的にダミークレデンシャル(`accessKeyId: "local"`, `secretAccessKey: "local"`)が使われます(`localS3`は署名検証を行わないため実害はありません)。

つまり、環境変数によるクレデンシャル指定は`~/.aws/credentials`の存在有無より常に優先されます。

## 対応しているS3操作

- `PutObject`(条件付き書き込み`If-None-Match: *`含む。`s3Lock.js`の排他ロックで利用)
- `GetObject`
- `DeleteObject`
- `ListObjectsV2`(`prefix`/`delimiter`/`max-keys`/`continuation-token`/`start-after`)

上記以外(バージョニング、マルチパートアップロード、ACL、暗号化設定など)には対応していません。

## 注意点

- ローカル専用のため、SigV4署名検証は一切行いません。認証・認可のテストには使えません。
- `ListObjectsV2`の`continuation-token`は、本物のS3のような不透明なトークンではなく、内部的に「最後に返したキー」をそのまま利用する簡易実装です。ページング処理自体の動作確認は可能ですが、トークンの値そのものに意味を持たせた実装(値をパースする等)をしている場合は注意してください。
- `modules/sdk/dynamoDbSdk.js`・`sqsSdk.js`・`snsSdk.js`・`secretsManagerSdk.js`・`parameterStoreSdk.js`・`sesSdk.js`・`kmsSdk.js`など、S3以外のAWSサービスラッパーには対応していません(現状S3のみが対象です)。

## EOF
