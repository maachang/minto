# ◆◆◆ response.js ◆◆◆

JSONレスポンス/エラーレスポンス組み立てヘルパーです。`public/*.mt.js` から呼び出して利用します。

`lambda/src/index.js` の `$response()` をラップし、`.mt.js` 側で毎回書きがちな以下の定型処理を共通化しただけのものです。

```javascript
$response().contentType("application/json", "utf-8");
$response().status(status);
$response().body(JSON.stringify(data));
```

`$response()` 自体を直接使うことも何ら制限されません(併用可能)。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.json(data, status)` | 正常系JSONレスポンスを組み立てる |
| `exports.error(status, message, extra)` | エラー系JSONレスポンスを組み立てる |

---

## `json(data, status)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `data` | `any` | レスポンスbodyとして返却するJSオブジェクト |
| `status` | `number` | HTTPステータスコード(省略時デフォルト200) |

### 戻り値

なし(`$response()` に対してcontentType/status/bodyを直接設定する)。

### 使用例

```javascript
const response = $loadLib("response.js");

response.json({ id: 1, name: "Alice" });       // status: 200
response.json({ id: 1, name: "Alice" }, 201);  // status: 201
```

---

## `error(status, message, extra)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `status` | `number` | HTTPステータスコード(例: 400, 404, 500) |
| `message` | `string` | エラーメッセージ |
| `extra` | `object` | エラーレスポンスにマージする追加フィールド(省略可。例: `{ code: "INVALID_PARAM" }`) |

内部的には `{ ...extra, error: message }` というbodyを組み立てて `exports.json(body, status)` を呼び出します(`extra` に `error` キーを含めても `message` で上書きされます)。

### 戻り値

なし(`exports.json` と同様に `$response()` を直接更新する)。

### 使用例

```javascript
const response = $loadLib("response.js");

response.error(400, "パラメータが不正です");
response.error(404, "対象が見つかりません", { code: "NOT_FOUND" });
```

---

## 依存・注意事項

- 依存モジュールは無し(`$response()` グローバル関数のみ利用)。
- `json()`/`error()` はいずれも戻り値を返さず、`$response()` の状態を直接書き換える副作用のみを持ちます。

---

# ◆◆◆ multipart.js ◆◆◆

multipart/form-data パーサーです。`public/*.mt.js` から呼び出して利用します。

`$request().body()` で取得した生Buffer + `content-type` ヘッダーのboundaryを使ってパースし、テキストフィールドは文字列、ファイルフィールドは `{filename, contentType, data(Buffer)}` を持つオブジェクトにまとめて返却します。

> AIメモ: 方針合意済みの割り切り仕様として、サイズ上限チェックは行わず(呼び出し側でContent-Length等を見て制御する前提)、同名フィールドが複数ファイルを持つケース(配列)にも対応しません(1フィールド1ファイル想定。同名パートが複数来た場合は最後のものが上書きで残ります)。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.parse(request)` | multipart/form-dataリクエストをパース |

---

## `parse(request)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `request` | `object` | `$request()` に相当するリクエスト情報 |

### 戻り値

`{フィールド名: 文字列 または {filename, contentType, data}}` — `content-type` が `multipart/form-data` 以外、またはboundary未指定の場合は空オブジェクト `{}`。

### 使用例

```javascript
const multipart = $loadLib("multipart.js");

const fields = multipart.parse($request());
// fields.username -> "taro"(テキストフィールド)
// fields.avatar   -> { filename: "photo.jpg", contentType: "image/jpeg", data: Buffer }
```

---

## 依存・注意事項

- 依存モジュールは無し。
- `$request().body()` は常にBufferで生バイナリを返す(GET以外)前提で実装しています。
- **重要な制約**: AWS Lambda Function URLsは同期呼び出しのため、リクエスト/レスポンスペイロードは各6MB制限です(AWS公式ドキュメント「Invocation payload (synchronous)」参照。デプロイパッケージの50MB制限とは別物なので混同しないこと)。base64エンコード(`isBase64Encoded:true`)時はオーバーヘッド(約+33%)を差し引くため、本モジュールで実質扱えるファイルサイズは目安4.5MB程度が上限です。これを超える大きいファイルのアップロードには対応できないため、S3署名付きURL(presigned URL)でクライアントから直接S3へアップロードする方式への切替を検討してください。

---

# ◆◆◆ EOF ◆◆◆
