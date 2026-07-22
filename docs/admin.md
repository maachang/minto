# admin.js（管理者情報の管理）

`modules/auth/admin.js`は、「誰が管理者か」をS3に暗号化して永続化し、
`isAdmin(mail)`で判定できるようにする小さなモジュールです。管理者だけに
管理メニューを表示する、といった用途に使います。

`modules/auth/session.js`と同じく`create(options)`のファクトリ方式です
(こちらは`conf/session.json`のような自動設定読み込みは行わず、呼び出し
毎に`options.bucket`等を明示的に渡します)。

## 主な機能

| 操作 | メソッド | 備考 |
|---|---|---|
| 管理者判定 | `isAdmin(mail)` | `mail`省略時は`modules/auth/session.js`の`getCookie()`でログイン中ユーザを取得し、その`userId`で判定する |
| 管理者追加 | `addAdmin(mail)` | 既に登録済みの場合は何もしない |
| 管理者削除 | `removeAdmin(mail)` | 未登録の場合は何もしない |
| 管理者一覧取得 | `listAdmins()` | 環境変数で定義された初期管理者を含めて返す |

## 初期管理者

管理者を1人も登録していない状態から始めるため、環境変数
`MINTO_ADMIN_INITIAL_MAIL`(または`create()`の`options.initialAdmin`)で
「最初の1人」を定義できます。この初期管理者は次の性質を持ちます。

- `isAdmin(初期管理者のmail)`は常に`true`(S3への問い合わせ無しで判定)
- S3側の管理者一覧には**含まれない**(env側の定義のみで管理される)ため、
  `addAdmin`/`removeAdmin`の対象にならない(除外したい場合はenv設定自体を
  変更する)
- `listAdmins()`の戻り値には含まれる(先頭に追加される)

初期管理者がログイン後、`addAdmin(mail)`を呼ぶことで他の管理者を
割り当てていく、という運用を想定しています。

## 保存内容の暗号化

管理者一覧はS3に平文のJSONではなく、AES-256-GCMで暗号化して保存されます。

- llrtの`node:crypto`は`createCipheriv`/`createDecipheriv`を未サポートの
  ため、`modules/sdk/kmsSdk.js`と同様に`globalThis.crypto.subtle`
  (WebCrypto)を使って暗号化しています
- 暗号化キーは`options.encryptKey`→環境変数`ADMIN_ENCRYPT_KEY`→
  モジュール内蔵の固定デフォルト文字列、の優先順で決まります。
  **本番運用では必ず`ADMIN_ENCRYPT_KEY`を設定してください**
  (未設定のままだと、リポジトリに含まれる既知の固定キーで暗号化される
  ため、実質的に保護されていない状態になります)

## 1実行毎のキャッシュ

`modules/auth/session.js`の`getCookie()`同様、`lambda/src/index.js`が
提供する1回のLambda実行(1リクエスト)単位の汎用キャッシュ(`$cache()`)を
使って管理者一覧をキャッシュします。同一リクエスト内で`isAdmin`/
`addAdmin`/`removeAdmin`/`listAdmins`を複数回呼んでも、S3への問い合わせは
基本的に1回で済みます。`addAdmin`/`removeAdmin`はS3への保存が完了する
前にキャッシュをクリアするため、S3への書き込みが途中で失敗しても、
保存されていないはずの変更がキャッシュ経由で見えてしまうことはありません。

## 使い方（最小構成）

`$loadLib`はプロジェクトの`lib/`配下のみを検索する仕様のため、
`modules/auth/admin.js`をプロジェクトから使うには`lib/admin.js`に
以下のような再エクスポートスタブを1つ置くだけで良いです。

```js
// lib/admin.js
module.exports = require("(minto直下からの相対パス)/modules/auth/admin.js");
```

`admin.js`は内部で`$loadLib("session.js")`を使うため、`modules/auth/session.js`
用の`lib/session.js`スタブと`conf/session.json`も併せて必要です
(詳細は[session.md](https://github.com/maachang/minto/blob/main/docs/session.md)参照)。

```js
// 例: public/filter.mt.js など.
const conf = $loadConf("app.json");
const admin = $loadLib("admin.js").create({
    bucket: conf.s3Bucket,
    prefix: conf.adminPrefix,   // 省略時 "admins/"
    region: conf.region
});
```

```js
// ログイン中ユーザーが管理者かどうかを判定する
// (mailを省略すると、session.getCookie()のログイン中ユーザで判定する).
if (await admin.isAdmin()) {
    // 管理者メニューを表示する等.
}
```

```js
// 管理者を追加/削除する(初期管理者がログイン後に他の管理者を割り当てる想定).
await admin.addAdmin("new-admin@example.com");
await admin.removeAdmin("former-admin@example.com");
```
