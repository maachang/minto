# ◆◆◆ password.js ◆◆◆

パスワードのハッシュ化・検証を行うユーティリティです。

llrtでは Node.js標準の `crypto.pbkdf2` / `crypto.scrypt` がサポートされていない(API.mdに記載が無い)ため、llrtでサポートが確認できている `crypto.createHmac` のみを使い、PBKDF2-HMAC-SHA256 を自前実装しています。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.hash(password, iterations)` | パスワードをハッシュ化(新規登録・パスワード変更時に利用) |
| `exports.verify(password, stored)` | パスワード検証(ログイン時に利用) |
| `exports.genSalt(bytes)` | salt生成(hex文字列)を個別に利用したい場合向けに公開 |
| `exports.derive(password, salt, iterations, keyLen)` | PBKDF2-HMAC-SHA256による導出処理を個別に利用したい場合向けに公開 |

---

## `hash(password, iterations)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `password` | `string` | 対象のパスワード |
| `iterations` | `number` | 反復回数(省略時デフォルト10000。Lambda(128MB)でのコールドスタート実行時間とのバランスを考慮したデフォルト値) |

### 戻り値

`{ salt, hash, iterations }` — この内容をそのまま保存し、`verify()` に渡す。

### 使用例

```javascript
const password = $loadLib("password.js");

const stored = password.hash("my-secret-password");
// { salt: "...(hex)", hash: "...(hex)", iterations: 10000 }
// -> stored をDB/S3等に保存する
```

---

## `verify(password, stored)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `password` | `string` | 検証対象のパスワード |
| `stored` | `object` | `hash()` で生成した `{salt, hash, iterations}` |

### 戻り値

`boolean` — 一致する場合 `true`。タイミング攻撃を避けるため定数時間比較で判定する。

### 使用例

```javascript
const ok = password.verify(inputPassword, stored);
if (!ok) {
    throw new Error("パスワードが一致しません");
}
```

---

## 注意事項

- 依存モジュールは無し(`crypto` のみ利用)。
- salt生成のデフォルトバイト数は16バイト、導出鍵長のデフォルトは32バイトです。

---

# ◆◆◆ mfaKey.js ◆◆◆

`mfa.js` に渡す `key1` / `key2` を `user` / `password` から算出するヘルパーです。`public/auth/mfa/viewMfa.mt.html`・`authMfaVerify.mt.js` から `$loadLib("mfaKey.js")` で読み込んで利用します。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.compute(user, password, host)` | user/passwordからmfa.js用のkey1/key2を算出 |
| `exports.getHttpProtocol(host)` | host名に対するprotocol(`http://`/`https://`)を取得 |

---

## `compute(user, password, host)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `user` | `string` | 対象のユーザー名 |
| `password` | `string` | 対象のパスワード(平文) |
| `host` | `string` | 対象のホスト名(`request.header("host")`) |

### 戻り値

```javascript
{
  key1: "hmacSHA256(user, sha256(password))",
  key2: "hmacSHA256(sha256(password), host)"
}
```

### 使用例

```javascript
const mfaKey = $loadLib("mfaKey.js");
const { key1, key2 } = mfaKey.compute(user, password, request.header("host"));
```

## `getHttpProtocol(host)`

`host` に応じて `"http://"`(localhost・IPアドレス)または `"https://"` を返却します。

---

## 注意事項

- 依存モジュールは無し(`crypto` のみ利用)。
- **デプロイ時の注意**: ローカル実行(`tools/webapps.js`)の `$loadLib` は `modules/` 配下も自動フォールバック検索するため `lib/` へのコピー無しでそのまま動作しますが、実際のLambdaデプロイ(`mtpk`)ではzipに `modules/` という階層は含まれません。`mtpk -t auth`(または `-t all`)を実行して `modules/auth/` 配下をzip内に含める必要があります(前提: `.claude/CLAUDE.md`「プロジェクト原則」参照)。デプロイ時に `-t auth` を忘れると本番環境で読み込めなくなるので注意。

