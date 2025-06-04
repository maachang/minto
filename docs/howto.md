# minto ローカル環境利用方法(howto)

事前にこちらを読んでください。

[setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md) の内容を元に環境変数設定で `minto` コマンドが利用可能な状況を元に説明しています。

## ①minto ローカル環境ディレクトリ構成とローカル実行環境構築方法

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

上のURLを実行する事でブラウザに `test` と画面に表示されれば、成功です。

## ②lambda url function の制限を理解する

lambda url function では
- リクエストボディの最大サイズは1MB
- レスポンスボディの最大サイズは1MB

となってるので、public 配下に配置するコンテンツは1MB未満である必要があります。

ただ一方で テキスト系コンテンツ(html, xml, json, js, css)などの場合gzip圧縮が可能となるが、一方の画像コンテンツ(jpg, png, gif) などの場合は gzip 圧縮されないので、気をつける必要があります。

## ③public ディレクトリのコンテンツ説明.

publicディレクトリで利用可能なコンテンツについて説明します。
1. mt.js
2. jhtml.js
3. mt.html
4. filter.mt.js
5. favicon.ico
6. それ以外の静的コンテンツ

minto では「動的コンテンツ」が利用可能で、これらは１〜４が対象となります。

### 1. mt.js
これは「標準動的コンテンツ」で、利用用途として「json返却を行なうため」に利用します。

- test.mt.js
~~~js
exports.handler = async function () {
    return {id: 100, message: "テスト"};
}
~~~

上のように行なう事で、対象JSONがブラウザに返却できます。
- mine: `application/json`

またURLパスでは(拡張子なし)
- test

とする必要があります。

### 2. jhtml.js

mt.html 拡張子の jhtml を `mtpkコマンド` で lambdaデプロイされた場合、この拡張子となります。

たとえば元のjhtml が以下の場合.

- test.mt.html
~~~html
<%
const hogehoge = "abc"
%>

${hogehoge}
~~~

デプロイ(jhtml.js)後
- test.jhtml.js
~~~js
exports.handler=async function(){
    let _$outString="";
    function $out(n){
        _$outString += n;
    }
    $out("");
    $out("\n\n");
    $out("abc");
    $out("");
    return _$outString;
};
~~~

上のようにデプロイ変換されHTMLとしてブラウザに返却されます。
- mime: `text/html`

またURLパスでは(jhtml)
- test.jhtml

とする必要があります。

### 3. mt.html

`2. jhtml.js` で説明 した内容で `mtpkコマンド` でデプロイ変換するためのjhtmlテンプレート内容です。

この拡張子は lambda 上では利用できませんが、ローカル検証環境 `mintoコマンド` 利用では利用ができます。

上のようにデプロイ変換されHTMLとしてブラウザに返却されます.
- mime: `text/html`

またURLパスでは(jhtml)
- test.jhtml

とする必要があります。

またこのデプロイ前の `mt.html` これは lambda 上で利用はできません.

必ず `mtpkコマンド` でデプロイ変換した内容を lambda にアップロードしてください。

### 4. filter.mt.js

このファイルは、存在する場合、ブラウザからの「リクエスト」時に、対象ファイルが存在する場合、必ずこの内容が実行されます。

また「filter」は１つのみ定義が可能となっています。
- /public/filter.mt.js

ここでは主に「ログインをしているか否か」みたいな形で「アクセス制御」などで利用します。

内容としては以下のような形で実装します。

~~~js
exports.handler = async function () {
    // フィルターを通過（対象パスを許可する)
    return true;
    // フィルターする(対象パスを拒否する)
    // return false;
}
~~~

戻り値に `true` 返却をすることで「処理を続行」しますが、それ以外を返却した場合「status: 403」で処理を中断します。

それ以外に `$response()` を用いる事で「redirect」なども利用する事ができます。

このように、個別の処理は各 public 以下のそれぞれの動的コンテンツに記載し、一方の共通処理は、この `filter` 機能を利用します。

### 5. favicon.ico

これはブラウザのURLに「アイコン」を表示させたり、ブックマークにアイコン表示する事ができるもので、これを `public/favicon.ico` とする事で、それらが有効となります。

またこれに対するブラウザアクセスに対しては `filter.mt.js` が実行されません。

### 6. それ以外の静的コンテンツ

これまでの動的コンテンツや icon 以外として、この `public` 配下において、静的コンテンツを設定する事ができます。

また標準でサポートされている静的コンテンツ(mimeType)は以下の通りです.
- text/plain(text)
- text/html(html)
- application/xhtml+xml(xhtml)
- text/xml(xml)
- application/json(json)
- text/css(css)
- text/javascript(js)
- image/gif(gif)
- image/jpeg(jpeg)
- image/png(png)
- image/vnd.microsoft.icon(ico)

