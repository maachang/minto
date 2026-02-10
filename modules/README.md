# mintoモジュール

## このディレクトリ以下で定義されているモジュール

- `no-sdk`: llrt-lambda-{cpu名}-no-sdk.zip を利用する場合の aws-sdk(AWS Signature(version4)) を利用する場合のライブラリ群.
- `sdk`:  llrt-lambda-{cpu名}-full-sdk.zip を利用する場合の aws-sdk-V3を利用するライブラリ群.
- `notification`: よく使う slack通知やgithubリポジトリのissue作成を行うライブラリ群.

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

