# minto ローカル検証環境セットアップ説明

## 目次

- [glt cloneでmintoをローカルセットアップ](#glt-clone-で-minto-をローカルセットアップ)
- [検証環境の説明](#検証環境の説明)
- [実際の検証環境実行方法＋利用方法を説明](#実際の検証環境実行方法利用方法を説明)
- [検証が終わったらAWS Lambdaにデプロイ対応を行います](#ローカル検証環境で検証が終わったらaws-lambda-にデプロイ対応を行います)

mintoは AWS Lambda 上の URL Function を利用しますが、この場合「非常に開発環境として適していない」と言えます。

その理由は「aws lambda に毎回ソースコードをアップロード or lambda のエディターで変更 + deploy」が必要だからです。

また「ログを見る ＝ cloud watch ＝ 見づらい」わけで、正直面倒だと言えます。

一方で「mintoではローカル環境での検証環境」が提供されており、これにより開発効率よい環境を提供します。

そのためここではローカル環境に検証用の環境を構築する説明を行います。

## glt clone で minto をローカルセットアップ

まず `ローカル環境` に対して `mintoの検証環境` を作成します。

これを作成する理由は「AWS Lambda上だと検証対応が非常に大変」だからです。

minto ではローカル環境で AWS Lambda 上での URL Function で利用する環境と同様の環境を提供しています。

これらを元にローカル環境で対象環境をセットアップする必要があります。

以下セットアップ方法を説明します。

~~~sh
cd {セットアップ元のディレクトリ}
git clone https://github.com/maachang/minto.git
~~~

仮に `セットアップ元のディレクトリ` を
- ${HOME}/project/

とします。

これにより
- ${HOME}/project/minto

のローカルディレクトリにセットアップされました。

次に以下の環境設定を行います。`bin/initMinto`を実行すると、利用しているシェル
(bash/zsh、Linux・macOS・WSL2に対応)の設定ファイルへ`MINTO_HOME`と`PATH`が
自動的に追記されます(再実行しても二重に追記されません)。

~~~sh
cd ${HOME}/project/minto
./bin/initMinto
~~~

表示された案内に従って`source {設定ファイル}`するか、ターミナルを再起動してください。

手動で設定したい場合は、以下の内容を `${HOME}/.bashrc` などに追記してください。

~~~sh
export MINTO_HOME=${HOME}/project/minto
export PATH=${MINTO_HOME}/bin:${PATH}
~~~

これによって `mintoコマンド` が利用可能となります。

コマンドの利用については [このリンク](https://github.com/maachang/minto/blob/main/bin/README.md) を参照にしてください。

以上で `minto のセットアップ` は完了しました。

## 検証環境の説明

次に `minto 検証環境の実際の利用方法` について説明したいと思います。

~~~
mintoによるWebアプリ実装ディレクトリ:
[current]
    +-- public: HTMLなどのWebコンテンツ配置先.
    |
    +-- lib: minto 対象の モジュールjs の配置先.
    |
    +-- validates: バリデーションスキーマ定義(AI定義等)の配置先.
    |
    +-- conf: minto 実行に対する conf ファイル(json) 配置先.
    |     |
    |     +-- env.local.json: ローカル環境で 環境変数定義が設定出来ます(ローカル専用).
    |     |
    |     +-- minto.json: ローカルminto定義(bindPortなど).
    |
    +-- package.json: modules/s3table(S3をデータストアとして使うモジュール群)が
          必要とする @aws-sdk/client-s3 をローカルインストールするためのもの.
~~~

まず検証環境を作成する「対象ディレクトリ」を作成し、その配下に上のディレクトリを作成して、検証環境を生成します。

また、このディレクトリ構成を作成するためのコマンド
- `mkmt`

このコマンドの利用方法は単純で
~~~sh
cd {mintoプロジェクトを作成するディレクトリ名}
> mkmt {mintoプロジェクト名}
> cd {mintoプロジェクト名}
> npm install
~~~

これで新しいmintoプロジェクトが作成されます(`package.json`が生成されるため、
`modules/s3table`を使う場合に備えて`npm install`で`@aws-sdk/client-s3`を
ローカルインストールしておくことを推奨します)。

あと、コマンドについて詳しくは [このURL](https://github.com/maachang/minto/tree/main/bin) の `README.md` を参照してください.

### publicディレクトリ

ここには「HTMLなどのWebコンテンツ配置先」および、minto対応の「動的コンテンツ」を配置します。

また 対象のURLの `カレントURL` に対して `/` が `public/` となります。

ここに以下のように `minto動的コンテンツ` を配置する事で、Webアプリ実装を行なう事ができます。

#### 動的コンテンツ説明

- *.mt.js: [json返却実装](https://github.com/maachang/minto/blob/main/docs/howto.md#⑦動的コンテンツjson返却-の実装説明)
- *.mt.html: [html返却実装](https://github.com/maachang/minto/blob/main/docs/howto.md#⑧jhtml-実装)

動的コンテンツ作成については上記のURLを参照してください。

#### 静的コンテンツ説明

public 以下に対して、静的コンテンツ(htmlファイルや jpeg ファイルなど)を配置する事ができます。

### libディレクトリ

ここには「publicディレクトリから動的コンテンツ」や 「libディレクトリ」から「$loadLib(`対象ライブラリファイル名`)」で利用されるライブラリを配置します。

ここでのライブラリの実装方法は基本的に通常の `commonjs` における利用と同様になります。

あと「mintoでの標準libの利用」として[ここの内容](https://github.com/maachang/minto/blob/main/lambda/src/lib/) に存在するライブラリが利用できます。

### validatesディレクトリ

ここにはAI（Claude Code / Antigravity等）で生成したバリデーション定義や、プロジェクト固有のバリデーションスキーマファイル（`validates/{name}.js`）を配置します。

`validate.js`（`modules/validate/validate.js`）と連携し、エンドポイントからスキーマをロードして入力値検証を行う際に利用します。

### confディレクトリ

ここでは「JSON定義情報」に対しての定義を行なうためのものです。

たとえば mimeタイプの追加定義を行いたい場合は
- /conf/mime.json

を設定することで、追加のmime設定を行なう事ができます。

また、URL Function 直通アクセスに対して IP アクセス制限（IP制限）を設定したい場合は
- /conf/ipLimit.json

を設定します。会社の VPN やオフィスの固定 IP / CIDR を許可リスト（`allow`）に設定することで、API Gateway や WAF を挟まない URL Function 直通運用であっても、会社の VPN 経由のみの「安全な社内限定アクセス」が簡単に実現できます（許可対象外の IP アクセスは 403 Forbidden になります。ローカル接続時は自動的に無効化されます）。

またそれ以外のJSON定義を行い、それらを
- $loadConf(`対象JSONファイル名`)

とすることで、定義内容を読み取る事ができます。

## 実際の検証環境実行方法＋利用方法を説明

これまでの通り「検証のための環境構築」を行う説明をしました。

これに対して「実際に検証環境を利用」するための「説明」をしたいと思います。

基本的に `minto 環境＝ aws lambda URL Function` を利用するわけで、ここで「データ保存等=S3」を利用するので検証環境に対して、対象AWS環境で利用するIAMのCredential(AccessKeyなど)を設定する必要があります。

ただしAccessKey/SecretKeyそのものは「センシティブな情報」なので、**プロジェクトディレクトリ内の`conf/env.local.json`に直接書かないこと**を推奨します(`.gitignore`対応を忘れると誤ってコミットされてしまう危険があるため)。代わりに、`~/.aws/credentials`(プロジェクトディレクトリ外にあり、通常gitの管理対象にはなりません)に定義したプロファイルを`AWS_PROFILE`で参照する方法を推奨します。

~/.aws/credentials
~~~ini
[testMinto]
aws_access_key_id = AKI*****************
aws_secret_access_key = ****************************************
~~~

conf/env.local.json
~~~json
{
    "AWS_PROFILE": "testMinto"
}
~~~

`AWS_PROFILE`という**プロファイル名自体はセンシティブな情報ではない**ため、`conf/env.local.json`に書いても問題ありません。実際のAccessKey/SecretKeyは`~/.aws/credentials`側にのみ存在し、プロジェクトディレクトリの外に置かれます。

どうしても環境変数で直接AccessKey/SecretKeyを渡したい場合は、以下のように`.gitignore`でコミット除外した起動スクリプトを使う方法もあります。

./minto
~~~sh
#!/bin/sh

# AWS IAM User=testMinto.
export AWS_ACCESS_KEY_ID=AKI*****************
export AWS_SECRET_ACCESS_KEY=****************************************

echo "** start Minto"
minto
~~~

そしてこの `./minto` を `.gitignore` でコミット除外にする事で credential の事故を防げます。

なお、S3を利用する検証において「実際のAWS環境のCredentialを用意したくない」場合は、実AWS S3の代わりにファイル/ディレクトリベースでローカル動作確認ができる `localAws` コマンドも利用できます。この場合はAWSクレデンシャルの設定自体が不要です。詳しくは [localAws.md](https://github.com/maachang/minto/blob/main/docs/localAws.md) を参照してください。

このように定義して実際に検証環境立ち上げ時には
~~~cmd
./minto
~~~

このように実行することで、対象の Credential が有効な検証環境が利用できます。

### ローカル実行用環境変数コンフィグ定義.
- `conf/env.local.json`

`mkmt`でプロジェクトを作成すると、以下の内容(`modules/s3table`・
`modules/sdk/sqsSdk.js`のローカル検証環境(`localAws`)向けの環境変数)が
デフォルトで生成されます。

~~~json
{
    "MINTO_LOCAL_S3_ENDPOINT": "http://localhost:9911",
    "MINTO_LOCAL_SQS_ENDPOINT": "http://localhost:9911"
}
~~~

`MINTO_LOCAL_S3_ENDPOINT`/`MINTO_LOCAL_SQS_ENDPOINT`が設定されている場合、
AWSクレデンシャルは自動的にダミー値が使われるため設定不要です。実際のAWS
S3/SQSを使う場合は、上記の通り`AWS_PROFILE`(または`AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY`)を追加してください。s3table関連
(`modules/s3table/s3sdk.js`・`s3Lock.js`・`s3MasterTable.js`・
`s3IndexTable.js`)を利用しない場合は`MINTO_LOCAL_S3_ENDPOINT`、
`sqsSdk.js`を利用しない場合は`MINTO_LOCAL_SQS_ENDPOINT`を、それぞれ
削除しても問題ありません。クレデンシャル解決の優先順位の詳細は
[localAws.md](https://github.com/maachang/minto/blob/main/docs/localAws.md#クレデンシャル解決の優先順位)を
参照してください。

AWS Lambda では環境変数が利用できますが、これを ローカルminto環境では、わざわざ環境変数定義をせずとも、この定義ファイルで環境変数定義が行えます.

### `conf/xxx.local.json`によるローカル専用の設定上書き

`env.json`(環境変数)に限らず、`conf/`配下の**任意の**設定ファイルについて、同名の`xxx.local.json`を用意すると、ローカル実行時(`minto`コマンド、および`tools/webapps.js`が上書きする`$loadConf`経由で読み込む全てのconfファイル)はそちらが優先して読み込まれ、無ければ`xxx.json`が使われます(`conf/minto.json`も同様に`conf/minto.local.json`で上書きできます)。

- `xxx.local.json`が存在する → そちらを使う(ローカル実行専用)
- 存在しない → `xxx.json`を使う

この`*.local.json`は`mtpk`のデプロイzipには**含まれません**(`tools/mtPack.js`が除外します)。そのため、実際にAWS Lambdaへデプロイされる`xxx.json`とは完全に切り離されており、ローカル検証用の値(ローカルAWSエンドポイント、テスト用バケット名など)を誤って本番設定に混入させる心配がありません。

`mkmt`が生成する`conf/env.local.json`はこの仕組みの一例で、他の`conf/session.json`・`conf/table/master.json`等の設定ファイルにも同様に`.local.json`を追加すれば、ローカル検証時だけ異なる値(S3バケット名など)を使うことができます。

#### `conf/xxx.test.json`によるテスト実行専用の設定上書き

さらに`conf/xxx.local.json`とは別に、`conf/xxx.test.json`という命名規則もサポートしています。これは**テスト実行時のみ**参照される設定で、`env.local.json`のようなローカル実行専用の設定とも区別されます。

- 環境変数`MINTO_TEST_MODE`(`"true"`または`"1"`)が設定されている場合を「テストモード」とみなす
- テストモード時: `xxx.test.json`が存在すればそちらを使う(**`xxx.local.json`は一切参照しない**)。無ければ`xxx.json`を使う
- テストモードでない場合: `xxx.test.json`は完全に無視される(`xxx.local.json`→`xxx.json`の通常の解決)

`MINTO_TEST_MODE`は`node --test`実行自体から自動判定されるものではなく、テストコード側が子プロセス起動時などに明示的に環境変数として設定する必要があります。`xxx.local.json`を無視する理由は、開発者個人のローカル設定(`conf/env.local.json`など)がテスト実行に紛れ込み、テスト結果が実行環境によって変わってしまう事故を防ぐためです。

この`*.test.json`も`*.local.json`と同様、`mtpk`のデプロイzipには含まれません。

#### 適用範囲

`*.local.json`・`*.test.json`は、以下のいずれの実行経路でも同じように優先解決されます。

- `minto`コマンド(`tools/webapps.js`が上書きする`$loadConf`)、および`tools/index.js`が起動時に読む`conf/minto.json`・`conf/env.json`
- `bin/tableTool`・`bin/localSqsPoller`のように、`tools/webapps.js`を経由せず`lambda/src/index.js`の`handler()`を直接呼び出すツール(`tools/lambdaOverrides.js`の`applyLoadConfLocalOverride`が、実行開始時に`global.$loadConf`を同様に上書きする)

`lambda/src/index.js`自体は、内部の`conf/table/*.json`・`mime.json`・`etags.json`読み込みも含め、常に公開済みの`global.$loadConf`(`_g.$loadConf`)経由で呼び出す作りになっているため、上記どちらの経路でも一貫して`.local.json`/`.test.json`が優先されます(`lambda/src/index.js`自体には`.local.json`/`.test.json`固有のロジックは一切追加しておらず、`_g.$loadConf`という既存の公開インターフェースを一貫して使うようにしただけです)。

例えば`bin/tableTool`実行時に`conf/table/master.test.json`を用意しておけば、`MINTO_TEST_MODE=true`指定時はそちらのテーブル定義が使われ、本番の`conf/table/master.json`には影響しません。

環境変数の定義方法としては
- {key: value, key: value ....}

このように行う事で環境変数の利用が可能となります(上記の`MINTO_LOCAL_S3_ENDPOINT`等以外にも、`SLACK_TOKEN`のような任意のキーを追加できます).

### mintoローカル実行用コンフィグ定義.
- `conf/minto.json`
~~~json
{
    "bindPort": 3210
}
~~~

ローカルminto環境でのコンフィグ定義が行えます.

また特定の指定がされていない場合は `bindPort=3210` が対象となるので
- http://127.0.0.1:3210/

でブラウザからアクセスする事で `./minto` コマンド実行に対する検証環境の利用を行なう事ができます。

### s3table のテーブル定義を管理する(tableTool コマンド)

`modules/s3table/s3MasterTable.js`・`s3IndexTable.js`を使う場合、テーブルの作成・削除・カラム変更・インデックス変更は`tableTool`コマンドで行います。

~~~sh
> cd {mintoプロジェクト名}
> tableTool -t <master|index> -c <createTable|dropTable|alterTable|alterIndex> [-n <テーブル名>]
~~~

事前に`conf/table/master.json`・`conf/table/index.json`へ「あるべきテーブル定義」を記載しておく必要があります。詳しくは[bin/README.md](https://github.com/maachang/minto/blob/main/bin/README.md#tabletool-%E3%82%B3%E3%83%9E%E3%83%B3%E3%83%89)を参照してください。

## ローカル検証環境で検証が終わったら「AWS Lambda にデプロイ対応」を行います

ローカル環境で検証した内容を 本番のAWS Lambda にデプロイする場合のコマンドは以下の通りです。
- mtpk

このコマンドを対象プロジェクトのカレントディレクトリで実行する事で `mtpack.zip` が作成され、これを当該 AWS Lambda にデプロイします。

また `mtpk` コマンドには[デプロイオプション](https://github.com/maachang/minto/blob/main/bin/README.md#mtpk-%E3%82%B3%E3%83%9E%E3%83%B3%E3%83%89)があるので、これらを踏まえて「デプロイzip」を作成します。

あと `検証環境=nodejs` の一方で、基本実行するランタイム= `llrt` なので「多少の互換性の問題」があるので、これらを含めての「実行テスト」が「AWS Lambda 上」で必要となるので、注意が必要です。

この互換性の問題を事前に検知するため、`mtpk` には `-c` または `--check` オプションが用意されています。これは `lambda/src`・`modules`・プロジェクトの`lib`/`public`以下を対象に、llrtで未サポートと確認済みのAPI(`crypto.pbkdf2`、`for await`構文など)が使われていないかを、pack化前にチェックするものです。問題が見つかった場合は zip 作成を中断します。詳細は[bin/README.md](https://github.com/maachang/minto/blob/main/bin/README.md#4-llrt互換性チェック)を参照してください。

~~~sh
> mtpk -c
もしくは
> mtpk --check
~~~

ただしこれは正規表現による簡易的なチェックであり、既知のNG項目のみを対象とした簡易検知に過ぎないため、これだけで安心せず、必ず実際の AWS Lambda 上での実行テストも行ってください。

またこれら「AWS Lambda 上での検証」においては
- jsMin: `mtpk -m or --min`

は無効でテストをする事をおすすめします（エラー箇所がわからないので）

ただ `jsのminimize` ことで実行速度も上がるようです。
- コールドスタート.
> Duration: 52.68 ms Billed Duration: 109 ms Memory Size: 128 MB Max Memory Used: 23 MB

- ウォームスタート.
> (１回目): Duration: 8.97 ms Billed Duration: 9 ms Memory Size: 128 MB Max Memory Used: 24 MB

> (２回目): Duration: 1.57 ms Billed Duration: 2 ms Memory Size: 128 MB Max Memory Used: 24 MB 

本番利用の場合は `jsのminimize` を有効にする事で速度アップが行えます。

あと、実際にローカル環境で作成した minto 環境を AWS Lambda でデプロイ実行する場合は
- https://github.com/maachang/minto/blob/main/docs/lambda.md

このドキュメントを参考にしてください。

## EOF

一旦ローカルセットアップについての説明は以上となります。

よろしければ
- howto: https://github.com/maachang/minto/blob/main/docs/howto.md

で、実際の利用方法を元にお試しをお願いいたします。
