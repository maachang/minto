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

# ◆◆◆ EOF ◆◆◆
