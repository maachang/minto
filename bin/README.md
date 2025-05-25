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

### mtpro コマンド

lambdaで minto を動作させる場合は、基本的に llrt(Low Latency Runtime) と言う軽量 javascript 実装で利用されるが、この llrt と node だと、互換性はあるが「利用できない機能」が多くあります.

そのため先程のコマンド `minto` では「テストに最適化された実行環境=node必須」で実行されるが、このコマンド `mtpro` では `llrt` 環境で実行されます.

ただ、この場合は `require` で読み込まれた内容は「キャッシュ化」されてしまうので `$import` 関連の先の編集対応をしても、再利用されないです.

llrt では require のキャッシュクリアが出来ないため、このような問題が起きます.

ただ、一旦 `minto` コマンドでローカル確認が出来た後に、このコマンドで実行して `llrt` で実行できるかの確認をする場合に利用します.

あと `llrt` をインストールする場合は以下URL
- https://github.com/awslabs/llrt/releases

ここの、たとえば環境が linux Intel系64bitOS 環境だと
-  llrt-linux-x64.zip

これをダウンロード＋解凍=解凍結果ファイル名=`llrt` これをどこか「PATH環境変数を通す場所に配置」させる事で、コマンド利用が可能です.

※ ちなみに解凍後のファイル名=`llrt` 以外の場合は AWS lambda 利用専用(bootstrap) なので、それらはローカルで利用出来ません.

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
< mtok --min
~~~

js の minimize を適用する事で「ファイルサイズやデプロイ速度がある程度上がる（パース分等）」と言えますが、一方でException 関連の行数がわからなくなるので、ケースバイケースであると言えます.
