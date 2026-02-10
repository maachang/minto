# minto Lambda ハンドラー (`lambda/src/index.js`) ドキュメント

## 概要

`minto` は AWS Lambda 上で動作する軽量な Web アプリケーションフレームワークのコアモジュールです。Lambda の Function URL からの HTTP リクエストを受け取り、動的な JavaScript 実行（`.mt.js` / `.jhtml.js`）と静的ファイル配信の両方を単一のハンドラーで処理します。

---

## アーキテクチャ

```
HTTP Request (Lambda Function URL)
        │
        ▼
  exports.handler()
        │
        ├─ favicon.ico → 専用処理（フィルター非経由）
        │
        ├─ /filter パス or .mt.js 等の直接アクセス → 403 Forbidden
        │
        ├─ filter.mt.js が存在 → フィルター実行
        │       │
        │       ├─ true 返却 → 処理続行
        │       └─ それ以外 → フィルター結果で応答
        │
        ├─ 拡張子なし or .jhtml → 動的 JS 実行 (_responseRunJs)
        │
        └─ その他拡張子 → 静的ファイル配信 (_responseStaticFile)
```

---

## ディレクトリ構成

ベースパス（デフォルト: `process.cwd()`）配下に以下のディレクトリが想定されています。

| ディレクトリ | 説明 |
|---|---|
| `public/` | 静的ファイル・動的実行ファイル（`.mt.js`, `.jhtml.js`）の配置先 |
| `lib/` | `$loadLib()` で読み込むライブラリ群 |
| `conf/` | `$loadConf()` で読み込む JSON 設定ファイル（`mime.json`, `etags.json` 等） |

---

## エントリポイント

### `exports.handler(event, context)`

Lambda のメインハンドラー（async 関数）。第3引数の `callback` スタイルは非サポート。

**処理フロー:**

1. 内部状態（request / response / mime / etag キャッシュ）を初期化
2. `favicon.ico` リクエストの場合、フィルターを経由せず専用処理で即時返却
3. `/filter` パスや `.mt.js` / `.jhtml.js` / `.mt.html` への直接アクセスは **403** で拒否
4. `public/filter.mt.js` が存在する場合、フィルター処理を実行
5. 拡張子に応じて動的実行 or 静的ファイル配信に分岐

---

## ファイル種別と拡張子規則

| 拡張子 | 種別 | 説明 |
|---|---|---|
| `.mt.js` | 動的実行 JS | サーバーサイド JavaScript。`handler()` 関数を export する |
| `.jhtml.js` | JHTML 変換済み JS | JHTML テンプレートから変換された実行用 JS |
| `.mt.html` | JHTML ソース | JHTML 変換前のテンプレートソース |
| その他 | 静的ファイル | MIME タイプに基づいて配信 |

---

## 静的ファイル配信 (`_responseStaticFile`)

- パス末尾が `/` の場合、`index.html` → `index.htm` の順に探索
- **ETag キャッシュ**: `conf/etags.json` に定義された ETag 値とリクエストの `If-None-Match` ヘッダを比較し、一致すれば `304 Not Modified` を返却
- **Gzip 対応**: ファイル名 + `.gz` の事前圧縮ファイルが存在すればそちらを優先配信。存在しなくても MIME 定義で `gz: true` のファイルはオンザフライで gzip 圧縮して返却
- レスポンスボディは Base64 エンコードで返却（`isBase64Encoded: true`）

---

## 動的 JS 実行 (`_responseRunJs`)

- 拡張子なしの URL → `public/{path}.mt.js` を実行
- 拡張子 `jhtml` の URL → `public/{path}.jhtml.js`（変換済み）または `public/{path}.mt.html`（変換前 + 変換関数）を実行
- JS ファイルは `Function` コンストラクタで動的に評価される（`require` は直接利用不可）
- 実行対象ファイルは `handler()` 関数を export する必要がある
- `handler()` の戻り値がレスポンスボディとなる（`$response()` で詳細制御も可能）
- レスポンスのボディ型に応じて Content-Type が自動判定される:

