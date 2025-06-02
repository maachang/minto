# minto 仕様および、使い方説明

事前に[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md) の内容を元に環境変数設定で `minto` コマンドが利用可能な状況を元に説明しています。

## minto ディレクトリ構成とローカル実行環境構築方法

~~~
mintoによるWebアプリ実装ディレクトリ:
[current]
    +-- public: HTMLなどのWebコンテンツ配置先.
    |
    +-- lib: minto 対象の モジュールjs の配置先.
    |
    +-- conf: minto 実行に対する conf ファイル(json) 配置先.
~~~

mintoローカル実行を行なうための環境を作成するために、以下のようにディレクトリを作成します。
~~~cmd
mkdir {mintoプロジェクト名など}
cd {mintoプロジェクト名など}
mkdir public
mkdir lib
mkdir conf
echo "test" >> public/index.html
minto
~~~

ためしに上のコマンド実行を行い、ブラウザを起動して
- URL: http://127.0.0.1:3210/

上のURLを実行する事で `test` と画面に表示されれば、成功です。

## lambda url function の制限を理解する

lambda url function では
- リクエストボディの最大サイズは1MB
- レスポンスボディの最大サイズは1MB

となってるので、public 配下に配置するコンテンツは1MB未満である必要があります。

ただ一方で テキスト系コンテンツ(html, xml, json, js, css)などの場合gzip圧縮が可能となるが、一方の画像コンテンツ(jpg, png, gif) などの場合は gzip 圧縮されないので、気をつける必要があります。

## public ディレクトリに配置可能なコンテンツについて






