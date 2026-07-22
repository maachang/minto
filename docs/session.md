# session.js（S3ベース セッション管理）

`modules/auth/session.js`は、S3をバックエンドにしたシンプルなセッション管理
モジュールです。ログイン機能を持つWebアプリ（社内ツール等）で、毎回同じような
Cookie処理コードを書かずに済むよう、**Cookie連携込みのAPI**を提供しています。

## なぜ「実装が楽」なのか

素朴にセッションチェックを実装すると、保護したいページ・API（フィルター、
マイページ、ログアウト処理など）のあちこちで

```js
const sid = req.cookie("minto_sid");
const user = await session.get(sid);
if (user == null) { /* 未ログイン処理 */ }
```

のような同じコードを書き散らすことになりがちです。`session.js`は
`setCookie`/`getCookie`/`destroyCookie`という3つのAPIで、
「Cookie名の扱い」「S3への読み書き」「1リクエスト内での重複問い合わせの
抑制（後述のキャッシュ）」までまとめて面倒を見ます。

呼び出し側のコードは、たとえばフィルターならこれだけで済みます。

```js
// public/filter.mt.js
const user = await session.getCookie();
if (user == null) {
    // 未ログイン時の処理(ログイン画面へリダイレクト等).
}
```

## 主な機能

| 操作 | メソッド | 備考 |
|---|---|---|
| セッション開始 | `start(userId, userData)` | セッションIDを発行してS3に保存するだけ(Cookieは設定しない) |
| セッション取得 | `get(sid)` | 期限切れの場合は自動的にS3から削除してnullを返す |
| セッション破棄 | `destroy(sid)` | S3から削除するだけ(Cookieはそのまま) |
| セッション数取得 | `count()` | 有効なセッション数を返す |
| **ログイン(Cookie込み)** | `setCookie(userId, userData)` | `start`＋Cookie設定を1回で行う。セッションIDを返す |
| **セッション確認(Cookie込み)** | `getCookie()` | `request`のCookieからセッション情報`{userId, data}`を取得(無ければnull) |
| **ログアウト(Cookie込み)** | `destroyCookie()` | `destroy`＋Cookieクリアを1回で行う。ログアウト処理はこれだけで良い |

`start`/`get`/`destroy`/`count`は`sid`(セッションID文字列)を明示的に扱う
低レベルAPIで、`setCookie`/`getCookie`/`destroyCookie`は
`$request()`/`$response()`のCookieを内部で直接操作する高レベルAPIです。
通常のWebアプリ実装では、後者の3つだけで十分なケースがほとんどです。

なお「Cookieだけクリアし、S3のセッションは残す」という操作は単独では
用途が無い(セッションIDはログインの都度ユニーク発行されるため、Cookieを
消すならセッションも一緒に破棄してしまって問題無い。`destroy`は存在しない
セッションIDに対して呼んでも安全かつ無料(DeleteObjectは対象キーが無くても
エラーにならず課金も無い)ため、あえて分離するメリットが無い)ので、
提供していません。

## 1実行毎のキャッシュ(`getCookie`の重複問い合わせ抑制)

`getCookie()`は、`lambda/src/index.js`が提供する**1回のLambda実行(1リクエスト)
単位の汎用キャッシュ**(`$cache()`)を使って結果をキャッシュします。これにより、
同一リクエスト内で複数箇所(フィルター＋ページ本体、等)から`getCookie()`を
呼んでも、S3への問い合わせは1回だけで済みます。

```js
// filter.mt.js でも、mypage.mt.html でも、同じリクエスト内なら
// 2回目以降はキャッシュから返るのでS3アクセスは発生しない.
const user = await session.getCookie();
```

`setCookie`/`destroyCookie`はログイン状態が変わる操作のため、
呼び出し時にこのキャッシュを自動的に無効化します（次の`getCookie()`呼び出しで
再度S3から取得し直す）。

`$cache()`は`exports.handler`（実際のLambda実行）ごと、およびローカル実行時は
`tools/webapps.js`が1リクエストごとに呼ぶ`clearCache()`のタイミングでリセット
されるため、リクエストをまたいで古いキャッシュが残ることはありません。

## Cookie名のカスタマイズ

デフォルトのCookie名は`minto_sid`です。変更したい場合は環境変数
`MINTO_COOKIE_SESSION_NAME`（`conf/env.json`等）を設定してください。

## 使い方（最小構成）

`$loadLib`はプロジェクトの`lib/`配下のみを検索する仕様のため(`modules/`配下へは
自動フォールバックしない)、`modules/auth/session.js`をプロジェクトから使うには
`lib/session.js`に以下のような再エクスポートスタブを1つ置くだけで良いです
(実体は1箇所(`modules/auth/session.js`)に集約する)。

```js
// lib/session.js
module.exports = require("(minto直下からの相対パス)/modules/auth/session.js");
```

あとは各ページ・フィルターから、`conf/app.json`等のバケット設定を渡して
`create()`するだけです(バケット名はプロジェクトごとに異なるため、
`session.create()`にはその都度設定を渡す必要があります)。

```js
// 例: public/filter.mt.js など.
const conf = $loadConf("app.json");
const session = $loadLib("session.js").create({
    bucket: conf.s3Bucket,
    prefix: conf.sessionPrefix,        // 省略時 "sessions/"
    timeoutMin: conf.sessionTimeoutMin, // 省略時30分
    region: conf.region
});
```

```js
// ログイン成功時(例: GAS oAuthのコールバック、通常のID/PWログイン等).
await session.setCookie(userId, { name: "...", role: "..." });
```

```js
// 保護したいページ・フィルターでのチェック.
const user = await session.getCookie();
if (user == null) {
    // 未ログイン.
}
// user.data.name 等でユーザー情報にアクセスできる.
```

```js
// ログアウト.
await session.destroyCookie();
```

GASを使った擬似SSOログインと組み合わせた実装例は
[gasAuth.md](https://github.com/maachang/minto/blob/main/docs/gasAuth.md)、
実際に動くサンプル一式は
[sample/gas-oauth-login/](https://github.com/maachang/minto/blob/main/sample/gas-oauth-login/README.md)
を参照してください。