| Body の型 | デフォルト Content-Type |
|---|---|
| `string` | jhtml: `text/html` / その他: `application/json` |
| `Buffer` / `TypedArray` / `ArrayBuffer` | `application/octet-stream`（Base64 エンコード） |
| `object` | `application/json`（`JSON.stringify`） |
| その他 | `text/plain`（空文字） |

---

## フィルター機能 (`filter.mt.js`)

`public/filter.mt.js` が存在する場合、すべてのリクエスト（favicon.ico を除く）に対して事前実行されます。

- `handler()` が `true` を返却 → メイン処理に続行
- `true` 以外 or `$response()` で応答設定 → その内容で応答して終了
- `$response()` 未使用かつ `true` 以外の返却 → **403 Forbidden**

認証チェックやアクセス制御などに活用されます。

---

## グローバル関数・オブジェクト

動的 JS（`.mt.js` / `.jhtml.js`）内では `global` に登録された以下の関数が利用可能です。

### リクエスト / レスポンス

| 関数 | 説明 |
|---|---|
| `$request()` | Request オブジェクトを取得 |
| `$response()` | Response オブジェクトを取得 |

### ロード系

| 関数 | 説明 |
|---|---|
| `$loadLib(name)` | `lib/` ディレクトリから JS モジュールを `require` |
| `$loadConf(name)` | `conf/` ディレクトリから JSON 設定を `require`（存在しなければ `null`） |
| `$require(name)` | `require` の代替。パスを含む場合はベースパスからの相対、パスなしは標準ライブラリ |

### ユーティリティ

| 関数 | 説明 |
|---|---|
| `$getNow()` | ミリ秒 + ナノ秒を独自 Base64 エンコードした時刻文字列を返却 |
| `$requestId()` | Lambda の `awsRequestId`（UUID）を返却 |
| `$mime(ext, all)` | 拡張子から MIME タイプを取得。`all=true` で定義全体を返却 |

### エラー / ランダム

| 名前 | 説明 |
|---|---|
| `HttpError` | HTTP エラー用のクラス（`status`, `message`, `error` を保持） |
| `createRandom(seed)` | Xor128 アルゴリズムの乱数生成関数を返却 |
| `rand` | デフォルトの乱数生成関数インスタンス |

---

## Request オブジェクト (`$request()`)

Lambda Function URL の `event` オブジェクトをラップし、各値をキャッシュ付きで提供します。

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `path()` | `string` | URL パス。末尾 `/` の場合は `/index` を付与 |
| `extends()` | `string` | パスの拡張子（小文字） |
| `method()` | `string` | HTTP メソッド（大文字） |
| `headers()` | `object` | リクエストヘッダ（全キー小文字） |
| `header(key)` | `string\|null` | 指定キーのヘッダ値 |
| `cookies()` | `object` | Cookie をパースした `{key: value}` |
| `cookie(key)` | `string\|null` | 指定キーの Cookie 値 |
| `protocol()` | `string` | HTTP プロトコル |
| `urlParams()` | `object` | クエリ文字列パラメータ |
| `params()` | `object` | GET: クエリパラメータ / POST: ボディ解析結果（JSON, form-urlencoded 対応） |
| `body()` | `Buffer\|null` | リクエストボディ（生バイナリ）。GET の場合は `null` |

---

## Response オブジェクト (`$response()`)

レスポンスを組み立てるためのビルダーオブジェクトです。