それ以外のmimeサポート定義は
- /conf/mime.json

で定義することで利用範囲が広がります。

## ④実装モジュールや定義関連の利用について

これまで説明した `public` は ブラウザなどURLで設定されたパスに応じて呼び出されます。

一方で
- lib
- conf

これらに関してはそれぞれ、動的コンテンツからモジュールや定義JSONのロードを行なう事ができ、これらについて説明します。

### 1. $loadLib

利用方法は `require` のような利用結果を得られます。

ただ設定パスの利用先が `lib` が規定ディレクトリとなります。

使い方はたとえば、以下のよう利用できます。

~~~js
const s3client = $loadLib("s3client.js")
~~~

これによって
- ${MINTO_HOME}/lambda/src/lib/s3client.js

ここのモジュールをロードされます。

またmintoコマンドでローカル検証環境での利用の場合は、
- ${MINTO_HOME}/lambda/src/lib
- require("path").resolve() + "/lib" + "/s3client.js"

これらがモジュール捜査先となります。

また `$loadLib` の戻り値は `require` の結果と同じものとなります。

### 2. $loadConf

これも `$loadLib` と同じような性質を持つものです。

設定パスの利用先が `conf` が規定ディレクトリとなります。

またこの `$loadConf` では、定義ファイルとして json 情報を読み込みます。

あと `$loadLib` と同様で `mintoコマンド` でローカル検証実行においては
- ${MINTO_HOME}/lambda/src/conf
- require("path").resolve() + "/conf"

が読み込み対象となります。

### 3. $require

基本的にこの機能を使うケースとしては `nodejsの標準モジュールの利用` がメインだと思います。

その理由としては
- $loadLib
- $loadConf

基本的に `public` 配下に require対象のjsファイルやJSONファイルを配置する事は無いので、その意味でも `$require` を使うことはありません。

また `public` 配下の動的コンテンツ
- mt.js
- jhtml.js
- mt.jhtml

ここでは通常の `require` が利用できないので、代わりに `$require` を利用します。

あと通常の `require` は呼び出し対象のファイルパスを軸に「モジュール呼び出し」をするのですが `$require` の場合は以下の絶対パスからの呼び出しとなります。
- ${MINTO_HOME}/lambda/src
- require("path").resolve()

ただ、通常は `nodejs標準モジュール利用以外` で利用する事は無いので、気にする必要は無いかも知れないです。

## ⑤minto用 $request 説明

minto環境では 以下HTTPに対応するため
- $request: HTTPリクエストオブジェクト.
- $response: HTTPレスポンスオブジェクト.

が利用可能です。

まずはじめに $request の機能について説明します。

### 1. $request().path()

URLのパスが返却されます.

使い方: /xxxx.mt.js
~~~js
const path = $request().path();
console.log("path: " + path);
~~~

実行結果:
~~~cmd
path: /xxx
~~~

### 2. $request().extends()

URLパスの拡張子が返却されます.

使い方: /xxxx.mt.js
~~~js
const extends = $request().extends();
console.log("extends: " + extends);
~~~

実行結果:
~~~cmd
extends: 
~~~

動的JSON返却対象の場合、拡張子なしなので「空文字」が返却されます.

### 3. $request().method()

HTTPメソッド内容が返却されます.

使い方: /xxxx.mt.js
~~~js
const method = $request().method();
console.log("method: " + method);
~~~

実行結果:
~~~cmd
method: GET
~~~

それ以外にPOST、DELETEなどが返却されます.

### 4. $request().headers()

HTTPリクエストの全てのヘッダ(Object)を取得します.

使い方: /xxxx.mt.js
~~~js
const headers = $request().headers();
console.log("header.userAgent: " + headers["user-agent"]);
~~~

実行結果:
~~~cmd
header.userAgent: Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0
~~~

上の例だとHTTPリクエストの `User-Agent` を表示しています。

また minth では headerキー名は全て小文字で変換されたもので取り扱えます。

### 5. $request().header(string)

HTTPリクエストのヘッダキーを指定して１つのヘッダ要素を取得します.

使い方: /xxxx.mt.js
~~~js
const value = $request().header("user-agent");
console.log("header.userAgent: " + value);
~~~

実行結果:
~~~cmd
header.userAgent: Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0
~~~

上の例だとHTTPリクエストの `User-Agent` を表示しています。

また minth では headerキー名は全て小文字で変換されたもので取り扱えます。

### 6. $request().cookies()

HTTPリクエストのすべてのCookie(Object)を取得します。