---

# ◆◆◆ mfa.js ◆◆◆

携帯電話番号のSMS等を使った二段階認証(MFA)用コードの生成モジュールです。

想定する利用フロー:
1. user / password でログイン
2. 二段階認証画面を表示(QRコード + コード入力欄)
3. スマホでQRコードを読み取り、表示されたコードを入力・確認

初回ログイン時にはスマホへの二段階認証登録フローも別途想定されています(ファイル冒頭コメント参照)。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.create(outNextTime, keyCode, user, key1, key2, mfaLen, updateTime)` | ２段階認証コードを生成 |
| `exports.generateRandomCode(count)` | ランダムコードを生成 |

---

## `create(outNextTime, keyCode, user, key1, key2, mfaLen, updateTime)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `outNextTime` | `Array(2)` | 呼び出し後に `[0]`=次の更新残り時間(ms)、`[1]`=最大更新時間(ms) が書き込まれる出力引数 |
| `keyCode` | `string` | mfa固有のkeyCode |
| `user` | `string` | ユーザー名 |
| `key1` | `string` | 固有のkey1条件(例: ドメイン名。`mfaKey.js` の `key1` を利用可) |
| `key2` | `string` | 固有のkey2条件(例: MFA先携帯電話番号や固有番号。`mfaKey.js` の `key2` を利用可) |
| `mfaLen` | `number` | 生成する二段階認証コードの長さ |
| `updateTime` | `number` | コード更新タイミング(秒) |

### 戻り値

`Array(3)` — `[0]`は1つ前のタイミングのコード、`[1]`は現在タイミングのコード(通常はこれを返却して照合)、`[2]`は1つ後のタイミングのコード。

### 使用例

```javascript
const mfa = $loadLib("mfa.js");
const mfaKey = $loadLib("mfaKey.js");

const { key1, key2 } = mfaKey.compute(user, password, host);
const nextTime = [];
const codes = mfa.create(nextTime, keyCode, user, key1, key2, 6, 30);
// codes[1] が現在の正解コード. nextTime[0]で次回更新までの残りms.
```

## `generateRandomCode(count)`

`count` 桁数(8以下は8に補正、デフォルト24)のランダムな文字列コードを生成します。MFA登録時のkeyCode発行等に利用します。

---

## 依存・注意事項

- 依存モジュールは `crypto` のみ(他モジュールへの `$loadLib` 依存無し)。
- 内部で独自のxor128擬似乱数生成器を実装しています。
- `key1`/`key2`/`keyCode`/`user`/`mfaLen`/`updateTime` はすべて必須で、未設定・不正値の場合は `Error` をthrowします。

---

# ◆◆◆ jwt.js ◆◆◆

JWT(JSON Web Token)の署名・検証ユーティリティです。**HS256のみサポート**します。

llrtでは Node.js標準の `crypto.createSign`/`createVerify` や `publicEncrypt`/`privateDecrypt` がサポートされていない(RS256等の公開鍵方式は非対応)ため、共通鍵によるHMAC-SHA256(HS256)のみをサポートしています。`password.js` と同様に `crypto.createHmac` のみを使って自前実装しています。