| メソッド | 説明 |
|---|---|
| `status(code, message)` | HTTP ステータスコードとメッセージを設定 |
| `header(key, value)` | レスポンスヘッダを設定（キーは小文字に正規化） |
| `headers.get(key)` | ヘッダ値を取得 |
| `headers.keys()` | ヘッダキー一覧を取得 |
| `headers.put(key, value)` | ヘッダ設定（`header()` と同等） |
| `headers.remove(key)` | ヘッダを削除 |
| `cookie(key, value)` | Cookie を設定。`value` は文字列（`"val; Max-Age=3600; Secure"`）またはオブジェクト |
| `body(data)` | レスポンスボディを設定 |
| `contentType(mime, charset)` | Content-Type を設定 |
| `redirect(url, params, status)` | リダイレクト応答を設定（デフォルト 301） |

### Cookie の設定例

```javascript
// 文字列形式
$response().cookie("session", "abc123; Max-Age=2592000; Secure");

// オブジェクト形式
$response().cookie("session", {
    value: "abc123",
    "Max-Age": 2592000,
    Secure: true
});
```

未指定の場合、`SameSite=Lax` が自動付与されます。

---

## HttpError クラス

動的 JS 内で HTTP エラーを throw するためのカスタムエラークラスです。

```javascript
throw new HttpError({
    status: 404,
    message: "Not Found",
    error: originalError  // オプション
});
```

| メソッド | 説明 |
|---|---|
| `getStatus()` | HTTP ステータスコード |
| `getMessage()` | エラーメッセージ |
| `getError()` | 元のエラーオブジェクト（オプション） |

---

## ETag キャッシュ (`etags.json`)

`conf/etags.json` に以下の形式で定義すると、静的ファイルおよび favicon.ico で ETag ベースのキャッシュ制御が有効になります。

```json
{
    "/style.css": "W/\"abc123\"",
    "/favicon.ico": "W/\"ico001\"",
    "/images/logo.png": "W/\"logo1\""
}
```

リクエストの `If-None-Match` ヘッダと一致した場合、ボディなしの `304 Not Modified` を返却します。

---

## MIME 拡張 (`mime.json`)

組み込み MIME 定義（txt, html, css, js, json, gif, jpg, png, ico 等）に加え、`conf/mime.json` で追加定義が可能です。

```json
{
    "svg": { "type": "image/svg+xml", "gz": true },
    "woff2": { "type": "font/woff2", "gz": false },
    "mp4": { "type": "video/mp4", "gz": false }
}
```

`gz: true` の拡張子は、オンザフライ gzip 圧縮の対象となります。

---

## エクスポートされた設定関数

| 関数 | 説明 |
|---|---|
| `exports.setBasePath(path)` | ベースパスを変更（デフォルト: `process.cwd()`） |
| `exports.setJHTMLConvFunc(func)` | JHTML → JS 変換関数を設定（`.mt.html` をランタイムで変換する場合に使用） |
| `exports.clearCache()` | 内部キャッシュをクリア（ローカル実行・テスト用） |

---

## セキュリティ上の考慮事項

- `.mt.js`, `.jhtml.js`, `.mt.html` ファイルへの直接 HTTP アクセスは **403** で拒否される
- `/filter` パスへの直接アクセスも **403** で拒否される
- 動的 JS のレスポンスには常にキャッシュ無効化ヘッダが付与される（`Cache-Control: no-cache`, `Pragma: no-cache`, `Expires: -1`）
- 動的 JS は `Function` コンストラクタによるサンドボックス実行（ただし `global` へのアクセスは可能）

---

## 動的 JS（`.mt.js`）の実装例

```javascript
// public/api/hello.mt.js
// URL: /api/hello でアクセス可能

exports.handler = async function() {
    const req = $request();
    const name = req.params().name || "World";
    
    // JSON で応答（戻り値がオブジェクトの場合自動的に JSON.stringify）
    return { message: "Hello, " + name + "!" };
};
```

```javascript
// public/api/auth-check.mt.js
// フィルターの例（public/filter.mt.js）

exports.handler = async function() {
    const req = $request();
    const token = req.header("authorization");
    
    if (!token) {
        $response().status(401, "Unauthorized");
        return;
    }
    
    // true を返却して後続処理を続行
    return true;
};
```