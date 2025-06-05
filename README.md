# minto

## 概要

mintoとは(minimize to=最小化する)を目指す、AWS Lambda での URL Function(関数URL)での「超軽量実行環境」をcjsで作るためのプロジェクトです。

またminto では llrt(Low Latency Runtime) のnodejs の代替えランタイムを利用して実行することを「前提」としたものです。
- llrt: https://github.com/awslabs/llrt

あと llrtランタイムを利用前提とする事で、AWS Lambda の最小環境＝メモリ128mb で「コールドスタートで高速に動作」させる事を目指します。

## minto+llrt+128mb の URL Function 実行結果を説明.

実際に以下の環境でAWS Lambda + URL Function で実行した結果です.
- アーキテクチャー: arm64
- メモリ: 128mb
- ランタイム: Amazon Linux 2023
- llrt(レイヤー): llrt v0.5.1-beta no-sdk(https://github.com/awslabs/llrt/releases)

- AWS lambda URL Function実行結果(コールドスタート)
  > REPORT RequestId: 82c60798-6ea5-4f3d-befd-5957174db2c0 Duration: 103.77 ms Billed Duration: 158 ms Memory Size: 128 MB Max Memory Used: 24 MB Init Duration: 53.69 ms

実行ソース:
~~~js
const s3 = $loadLib("s3client.js");

exports.handler = async function () {
    let text = "";
    const s3cl = s3.create();
    text = await s3cl.getObject({ Bucket: "test-minto", Key: "test/hogehoge" });
    return { "hoge": 100, "hogehoge": text }
}
~~~

実行結果:
~~~
hoge	100
hogehoge	"testHogehoge"
~~~

内容としては
1. S3からテキスト情報を取得
2. JSON結果を返却している

だけの処理ですが、これの「コールドスタート実行」の結果が
- Duration: 103.77 ms
- Used: 24 MB

こんな感じで「コールドスタート」に対しての速度が「aws lambda と思えないほど高速に実行」されます。

また「ウォームスタート」では「以下」のような実行結果となります。

- AWS lambda URL Function実行結果(ウォームスタート)
  > REPORT RequestId: a5465a5b-94d2-4b7e-badb-e21690211f9a Duration: 14.69 ms Billed Duration: 15 ms Memory Size: 128 MB Max Memory Used: 24 MB 

  - Duration: 14.69 ms
  - Used: 24 MB

このように「かなり高速で実行」されます。

ただし、今回の環境は
- AWS Signature V4
- fetch(https)でS3Client実装

で実施されてるのですが、これを
- llrt v0.5.1-beta full(AWS-SDK-V3 Full)

使った環境で同じくS3Client(AWS-SDK-V3)を使った場合の「コールドスタート実行結果」は以下のものとなります。

> REPORT RequestId: 3851698e-8163-4f38-a9f6-3d943a064465 Duration: 190.13 ms Billed Duration: 258 ms Memory Size: 128 MB Max Memory Used: 31 MB Init Duration: 67.85 ms

- Duration: 190.13 ms
- Used: 31 MB

これでも「全然速い」ので、AWSのS3以外の他のサービスを利用する場合は、こちらでも問題ないかと思います。

なお、上のAWS-SDK-V3環境を node-js(v22) で「コールドスタート」で実行した場合は「以下」のようになります。

> REPORT RequestId: 828f62d0-ddf7-4f81-81d6-b3bd777bfd72 Duration: 4801.02 ms Billed Duration: 4802 ms Memory Size: 128 MB Max Memory Used: 97 MB Init Duration: 156.66 ms

- Duration: 4802 ms
- Memory Used: 97 MB

正に llrtランタイムがかなり軽量で実行されることがよくわかります。

## mintoの機能と利用想定

正直言えば「minto=index.js １つのファイルがあれば、URL Function の実行対応ができる」レベルのもので「機能としては、最低限」レベルのWebアプリ機能しか実装されていないです。

一応
- mt.js
- jhtml

この２つの動的実行環境が利用できるので、これらを使って「最低限のWebアプリ」が利用できます。

また「通常だとWebアプリ＝RDBMSなどのデータベースが必要」ではありますが、mintoでは「S3」が対象となるので「KVS」的なデータベース対応しかできないものとなっています。

minto の想定としては「小規模の社内Webアプリの作成」ぐらいを想定しており、更に「memory 128MB＝安価な環境＋S3KVS＝安価なデータベース環境」で利用できる事を想定しています。

## llrtの制限

llrtは nodejs ライクな利用がAWS Lambda において利用できますが、制限と言うか「AWS Lambda に不要な機能や非推奨な機能が利用できない」などの問題があります。

ただ「現在もベータ版(2025/05時点)」ですが、一旦は AWS Lambda の 関数URLが利用できる」など「他にもクセ」がありますが、一応利用できる形です。

また細かい部分で nodejs だと動くけど llrt だとエラーになるとかの「微妙なコード実装結果」もあるわけで、それがたとえば以下

~~~js
const crypto = require('crypto');
const key = "hoge";
const mode = undefined;
const res = crypto.createHash('sha256').update(key)ret.digest(mode);
~~~

- nodejs=ok
- llrt=error

エラー原因は `digest(mode)` の mode=undefined だと llrt だとエラーになってしまうが、一方の nodejs だとmode指定なしとして正常実行となります。

ただ「全体的に AWS Lambda で利用するにおいては、かなりご完成が高い」とも言えるので、あんまり問題にならないかと思いました。

興味を持ちましたら、以下ドキュメント内容を見ていただき、利用していただければ幸いです。

- セットアップ: https://github.com/maachang/minto/blob/main/docs/setup.md
- Howto: https://github.com/maachang/minto/blob/main/docs/howto.md
- lambda デプロイ: https://github.com/maachang/minto/blob/main/docs/lambda.md

以上ありがとうございました。
