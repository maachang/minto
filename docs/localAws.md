# ローカルAWSエミュレータ(localAws)説明

## 目次

- [概要](#概要)
- [なぜ必要か](#なぜ必要か)
- [起動方法](#起動方法)
- [S3機能](#s3機能)
  - [利用側(s3sdk.js/s3Lock.js)の設定](#利用側s3sdkjss3lockjsの設定)
  - [対応しているS3操作](#対応しているs3操作)
- [SQS機能](#sqs機能)
  - [利用側(sqsSdk.js)の設定](#利用側sqssdkjsの設定)
  - [対応しているSQS操作](#対応しているsqs操作)
  - [SQSトリガー(runSqs.mt.js)をローカルで再現する: localSqsPoller](#sqsトリガーrunsqsmtjsをローカルで再現するlocalsqspoller)
- [注意点](#注意点)

## 概要

`localAws` は、`modules/s3table/s3sdk.js`・`modules/s3table/s3Lock.js`が利用する`@aws-sdk/client-s3`(S3Client)、および`modules/sdk/sqsSdk.js`が利用する`@aws-sdk/client-sqs`(SQSClient)の接続先(endpoint)をローカルのHTTPサーバーに向けることで、実際のAWSへ接続せずにファイル/メモリをバックエンドにしたローカル動作確認を行うためのコマンドです。

実装本体は [tools/localAws.js](https://github.com/maachang/minto/blob/main/tools/localAws.js) で、Node標準の`http`/`fs`モジュールのみを使い、本物のS3 REST API・SQS(AWS JSON 1.0 protocol)の必要最小限を実装しています。SDK自体は本物の`@aws-sdk/client-s3`・`@aws-sdk/client-sqs`をそのまま使うため(S3側)、ローカルで動作確認したコードは無改修で本番のAWS環境にもそのまま接続できます。

同一のHTTPサーバー・同一ポートでS3・SQS両方を受け付けます(リクエストヘッダで種別を判定するため共存できます)。

## なぜ必要か

[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md) で説明した通り、`minto`のローカル検証環境で S3 を利用する `modules/s3table/s3sdk.js`・`s3IndexTable.js`・`s3MasterTable.js`・`s3Lock.js`・`session.js` 等を使う場合、通常は実際のAWS環境のIAM Credential(AccessKey等)を設定する必要があります。

`localAws` を使うことで、AWS Credentialやネットワーク接続を用意せずに、ローカルのファイル/メモリだけでこれらの動作確認ができます。

## 起動方法

`localAws` コマンドを実行します(`bin/`にPATHが通っている前提。[bin/README.md](https://github.com/maachang/minto/blob/main/bin/README.md)を参照)。

~~~sh
> localAws
もしくは
> localAws -p {ポート番号} -d {ストレージ保存先ディレクトリ}
~~~

- `-p` / `--port`: バインドポート(デフォルト `9911`)
- `-d` / `--dir`: バケット内容を保存するローカルディレクトリ(デフォルト `./.localS3`。S3のみが対象、SQSのキューはメモリ上のみで永続化されません)

起動すると、以下のようにログが出力されます。

~~~
[localAws] listening on http://localhost:9911 (storage root: /path/to/.localS3, S3+SQS emulator)
~~~

## S3機能

### 利用側(s3sdk.js/s3Lock.js)の設定

`mkmt`でプロジェクトを作成すると、`minto`コマンド実行時に読み込まれる
`conf/env.local.json` (詳細は[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md#ローカル実行用環境変数コンフィグ定義)を参照)に、以下の環境変数がデフォルトで設定されます(手動設定は不要です)。

~~~json
{
    "MINTO_LOCAL_S3_ENDPOINT": "http://localhost:9911"
}
~~~

- `MINTO_LOCAL_S3_ENDPOINT`: これが設定されている場合、`s3sdk.js`/`s3Lock.js`は実AWS S3ではなくこのURLへ接続します(`forcePathStyle: true`が自動的に付与されます)。
- AWSクレデンシャル(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)は、**設定不要**です。`MINTO_LOCAL_S3_ENDPOINT`が設定されており、かつ他に明示的なクレデンシャル指定(環境変数や呼び出し元の`options.credentials`)が無い場合、`s3sdk.js`/`s3Lock.js`側で自動的にダミークレデンシャルが使われます(`localAws`側では署名検証を行わないため実害はありません)。これにより、実際のAWSクレデンシャルを誤って`conf/env.local.json`(プロジェクトディレクトリ内、gitignore対応を忘れるとコミットされ得る場所)に書いてしまうリスクを避けられます。

この環境変数を設定しない場合は、通常通り実際のAWS S3に接続されます。本番のAWS Lambda環境にデプロイする際は、この環境変数を設定しない(または`conf/env.local.json`はmtpkのデプロイzipに含まれないためLambdaには含まれない)ことで、自動的に本番のAWS S3が使われます。実際のAWS環境に接続する場合のクレデンシャル設定方法は[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md#実際の検証環境実行方法＋利用方法を説明)を参照してください。

#### クレデンシャル解決の優先順位

`s3sdk.js`/`s3Lock.js`は、以下の優先順位でクレデンシャルを解決します。

1. **`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`環境変数が設定されている場合**: `~/.aws/credentials`の有無に関わらず、その値をそのまま使います(最優先)。
2. **上記が無く、`MINTO_LOCAL_S3_ENDPOINT`も設定されていない場合**: AWS SDKの標準クレデンシャルプロバイダーチェーンに委ねます。`AWS_PROFILE`環境変数が設定されていれば`~/.aws/credentials`の該当プロファイル、無ければ`default`プロファイルやIAMロール等から解決されます。何も解決できない場合は、実際にS3へリクエストを送る際にエラーになります。
3. **上記が無く、`MINTO_LOCAL_S3_ENDPOINT`が設定されている場合**: 自動的にダミークレデンシャル(`accessKeyId: "local"`, `secretAccessKey: "local"`)が使われます(`localAws`は署名検証を行わないため実害はありません)。

つまり、環境変数によるクレデンシャル指定は`~/.aws/credentials`の存在有無より常に優先されます。

### 対応しているS3操作

- `PutObject`(条件付き書き込み`If-None-Match: *`含む。`s3Lock.js`の排他ロックで利用)
- `GetObject`
- `DeleteObject`
- `ListObjectsV2`(`prefix`/`delimiter`/`max-keys`/`continuation-token`/`start-after`)

上記以外(バージョニング、マルチパートアップロード、ACL、暗号化設定など)には対応していません。

## SQS機能

### 利用側(sqsSdk.js)の設定

`modules/sdk/sqsSdk.js`は、`s3sdk.js`と同様に環境変数`MINTO_LOCAL_SQS_ENDPOINT`が設定されている場合、実AWS SQSではなくこのURLへ接続します。

~~~json
{
    "MINTO_LOCAL_SQS_ENDPOINT": "http://localhost:9911"
}
~~~

クレデンシャルの解決順位・ダミークレデンシャルの扱いはS3側(`s3sdk.js`)と同様です。

`mkmt`で作成したプロジェクトの`conf/env.local.json`には、`MINTO_LOCAL_S3_ENDPOINT`と併せてデフォルトで含まれています。`sqsSdk.js`を利用しない場合は削除しても問題ありません。

### 対応しているSQS操作

AWS JSON 1.0 protocol(`x-amz-target`ヘッダで判定)による、以下の最低限の操作のみに対応しています。

- `SendMessage`(`DelaySeconds`のみ対応。`MessageGroupId`/`MessageDeduplicationId`等FIFOキュー固有のオプションは無視されます)
- `ReceiveMessage`(`MaxNumberOfMessages`/`VisibilityTimeout`に対応。`WaitTimeSeconds`によるロングポーリング待機は行わず即時応答します)
- `DeleteMessage`

キューは`QueueUrl`の末尾セグメントをキュー名として、プロセスのメモリ上でのみ管理されます(`localAws`プロセスを終了すると内容は失われます)。

### SQSトリガー(runSqs.mt.js)をローカルで再現する: localSqsPoller

実際のAWSでは、SQS自身がLambdaへメッセージをpushするのではなく、Lambdaのイベントソースマッピングがキューをポーリングして`handler(event)`を呼び出す仕組みになっています。[tools/localSqsPoller.js](https://github.com/maachang/minto/blob/main/tools/localSqsPoller.js)(`localSqsPoller`コマンド)は、この挙動をローカルで再現するためのツールです。

`localAws`のSQS機能に対してポーリングを行い、受信したメッセージ群を`event.Records = [{ body: "..." }, ...]`の形にまとめて`lambda/src/index.js`の`handler()`を直接呼び出します(`public/runSqs.mt.js`が実行されます。詳細は[howto.md](https://github.com/maachang/minto/blob/main/docs/howto.md#5-runsqsmtjs)を参照)。

~~~sh
> localAws
別ターミナルで
> localSqsPoller -q {キュー名}
~~~

- `-e` / `--endpoint`: `localAws`のURL(デフォルト `http://127.0.0.1:9911`)
- `-q` / `--queue`: ポーリング対象のキュー名(必須)
- `-i` / `--interval`: メッセージが無かった場合の次回ポーリングまでの待機時間(ms、デフォルト `2000`)
- `-w` / `--wait`: `ReceiveMessage`の`WaitTimeSeconds`(デフォルト `0`。`localAws`は即時応答するためロングポーリングの効果はありません)
- `-b` / `--batchSize`: 1回のポーリングで受信する最大件数(デフォルト `10`、上限 `10`)

`handler()`呼び出しが例外を投げずに正常終了した場合、実AWSのデフォルト動作(`ReportBatchItemFailures`未使用時、呼び出しが正常終了すればバッチ全体を削除)に合わせて、受信した全メッセージを削除します。`Ctrl+C`(SIGINT/SIGTERM)で停止します。

## 注意点

- ローカル専用のため、SigV4署名検証は一切行いません。認証・認可のテストには使えません。
- `ListObjectsV2`の`continuation-token`は、本物のS3のような不透明なトークンではなく、内部的に「最後に返したキー」をそのまま利用する簡易実装です。ページング処理自体の動作確認は可能ですが、トークンの値そのものに意味を持たせた実装(値をパースする等)をしている場合は注意してください。
- SQSのキューはメモリ上のみで管理され、永続化されません(`localAws`プロセスを再起動すると内容は失われます)。またFIFOキュー固有の機能(順序保証、重複排除)には対応していません。
- `modules/sdk/dynamoDbSdk.js`・`snsSdk.js`・`secretsManagerSdk.js`・`parameterStoreSdk.js`・`sesSdk.js`・`kmsSdk.js`など、S3・SQS以外のAWSサービスラッパーには対応していません。

## EOF
