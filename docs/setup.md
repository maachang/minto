# minto ローカル環境セットアップ説明

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

次に以下の環境設定を行います。

~~~sh
export MINTO_HOME=${HOME}/project/minto
export PATH=${MINTO_HOME}/bin:${PATH}
~~~

これらを `${home}/.bashrc` などに設定します。

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
    +-- conf: minto 実行に対する conf ファイル(json) 配置先.
~~~

まず検証環境を作成する「対象ディレクトリ」を作成し、その配下に上のディレクトリを作成して、検証環境を生成します。

### publicディレクトリ

ここには「HTMLなどのWebコンテンツ配置先」および、minto対応の「動的コンテンツ」を配置します。

また 対象のURLの `カレントURL` に対して `/` が `public/` となります。

ここに以下のように `minto動的コンテンツ` を配置する事で、Webアプリ実装を行なう事ができます。

#### 動的コンテンツ説明

- *.mt.js: [json返却実装](https://github.com/maachang/minto/blob/main/docs/mint-js.md)
- *.mt.html: [html返却実装](https://github.com/maachang/minto/blob/main/docs/jhtml-js.md)

動的コンテンツ作成については上記のURLを参照してください。

#### 静的コンテンツ説明

public 以下に対して、静的コンテンツ(htmlファイルや jpeg ファイルなど)を配置する事ができます。

## libディレクトリ

ここには「publicディレクトリから動的コンテンツ」や 「libディレクトリ」から「$loadLib(`対象ライブラリファイル名`)」で利用されるライブラリを配置します。

ここでのライブラリの実装方法は基本的に通常の `commonjs` における利用と同様になります。

あと「mintoでの標準libの利用」として[ここの内容](https://github.com/maachang/minto/blob/main/lambda/src/lib/) に存在するライブラリが利用できます。

## confディレクトリ

ここでは「JSON定義情報」に対しての定義を行なうためのものです。

たとえば mimeタイプの追加定義を行いたい場合は
- /conf/mime.json

を設定することで、追加のmime設定を行なう事ができます。

またそれ以外のJSON定義を行い、それらを
- $loadConf(`対象JSONファイル名`)

とすることで、定義内容を読み取る事ができます。

## 実際の検証環境実行方法＋利用方法を説明

これまでの通り「検証のための環境構築」を行う説明をしました。

これに対して「実際に検証環境を利用」するための「説明」をしたいと思います。

基本的に `minto 環境＝ aws lambda URL Function` を利用するわけで、ここで「データ保存等=S3」を利用するので検証環境に対して、対象AWS環境で利用するIAMのCredential(AccessKeyなど)を設定する必要があります。

ただこれを「利用する＝センシティブな情報扱い」なので、たとえば以下の感じで利用を推奨します。

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

このように定義して実際に検証環境立ち上げ時には
~~~cmd
./minto
~~~

このように実行することで、対象の Credential が有効な検証環境が利用できます。

また特に `conf/minto.json` で
~~~json
{
    "bindPort": 3210
}
~~~

特定の指定がされていない場合は `bindPort=3210` が対象となるので
- http://127.0.0.1:3210/

でブラウザからアクセスする事で `./minto` コマンド実行い対する検証環境の利用を行なう事ができます。

一旦セットアップについての説明は以上となります。
