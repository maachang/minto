# minto

**minto**（minimize to = [AWS Lambda関数URL実行を]最小化する）は、AWS LambdaのURL Function（関数URL）向けに、CJSで実装された「超軽量実行環境」です。

Node.jsの代替ランタイムである[llrt（Low Latency Runtime）](https://github.com/awslabs/llrt)での実行を前提とすることで、AWS Lambdaの最小メモリ環境（128MB）でも「コールドスタートで高速に動作する」ことを目指しています。

## 目次

- [特徴](#特徴)
- [性能実測（llrt + 128MB）](#性能実測llrt--128mb)
- [想定用途](#想定用途)
- [llrtの機能制限について](#llrtの機能制限について)
- [ドキュメント一覧](#ドキュメント一覧)

## 特徴

- **index.js 1ファイルでURL Functionが動く**: 機能は最低限のWebアプリ機能に絞られています
- **mt.js / jhtml の2種類の動的コンテンツ**: JSON返却用（mt.js）とHTML返却用（jhtml）のシンプルな実行環境を提供
- **S3をKVSとして利用**: RDBMSではなくS3を対象とした「KVS的」なデータ永続化を想定
- **128MBメモリでの安価な運用**: llrt採用によりAWS Lambdaの最小メモリ環境でも高速に動作
- **ローカル検証環境あり**: AWS Lambdaに毎回デプロイせずに、ローカルでURL Functionと同様の環境を検証可能（[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md)参照）

## 性能実測（llrt + 128MB）

以下の環境で、AWS Lambda + URL FunctionでS3からテキストを取得しJSONを返却するだけの処理を実行した結果です。

- アーキテクチャー: arm64
- メモリ: 128MB
- ランタイム: Amazon Linux 2023
- llrt（レイヤー）: llrt v0.7.0-beta（Commits on Feb 9, 2025）no-sdk（https://github.com/awslabs/llrt/releases）

実行ソース:
~~~js
const s3 = $loadLib("s3client.js");

exports.handler = async function () {
    let text = "";
    const s3cl = s3.create();
    text = await s3cl.getObject(
        { Bucket: "test-minto", Key: "test/hogehoge", resultType: "text" });
    return { "hoge": 100, "hogehoge": text }
}
~~~

| 実行環境 | 実行パターン | Billed Duration | Init Duration | Max Memory Used |
|---|---|---|---|---|
| llrt v0.7.0-beta no-sdk（fetch + AWS Signature V4） | コールドスタート | 158 ms | 53.69 ms | 24 MB |
| llrt v0.7.0-beta no-sdk（fetch + AWS Signature V4） | ウォームスタート | 15 ms | - | 24 MB |
| llrt v0.7.0-beta full（AWS-SDK-V3） | コールドスタート | 258 ms | 67.85 ms | 31 MB |
| Node.js v22（AWS-SDK-V3） | コールドスタート | 4802 ms | 156.66 ms | 97 MB |

- コールドスタートでも「AWS Lambdaとは思えないほど高速」（158 ms）に実行され、ウォームスタートではさらに高速（15 ms）です。
- AWS-SDK-V3を使うllrt full版でも258 msと、Node.js版（4802 ms）に比べれば十分高速なので、S3以外のAWSサービスを利用する場合はこちらでも実用的です。
- 比較用に計測したNode.js（v22, AWS-SDK-V3）でのコールドスタートは4802 ms・97 MBとなり、llrtランタイムの軽量さが際立つ結果となっています。

<details>
<summary>各実行結果の生ログ</summary>

AWS lambda URL Function実行結果（コールドスタート / no-sdk）:
> REPORT RequestId: 82c60798-6ea5-4f3d-befd-5957174db2c0 Duration: 103.77 ms Billed Duration: 158 ms Memory Size: 128 MB Max Memory Used: 24 MB Init Duration: 53.69 ms

実行結果:
~~~
hoge	100
hogehoge	"testHogehoge"
~~~

AWS lambda URL Function実行結果（ウォームスタート / no-sdk）:
> REPORT RequestId: a5465a5b-94d2-4b7e-badb-e21690211f9a Duration: 14.69 ms Billed Duration: 15 ms Memory Size: 128 MB Max Memory Used: 24 MB

AWS lambda URL Function実行結果（コールドスタート / llrt full, AWS-SDK-V3）:
> REPORT RequestId: 3851698e-8163-4f38-a9f6-3d943a064465 Duration: 190.13 ms Billed Duration: 258 ms Memory Size: 128 MB Max Memory Used: 31 MB Init Duration: 67.85 ms

AWS lambda URL Function実行結果（コールドスタート / Node.js v22, AWS-SDK-V3）:
> REPORT RequestId: 828f62d0-ddf7-4f81-81d6-b3bd777bfd72 Duration: 4801.02 ms Billed Duration: 4802 ms Memory Size: 128 MB Max Memory Used: 97 MB Init Duration: 156.66 ms

</details>

## 想定用途

mintoは「機能としては最低限」のWebアプリ機能しか実装しておらず、想定しているのは以下のような小～中規模用途です。

- 小規模の社内Webアプリの作成
- メモリ128MB（安価な実行環境）＋ S3 KVS（安価なデータベース環境）で完結する構成

RDBMSが必要な本格的なWebアプリや、大規模なデータ操作が必要な用途には向いていません。

## llrtの機能制限について

llrtはNode.jsライクに利用できますが、以下のような制限があります。

- Node.jsで不要と位置づけられた機能や非推奨（deprecate）の機能は、大体実装されていません
- そのため、既存のNode.js向けソースコードがAWS Lambda上のllrtでそのまま動くかどうかは、実際に動かしてみないとわからないのが実情です
- `https`などのモジュールは利用できませんが、代わりにNode.js標準の`fetch`が使えるため、httpClient機能はこれで対応可能です

なお、llrtは現在もベータ版（2025年12月時点）ですが、AWS Lambdaの関数URLは問題なく利用できています。

## ドキュメント一覧

興味を持ちましたら、以下のドキュメントをご覧いただき、利用していただければ幸いです。

- ローカル環境
  - [mintoをローカル環境セットアップ](https://github.com/maachang/minto/blob/main/docs/setup.md)
  - [mintoのローカル開発説明](https://github.com/maachang/minto/blob/main/docs/howto.md)
- Lambda生成・デプロイ
  - [mintoのローカル環境のAWS Lambdaデプロイ](https://github.com/maachang/minto/blob/main/docs/lambda.md)
- 開発・動作確認
  - [mintoのテスト環境](https://github.com/maachang/minto/blob/main/docs/testing.md)
- モジュール（S3データベース。書き込み頻度に応じて使い分ける）
  - [s3MasterTable.js（書き込み頻度が少なく読み込み頻度が多い用途向け）](https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md)
  - [s3IndexTable.js（書き込み頻度が多い用途向け）設計ドキュメント](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)

以上、ありがとうございました。
</content>
