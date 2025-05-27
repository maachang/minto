# minto コマンド利用方法.

## まず以下の対応を行ないます.

### 1. MINTO_HOME パスを定義します

~/.bashrc などに

~~~sh
export MINTO_HOME={minto 対象ディレクトリを設定}
~~~

たとえば `~/project/minto` が対象ディレクトリの場合.

~~~sh
export MINTO_HOME=~/project/minto
~~~

を設定します.

### 2. MINTO_HOME/bin/ 以下を PATH設定する.

~/.bashrc などに

~~~sh
export PATH=${MINTO_HOME}/bin:${PATH}
~~~

これを設定します.

これにより、minto のコマンドが利用できます.

## 各コマンド説明.

### mintoコマンド

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

また このコマンド利用に対して `aws-sdk-v3(nodejs)` をインストールして利用可能にする必要があります.

- S3Client利用の場合は以下の形でグローバルインストール
~~~sh
> npm i @aws-sdk/client-s3 -g
~~~

その後以下のパスを設定する事でグローバルインストールされたnpmモジュール利用が可能となります.
~~~sh
export NODE_PATH=`npm root -g`
~~~

※ ちなみに llrt だと http or https モジュールが利用できないようなので、minto=nodeしか利用できない.

### mtpk コマンド

リリース対象の minto 環境を zip 化して、デプロイ可能にするためのコマンドです.

これも `minto` コマンドと同じように、対象のディレクトリに移動してから、このコマンドを実行する事で lambda にデプロイ可能な zip ファイル形式で固められます.

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
< mtpk --min
~~~

js の minimize を適用する事で「ファイルサイズやデプロイ速度がある程度上がる（パース分等）」と言えますが、一方でException 関連の行数がわからなくなるので、ケースバイケースであると言えます.
