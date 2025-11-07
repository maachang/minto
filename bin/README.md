# minto コマンド利用方法.

mintoコマンドは、以下のコマンドが存在します.
- minto
  ローカル環境でmintoを実行・確認するためのコマンド
- mtpk
  ローカルmintoをデプロイして aws lambda 用の zip ファイル化するためのコマンド

まずこれらコマンドを利用するための設定を行うための説明を行います.

## 1. MINTO_HOME パスを定義します

~/.bashrc などに以下のように設定を行います.

~~~sh
export MINTO_HOME={minto 対象ディレクトリを設定}
~~~

たとえば `~/project/minto` が対象ディレクトリの場合.

~~~sh
export MINTO_HOME=~/project/minto
~~~

を設定します.

## 2. MINTO_HOME/bin/ 以下を PATH設定する.

~/.bashrc などに以下のように設定を行います.

~~~sh
export PATH=${MINTO_HOME}/bin:${PATH}
~~~

これにより、minto のコマンドが利用できます.

# 各コマンド説明.

次にmintoが提供するローカル実行向けのコマンドについて説明します.

## mintoローカル実行用コマンド

~~~sh
> cd {mintoによるWebアプリ実装ディレクトリ}
> minto
~~~

このコマンドは、ローカル環境で minto 実装内容のテストを行なうためのサーバ起動コマンドです.

ここで「ローカル動作確認」対象のディレクトリをカレントディレクトリとして、実行します,

また、カレントディレクトリには、以下の構成を元に実行確認を行なう事ができます.
~~~
mintoによるWebアプリ実装ディレクトリ:
[current]
    +-- public: HTMLなどのWebコンテンツ配置先.
    |
    +-- lib: minto 対象の モジュールjs の配置先.
    |
    +-- conf: minto 実行に対する conf ファイル(json) 配置先.
~~~

※ 以下対応は不要かも
<<開始>>
また このコマンド利用に対して `aws-sdk-v3(nodejs)` をインストールして利用可能にする必要があります.

- S3Client利用の場合は以下の形でグローバルインストール
~~~sh
> npm i @aws-sdk/client-s3 -g
~~~

その後以下のパスを設定する事でグローバルインストールされたnpmモジュール利用が可能となります.
~~~sh
export NODE_PATH=`npm root -g`
~~~
<<終了>>

※ ちなみに llrt だと http or https モジュールが利用できないようなので、minto=nodeしか利用できません.

## mtpk コマンド

リリース対象の minto 環境を zip 化して、デプロイ可能にするためのコマンドです.

これも `minto` コマンドと同じように、対象の `mintoによるWebアプリ実装ディレクトリ` に移動してから、このコマンドを実行する事で lambda にデプロイ可能な zip ファイル形式で固められます.

~~~sh
> cd {mintoによるWebアプリ実装ディレクトリ}
> mtpk
~~~

これにより、コマンドを実行したカレントディレクトリに `mtproj.zip` ファイルが作成されます.

また、ここでは jsをminimize するために

- uglifyjs: https://www.npmjs.com/package/uglify-js

をインストールして、コマンド引数を設定する事で利用可能となります.
~~~sh
> npm install uglify-js -g
~~~

これを有効にする場合は以下コマンドで実施出来ます.
~~~sh
> mtpk -m
もしくは
> mtpk --min
~~~

js の minimize を適用する事で「ファイルサイズやデプロイ速度がある程度上がる（パース分等）」と言えますが、一方でException 関連の行数がわからなくなるので、ケースバイケースであると言えます.

それ以外に以下のパラメータが利用可能です.

### 1. 静的コンテンツに対するetagのキャッシュタグを抽出.
~~~sh
> mtpk -e
もしくは
> mtpk --etag
~~~

ブラウザでキャッシュ設定を行なうhttpヘッダの `etag` がありますが、これの情報は対象コンテンツのHash値を設定する必要があります。

一方で「これを毎回HTTPResponse毎」に行なうと、毎回対象コンテンツの内容を元にHash化処理が必要になり、パフォーマンスが悪くなります。

これを `mtpkコマンド` で aws lambda デプロイ向けの zip 化において、情報を演算する事がこのパラメータができます。

対象となるのは `public` 以下で、そこで「minto js系」以外の静的コンテンツを対象として「etag対象のHash計算」がされ、それらが AWS Lambda上で利用可能となります。

### 2. 静的コンテンツに対するgzip化
~~~sh
> mtpk -z
もしくは
> mtpk --gz
~~~

gzip可能な `public` 以下の 静的コンテンツに対する gzip 利用で圧縮可能なコンテンツ(文字列系)に、予め gzip 化する場合に利用します。

これによって例えば `xxxx.html` と言うファイルが `xxxx.html.gs` と言う名前で gzip 圧縮され、これらが gzip 圧縮されたものとして、実際の aws lambda  の url function で利用できます。

またこれらは 拡張子に対して mime定義 から gzip 利用可能なものが、変換対象となります.
- txt: text/plain
- html or htm: text/html
- xhtml: application/xhtml+xml
- xml: text/xml
- json: application/json
- css: text/css
- js: text/javascript

現状では上記の拡張子(mime) が gzip 化され、そして `/conf/mime.json` で `gz=true` の内容が gzip 対象となります。

これらを行なう事で aws lambda の url function 実行において対象が 実行時に gzip 処理が不要となるので、高速にレスポンス実行ができます.

### 3. 全てを有効にしたい場合.
~~~sh
> mtpk --all
~~~

上の実行を行なう事で実際には以下のコマンドパラメータと同義になります.
~~~sh
> mtpk -m -e -z
もしくは
> mtpk --min --etag --gz
~~~

## EOF.