使い方: /xxxx.mt.js
~~~js
const cookies = $request().cookies();
console.log("cookies: " + JSON.stringify(cookies));
~~~

実行結果:
~~~cmd
cookies: {"hoge": "moge"}
~~~

HTTPリクエストに設定されているCookieを全て取得します。

### 7. $request().cookie(string)

HTTPリクエストのCookieの１つのKeyを指定して１つのCookie要素を取得します.

使い方: /xxxx.mt.js
~~~js
const value = $request().cookie("hoge");
console.log("cookie.hoge: " + value);
~~~

実行結果:
~~~cmd
cookie.hoge: moge
~~~

上の例だとHTTPリクエストCookieの `hoge` に対する要素を表示しています。

### 8. $request().protocol()

HTTPおよびHTTPSなどのHTTPプロトコルを取得します.

使い方: /xxxx.mt.js
~~~js
const value = $request().protocol();
console.log("protocol: " + value);
~~~

実行結果:
~~~cmd
protocol: https
~~~

### 9. $request().urlParams()

HTTPリクエストのURLに設定されているパラメータ文字列を取得します.

使い方: /xxxx.mt.js
~~~js
const value = $request().urlParams();
console.log("urlParams: " + value);
~~~

実行結果:
~~~cmd
urlParams: hoge=moge&abc=123
~~~

URLに設定されたパラメータが文字列で返却されます.

### 10. $request().urlParams()

HTTPリクエストのURLに設定されているパラメータがObject型で返却されます.

使い方: /xxxx.mt.js
~~~js
const value = $request().urlParams();
console.log("urlParams: " + JSON.stringify(value));
~~~

実行結果:
~~~cmd
urlParams: {"hoge": "moge", "abc": 123}
~~~

通常はこちらのメソッド `$request().urlParams()` でなくこちら `$request().params()` を利用します。

### 11. $request().params()

HTTPリクエストのURLパラメータ及び、Body内容をパラメータとして取得します。

使い方: /xxxx.mt.js
~~~js
const value = $request().params();
console.log("params: " + JSON.stringify(value));
~~~

実行結果:
~~~cmd
urlParams: {"hoge": "moge", "abc": 123}
~~~

通常はパラメータ取得はこちら `$request().params()` を利用します。

### 12. $request().body()

HTTPリクエストで設定されているBodyを取得します.

使い方: /xxxx.mt.js
~~~js
const value = $request().body();
console.log("body: " + value);
~~~

実行結果:
~~~cmd
body: null
~~~

HTTPメソッドが `GET` の場合は `null` 返却されます.

それ以外のHTTPメソッド `POST` などの場合は バイナリおよび文字列が取得出来ます。

## ⑥minto用 $response 説明

通常単純に動的コンテンツとしての処理結果を返却するだけなら
- /xxxx.mt.js
~~~js
exports.handler = async function () {
    return {message: "hello world"};
}
~~~

とする事で実行対象の動的コンテンツタイプ(mt.js = JSON返却) がされるものとして、適切なHTTPレスポンス結果が設定されます。

一方で
- httpStatus
- HTTPヘッダ
- Cookie
- リダイレクト処理(status: 301 + header["locale"] = url)

など単純にレスポンスBodyを返却するだけじゃない「カスタムHTTPレスポンス対応」が必要な場合 `$response()` 機能を利用することで、それらの対応が可能となります。

### 1. $response().status(number, string)

HTTPレスポンスのステータス及びステータスメッセージを設定します。

- HTTPステータスのみ設定.
~~~js
$response().status(404);
~~~

- HTTPステータスとステータスメッセージ設定.
~~~js
$response().status(404, "not found");
~~~

これにより「HTTPステータスの返却をカスタム設定」する事ができます。

### 2. $response().header(string, string)

１つのHTTPレスポンスヘッダを設定します。

~~~js
$response().header("x-test", "hogehoge");
~~~

HTTPレスポンスヘッダ情報をカスタム設定する場合に利用します。

### 3. $response().headers()

HTTPレスポンスヘッダに対する確認や削除対応を行います.

- $response().headers().get(string)
  第一引数にヘッダーキーを設定する事でHTTPヘッダ要素が返却されます。
- $response().headers().keys()
  設定されているHTTPヘッダキー(Array)が返却されます。
- $response().headers().put(string, string)
  $response().header(string, string) と同じ。
- $response().headers().remove(string)
  第一引数にヘッダーキーを設定する事で、対象のKey内容を削除します。

### 4. $response().cookie(string, object)

HTTPレスポンスで新しいCookie情報を設定する場合に利用します。