検証するクレームは `exp`(有効期限)のみです。`iss`/`aud` 等の検証は呼び出し側で `payload` を見て個別に行う必要があります。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.sign(payload, secret, options)` | JWTトークンを生成 |
| `exports.verify(token, secret, options)` | JWTトークンを検証 |

---

## `sign(payload, secret, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `payload` | `object` | トークンに含めるクレーム。`exp`/`iat` は自動付与されるため呼び出し側で設定しても上書きされる |
| `secret` | `string` | 署名用の共通鍵 |
| `options.expiresIn` | `number` | 有効期限(秒)。**必須**、呼び出し側で用途に応じた値を明示的に指定する必要がある |

### 戻り値

`string` — JWTトークン文字列

### 使用例

```javascript
const jwt = $loadLib("jwt.js");

const token = jwt.sign({ userId: "u001" }, secret, { expiresIn: 3600 });
```

## `verify(token, secret, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `token` | `string` | 検証対象のトークン |
| `secret` | `string` | 署名検証用の共通鍵(sign時と同じ値) |
| `options.noError` | `boolean` | `false` の場合、検証失敗時に例外throw(デフォルト: `true`=例外を投げず `null` を返す) |

### 戻り値

検証成功時は `payload`(オブジェクト)。署名不一致・exp切れ・フォーマット不正の場合は `null`(`options.noError == false` の場合は例外throw)。

### 使用例

```javascript
const payload = jwt.verify(token, secret);
if (payload == null) {
    throw new Error("トークンが無効です");
}
```

---

## 依存・注意事項

- 依存モジュールは無し(`crypto` のみ利用)。

---

# ◆◆◆ corsFilter.js ◆◆◆

CORS(Cross-Origin Resource Sharing)対応の共通ヘルパーです。`public/filter.mt.js` から呼び出して利用します。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.apply(options)` | CORSヘッダーを `$response()` に設定 |

---

## `apply(options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `options.origins` | `"*"` \| `string[]` | 許可オリジン(必須) |
| `options.methods` | `string` | 許可メソッド(省略時デフォルト `"GET, POST, PUT, DELETE, OPTIONS"`) |
| `options.headers` | `string` | 許可ヘッダー(省略時デフォルト `"Content-Type, Authorization"`) |
| `options.credentials` | `boolean` | `true` の場合 `Access-Control-Allow-Credentials: true` を設定 |

### 戻り値

`boolean` — リクエストのOriginが許可された場合 `true`(Originヘッダーが無い場合も`true`)。許可されていないOriginの場合は `false`。

### 使用例

```javascript
// public/filter.mt.js
const corsFilter = $loadLib("corsFilter.js");

if (!corsFilter.apply({ origins: ["https://example.com"], credentials: true })) {
    // 許可されていないOriginの場合の処理
    $response().status(403);
    return false;
}
```

---

## 依存・注意事項

- 依存モジュールは無し。
- **注意**: mintoのfilter仕様上、`true` 返却時は対象の動的コンテンツ(mt.js等)の処理が続行されます。そのためOPTIONSプリフライトの場合でも、本モジュールだけでは実際のハンドラ処理の実行を止められません。必要な場合は呼び出し側(filter.mt.js)で `req.method() === "OPTIONS"` の分岐を追加する必要があります。

---

# ◆◆◆ convb.js ◆◆◆

主要なJSの型をバイナリ変換するライブラリです。バイナリでデータ格納することでファイル容量を減らす目的で使われます。`gasAuthSig.js` から利用されています。

---

## エクスポート(抜粋)

型判定・エンコード/デコード用の多数の関数・定数がexportされています。用途上、`gasAuthSig.js` から利用されている以下が中心です。

| 関数 | 説明 |
|---|---|
| `exports.encodeString(out, value)` | 文字列を `out`(Array)へバイナリエンコードして追記(先頭3バイトが長さ) |
| `exports.decodeString(pos, bin)` | `bin` の `pos[0]` 位置から文字列をデコード(pos[0]は自動更新) |
| `exports.decodeStringLength(pos, bin)` | 文字列長のみを取得(位置は更新しない) |
| `exports.encodeLong(out, value)` | 64bit整数を `out` へバイナリエンコードして追記 |
| `exports.decodeLong(pos, bin)` | 64bit整数をデコード |

このほか `encodeFloat`/`decodeFloat`・`encodeInt32`/`decodeInt32`・`encodeUint16`/`decodeUint16`・`encodeUint8`/`decodeUint8`・`encodeKey`/`decodeKey`・`encodeBoolean`/`decodeBoolean`・`encodeArray`/`decodeArray`・`encodeObject`/`decodeObject`・`encodeValue`/`decodeValue` や、`isNumber`/`isString`/`isBoolean`/`isDate`/`isArray`/`isObject`/`isNull` などの型判定関数、`TYPE_*` の型定数一式がexportされています。

### 使用例(gasAuthSig.jsでの利用箇所)

```javascript
const convb = $loadLib("convb.js");

const list = [0, 0];
convb.encodeString(list, passCode);
convb.encodeString(list, user);
convb.encodeLong(list, Date.now());
```

---

## 依存・注意事項

- 依存モジュールは無し。
- `Calendar`/`Time`/`Timestamp` 型のエンコード/デコード関数(`encodeCalendar`・`decodeCalendar` 等)も定義されていますが、これらのクラス自体はこのファイル内では定義されていません(利用側で該当クラスがグローバルに存在する前提)。`modules/auth` 配下では直接使われていません。

---

# ◆◆◆ jwt.js との補足: gasAuthSig.js / gasAuth.js における乱数について

`gasAuthSig.js`・`gasAuth.js` 内の乱数生成処理(`rand.next()`)は、このファイル内では定義されていないグローバル変数 `rand` を参照しています。これは `lambda/src/index.js`(`_g.rand = createRandom();`)でLambda実行環境全体に対して1つ用意される乱数オブジェクトであり、`modules/auth`側では新たに定義せずこのグローバルをそのまま利用する設計です。

---

# ◆◆◆ gasAuthSig.js ◆◆◆

ログイン用のシグニチャー(署名)・トークンの生成/検証を行う低レベルユーティリティです。`gasAuth.js` から `$loadLib("gasAuthSig.js")` で利用されます。

内部で独自のハッシュ関数(`hash`)・ビットフリップ変換・XOR系エンコード/デコードを実装しており、`convb.js` に依存してトークン内のバイナリ構造(文字列長・64bit整数)をエンコード/デコードしています。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.hash(code)` | 独自ハッシュ計算(16byteのバイナリ配列を返却) |
| `exports.cutEndBase64Eq(code)` | base64文字列の末尾の `=` を除去 |
| `exports.getPassCode(user, password)` | user+passwordから独自ハッシュ済みのbase64パスコードを取得 |
| `exports.createSessionId(len)` | セッションIDを生成(base64。デフォルト長24、最大長86) |
| `exports.encodeToken(keyCode, user, passCode, sessionId, expireDate, expireMs)` | ログイントークンを生成 |
| `exports.decodeToken(keyCode, token)` | ログイントークンをデコード・検証 |

---

## `getPassCode(user, password)`

`user + "\n" + password` を独自ハッシュ化し、base64(末尾`=`無し)にしたパスコードを返却します。

## `createSessionId(len)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `len` | `number` | セッションID長(省略時デフォルト24、最大86。超過時は`Error`) |

## `encodeToken(keyCode, user, passCode, sessionId, expireDate, expireMs)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `keyCode` | `string` | トークン鍵情報 |
| `user` | `string` | ユーザ名(最大128文字) |
| `passCode` | `string` | `getPassCode()` で生成したパスコード |
| `sessionId` | `string` | `createSessionId()` で生成したセッションID(最大128文字) |
| `expireDate` | `number \| null` | 日単位のexpire(S3の最低削除粒度が日のため)。ミリ秒指定したい場合は `null` を渡し `expireMs` を使う |
| `expireMs` | `number` | ミリ秒単位のexpire(`expireDate=null` の場合に使用) |

### 戻り値

`string` — base64エンコードされたトークン文字列

### 使用例

```javascript
const sig = $loadLib("gasAuthSig.js");

const passCode = sig.getPassCode(user, password);
const sessionId = sig.createSessionId();
const token = sig.encodeToken(keyCode, user, passCode, sessionId, 1, null);
```

## `decodeToken(keyCode, token)`

### 戻り値

```javascript
{ expire: number, passCode: string, user: string, sessionId: string }
```

改ざん・不正なトークンの場合は `Error` をthrowします(stepCode不一致・文字列長異常等)。

---

## 依存・注意事項

- `convb.js` に依存(`$loadLib("convb.js")`)。
- 乱数(`rand.next()`)は自前定義せず、`lambda/src/index.js`が用意するグローバル`rand`をそのまま利用します(詳細は上記「gasAuthSig.js / gasAuth.js における乱数について」参照)。

---

# ◆◆◆ gasAuth.js ◆◆◆

GAS(Google Apps Script)へ認証アクセスして、GASのユーザー(Googleメールアドレス)のOAuth認証・取得を行うためのモジュールです。

GASの `doGet` に対して `fetch`/`XMLHttpRequest` でアクセスすると、GASはCORSのpreflight(OPTIONS)に対応していないためブラウザ側でレスポンスの読み取りがブロックされます。またLambda(サーバー側)からGASへ直接httpClient等でアクセスしても、GASのログイン判定は「ブラウザに紐づくGoogleセッション」を見るため意味がありません。そのため本モジュールのOAuthフローは、ブラウザによる**通常のページ遷移(フルナビゲーション)**でGASのURLへ直接アクセスする方式を採っています(fetch/XHR/JSONPは使わない)。GAS側は認証結果をHtmlService経由の `top.location` リダイレクトでcallbackURLへ返却します(詳細は `docs/gasAuth.md` 参照)。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.allowAccountDataURL()` | GASに対してアカウントデータ利用許可をするためのURLを生成 |
| `exports.executeOAuthURL(request, callbackPath)` | GASのOAuth用URLを生成(呼び出し元でリダイレクトが必要) |
| `exports.redirectToOAuth(request, response, callbackPath)` | 未ログイン判定箇所からURL生成+リダイレクトまでまとめて実行するヘルパー |
| `exports.getOAuthMail(request)` | GASからのOAuthコールバックを検証し、認証済みメールアドレスを取得 |
| `exports.encodeRedirectUrlParams(url)` | リダイレクトURLのパラメータをURLエンコードし直すユーティリティ |

---

## `executeOAuthURL(request, callbackPath)` / `redirectToOAuth(request, response, callbackPath)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `request` | `object` | `$request()` に相当するリクエスト情報 |
| `response` | `object` | `redirectToOAuth` のみ必要。`$response()` に相当するレスポンス情報 |
| `callbackPath` | `string` | GASからのOAuth結果を受け取るアプリ側のパス(例: `"/resultOAuth"`)。必須 |

`redirectToOAuth` は現在アクセスしようとしていたパス(`request.path()`)を自動的に `srcURL` として使いGASへリダイレクトします。`executeOAuthURL` は `request.params().srcURL` があればそれを使い、URLの生成のみ行うため呼び出し側でリダイレクト処理が必要です。

### 使用例

```javascript
const gasAuth = $loadLib("gasAuth.js");

// フィルターで未ログイン判定した場合
gasAuth.redirectToOAuth($request(), $response(), "/resultOAuth");
```

## `getOAuthMail(request)`

callbackPathでGASから返ってきたコールバック(`request.params()` に `mail`/`redirectToken`/`type`/`tokenKey` 等を含む)を検証し、認証済みメールアドレスを返却します。検証失敗時は `HttpError`(status 401/403)をthrowします。セッション生成等のログイン処理自体はこの関数では行わないため、呼び出し元で取得したメールアドレスを使って任意のログイン処理を行う必要があります。

### 使用例

```javascript
// callbackPath側(例: /resultOAuth)
const mail = gasAuth.getOAuthMail($request());
// mail を使ってセッション生成等のログイン処理を行う(session.js等)
```

---

## 依存・注意事項

- `gasAuthSig.js`(内部で`convb.js`に依存)を利用(`$loadLib("gasAuthSig.js")`)。
- 必須環境変数: `GAS_AUTH_URL`(問い合わせ先のGAS認証URL)、`ALLOW_GAS_AUTH_KEY_CODE`(GAS OAuth用KeyCode)。任意環境変数: `GAS_OAUTH_TOKEN_KEY_LENGTH`(tokenKey長、デフォルト19、範囲8〜128)、`GAS_OAUTH_TOKEN_KEY_EXPIRE`(tokenKeyのexpire値・分、デフォルト30、範囲1〜1440)。
- 乱数(`rand.next()`)は自前定義せず、`lambda/src/index.js`が用意するグローバル`rand`をそのまま利用します。
- コールバック(`redirectToken`/`tokenKey`/`mail`)は署名(HMAC)の整合性チェックだけでなく、`tokenKey` に埋め込まれたexpire値の期限切れチェックも行われます(コールバックのクエリパラメータ一式が漏洩した場合の無期限なりすましログイン再利用を防ぐための対策)。

---

# ◆◆◆ session.js ◆◆◆

S3ベースのセッション管理を行う共通モジュールです。

`conf/session.json`(`{bucket, prefix, timeoutMin, samesite, region}`)を読み込んで自動的に初期化されるため、呼び出し側でbucket等を指定して `create()` する必要は無く、`$loadLib("session.js")` した結果をそのままモジュールとして使います。`modules/s3table/s3sdk.js` に依存しています(AWS-SDK-V3利用)。

> AIメモ: 以前は `exports.create(options)` で呼び出し毎にbucket等を明示指定するファクトリ方式だったが、`admin.js` 等の他モジュールから「設定不要でそのまま呼べる」ことを前提に使いたいケースが出てきたため、`conf/session.json` から自動的に設定を読み込む方式に変更した(`create()` は廃止)。設定は初回利用時に一度だけ `$loadConf()` し、以降はキャッシュする。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.start(userId, userData)` | 新規セッションを開始し、セッションIDを返却 |
| `exports.get(sid)` | セッションを取得(期限切れの場合はnullを返却し自動削除) |
| `exports.destroy(sid)` | セッションを破棄 |
| `exports.count()` | 有効セッション数を取得 |
| `exports.setCookie(userId, userData)` | 新規セッションを開始し、CookieにSIDを設定 |
| `exports.destroyCookie()` | ログアウト用。Cookieからセッションを取得してS3側も破棄した上でCookieもクリア |
| `exports.getCookie()` | requestのCookieからセッションIDを取得し、セッション情報を返却 |

---

## `setCookie(userId, userData)` / `getCookie()` / `destroyCookie()`

ログイン処理・ページ処理から主に使うのはこの3つです。

### 使用例

```javascript
const session = $loadLib("session.js");

// ログイン成功時
await session.setCookie(userId, { role: "user" });

// 認証が必要なページの先頭
const ses = await session.getCookie();
if (ses == null) {
    // 未ログイン処理
}

// ログアウト
await session.destroyCookie();
```

## `start` / `get` / `destroy` / `count`

Cookieを介さずセッションIDを直接扱いたい場合に利用します。

```javascript
const sid = await session.start(userId, { role: "user" });
const ses = await session.get(sid); // { userId, data }
await session.destroy(sid);
const n = await session.count();
```

---

## 依存・設定・注意事項

- 依存モジュール: `modules/s3table/s3sdk.js`(`$loadLib("s3sdk.js")`)。
- `conf/session.json`:
  - `bucket`(必須) — S3バケット名
  - `prefix`(省略時 `"sessions/"`)
  - `timeoutMin`(省略時30分。ミリ秒に変換して保持)
  - `samesite`(省略時 `"lax"`) — CookieのSameSite属性
  - `region`/`credentials` — S3接続オプション
- 環境変数 `MINTO_COOKIE_SESSION_NAME`(省略時 `"minto_sid"`) — Cookie名を変更可能。
- llrtでは `for-await-of` 構文が利用できないため、S3レスポンスのStream変換は `transformToString()` を利用しています。
- `getCookie()` は1リクエスト内でキャッシュされます(`$cache()`)。`setCookie`/`destroyCookie` 呼び出し時にこのキャッシュはクリアされます。

---

# ◆◆◆ admin.js ◆◆◆

管理者情報を管理する機能です。「管理者となるユーザID(メールアドレス等)」を登録し、ログインユーザが管理者かどうかを判定できるようにするモジュールです。これにより「管理者=管理者メニュー」のような仕組みを実現できます。

管理者情報はS3に暗号化(AES-256-GCM)して保存されます。初期の1人の管理者は環境変数で定義でき、そのユーザが他の管理者を割り当てる形で利用します。`modules/s3table/s3sdk.js` と `session.js` に依存しています。

> AIメモ: llrtの `node:crypto` は `createCipheriv`/`createDecipheriv` を未サポートのため、`globalThis.crypto.subtle`(WebCrypto)によるAES-256-GCM暗号化を利用しています。暗号化キー文字列はSHA-256でハッシュ化して32byteの生鍵にしています(`crypto.subtle.importKey` がAES-256-GCM用に正確に32byteの鍵を要求するため)。環境変数 `ADMIN_ENCRYPT_KEY` が未設定の場合はデフォルトキー文字列を使いますが、これは「意図せず弱い鍵のまま運用される」ことを許容する設計のため、本番運用では必ず設定すること。初期管理者(環境変数 `MINTO_ADMIN_INITIAL_MAIL`)はS3側の管理者一覧には含まれず、`removeAdmin` で除外することもできません(env設定を変更しない限り常に管理者)。`isAdmin()` で `mail` を省略した場合は `session.js` の `getCookie()` でログイン中ユーザを取得しそのuserIdでチェックします。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.create(options)` | 管理者ストアを生成(`{isAdmin, addAdmin, removeAdmin, listAdmins}` を持つオブジェクトを返却) |

`session.js` と異なり、`admin.js` は利用の都度 `create(options)` でストアを生成するファクトリ方式です。

### `create(options)` の引数

| 引数 | 型 | 説明 |
|---|---|---|
| `options.bucket` | `string` | 対象のS3バケット名(必須) |
| `options.prefix` | `string` | 保存先prefix(デフォルト `"admins/"`) |
| `options.encryptKey` | `string` | 暗号化キー文字列(省略時は環境変数 `ADMIN_ENCRYPT_KEY`、それも無い場合はデフォルトキー) |
| `options.initialAdmin` | `string` | 初期管理者のメールアドレス(省略時は環境変数 `MINTO_ADMIN_INITIAL_MAIL`) |
| `options.region` / `options.credentials` | | S3接続用オプション |

### 返却オブジェクトのメソッド

| メソッド | 説明 |
|---|---|
| `isAdmin(mail)` | 指定メールアドレスが管理者かどうかを判定(`mail` 省略時は `session.js` のログイン中ユーザで判定) |
| `addAdmin(mail)` | 管理者を追加(初期管理者、または既に登録済みの場合は何もしない) |
| `removeAdmin(mail)` | 管理者を削除(未登録の場合は何もしない。初期管理者は削除不可) |
| `listAdmins()` | 登録されている管理者一覧(メールアドレスの配列。初期管理者を含む)を取得 |

### 使用例

```javascript
const admin = $loadLib("admin.js").create({ bucket: "my-bucket" });

if (await admin.isAdmin()) {
    // ログイン中ユーザが管理者の場合の処理
}

await admin.addAdmin("new-admin@example.com");
const list = await admin.listAdmins();
```

---

## 依存・注意事項

- 依存モジュール: `modules/s3table/s3sdk.js`(`$loadLib("s3sdk.js")`)、`session.js`(`$loadLib("session.js")`、`isAdmin()` で `mail` 省略時に利用)。
- `session.js` は `conf/session.json` を自身で自動読み込みするため、`admin.js` 側でセッション用の設定を意識する必要はありません。
- llrtでは `for-await-of` 構文が利用できないため、S3レスポンスのStream変換は `transformToString()` を利用しています。
- 管理者一覧はリクエスト内で `$cache()` にキャッシュされ、`addAdmin`/`removeAdmin` 実行時にクリアされます。

# ◆◆◆ EOF ◆◆◆