Cookieの仕様は[このリンク](https://developer.mozilla.org/ja/docs/Web/HTTP/Reference/Headers/Set-Cookie)を参考にしてください。

minto でのHTTPレスポンスCookieの設定方法は以下の通りとなります.

- string
  - key: Cookieのキー名.
  - value: "{value内容}; Max-Age={MaxAge時間}; Secure;"

例: key="hoge", value={value: "test", "Max-Age": 2592000, Secure: true}
~~~js
$response().cookie("hoge", "test; Max-Age=2592000; Secure;")
~~~

- object
  - key: Cookieのキー名.
  - value: "{value: valueの内容, "Max-Age": {MaxAge時間}, Secure: true}

例: key="hoge", value={value: "test", "Max-Age": 2592000, Secure: true}
~~~js
$response().cookie("hoge", {value: "test", "Max-Age": 2592000, Secure: true})
~~~

このような形で設定する事ができます。

### 5. $response().body(Buffer or ArrayBuffer or string or object)

通常では HTTPレスポンスBodyを返却する場合は
~~~js
exports.handler = async function () {
    return {message: "hello world"};
}
~~~

この形がオーソドックスですが、一方で

~~~js
exports.handler = async function () {
    return $response().body({message: "hello world"});
}
~~~

これも上の `return {message: "hello world"};` 返却と同義のものとなります。

### 6. $response().contentType(string, string)

HTTPレスポンスヘッダーに対して `content-type` を直接設定する代わりに利用します.

利用方法は以下の通りです。
~~~js
$response().contentType("text/html", "utf-8"):
~~~

上の設定は実際には
~~~js
$response().header("content-type", "text/html; charset=utf-8")
~~~

これと同じ結果となります。

また charsetは任意です。

### 7. $response().redirect(string, object, number)

HTTPレスポンスに対して
- status: 301
- header: `location: url`

を設定する代わりに利用します。

利用方法は以下の通りです。
~~~js
$response().redirect("https://xyz/xxxx", {hoge: 100});
~~~

上の設定は実際には
~~~js
$response().status(301);
$response().header("location", "https://xyz/xxxx?hoge=100")
~~~

また第３引数の `number` はステータス指定で、これは任意です。

## ⑦動的コンテンツ(json返却) の実装説明

- 拡張子: mt.js

mt.js 形式の動的コンテンツは、非常にシンプルで、通常では json形式を返却します。
~~~js
exports.handler = async function () {
    return {message: "hello world"};
}
~~~

また特殊な `mt.js` 形式の `public/filter.mt.js` では 以下のように
- filter追加.
~~~js
exports.handler = async function () {
    return true;
}
~~~

- filter停止.
~~~js
exports.handler = async function () {
    return false;
}
~~~

実際には true 以外を返却すると filterで処理停止で返却する(403エラー)を通常は返却します。

## ⑧jhtml 実装

- 拡張子: mt.html

jhtmlは非常にシンプルなテンプレートエンジン(最低限のテンプレートエンジン)で、HTMLに「埋め込み」を行なう事で「動的なHTMLコンテンツ」を作成する場合に利用します。

以下が「埋め込みテンプレートの仕様」となります。

- jhtml組み込みタグ説明.
  - <% ... %><br>
    基本的な組み込みタグ情報
  - <%= ... %><br>
    実行結果をhtmlとして出力する組み込みタグ.
  - <%# ... %><br>
    コメント用の組み込みタグ.
  - ${ ... }<br>
    実行結果をテンプレートとして出力する組み込みタグ.<br>
    <%= ... %> これと内容は同じ.<br>
    ただ利用推奨としては、変数出力時に利用する.

使い方のサンプルは以下の通りです。

~~~html
<%
const s3client = $loadLib("s3client.js");
%>
<!DOCTYPE HTML SYSTEM "about:legacy-compat">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.ico">

<link rel="stylesheet" href="/css/xxx.css" type="text/css">
<script src="/js/xxx.js"></script>

</head>
<body>
    <$
        const list = s3client.create().listObjects({Bucket: "testBucket", KeyOnly: true});
        const len = list.length;
        for(let i = 0; i < len; i ++>) {
    %>
    <div>・${list[i]}</div>
    <%}%>
</body>
</html>
~~~

こんな感じで実装する事で `S3:testBucket` 配下のキーリストを描画する動的HTMLコンテンツが作成出来ます。

またローカル環境では jhtml 利用が出来ますが、一方で lambda 実行では利用できないため、そのままこのファイルを AWS Console から衆道で Lambda のファイル登録しても、動作しません。

Lambda 上でjhtmlを利用可能にするには `mtpkコマンド` で lambda デプロイ形式(zip変換)したものを Lambda に zip アップロードする事で利用することが出来ます。

## 説明終了

一旦ローカル環境での開発説明は終了となります。














