# ◆◆◆ validate.js ◆◆◆

汎用オブジェクトバリデーターです。

`$request().params()` で取得したリクエストパラメータに限らず、任意のJSオブジェクトを対象に、フィールド単位のスキーマ定義に沿って検証します。型システムは `modules/s3table/s3MasterTable.js` / `s3IndexTable.js` と共通の `string`/`int`/`float`/`boolean`/`date` の5種類のみをサポートします(json/array/ネストオブジェクトは対象外)。

GETリクエストの `$request().params()`(=queryStringParameters)は値がすべて文字列で渡ってくるため、`int`/`float` は数値型に加えて「数字として妥当な文字列」(例: `"20"`, `"-1.5"`)も型チェックOKとします(値そのものは文字列のまま保持し、数値へは変換しません。min/maxの範囲比較のみ内部で数値化して行います)。`boolean`/`date` は文字列を許容しません(`true`/`false` や日付文字列の解釈は曖昧さがあるため、呼び出し側で事前に `Boolean`/`Date` へ変換する必要があります)。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.check(data, schema)` | `data` を `schema` に従って検証する |

---

## `check(data, schema)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `data` | `object` | 検証対象のJSオブジェクト(`undefined`/`null` の場合は `{}` として扱われる) |
| `schema` | `object` | `{ フィールド名: ルール定義 }` の形式。ルール定義の各プロパティは後述 |

### スキーマのルール定義

| プロパティ | 型 | 説明 |
|---|---|---|
| `type` | `string` | `"string"` / `"int"` / `"float"` / `"boolean"` / `"date"` のいずれか(未指定はチェックスキップ) |
| `required` | `boolean` | `true` の場合、値が無い(undefined/null)とエラー |
| `default` | `any \| function` | 値が無い場合に補完するデフォルト値。関数の場合はその戻り値を使う |
| `minLen`/`maxLen` | `number` | 文字列長の範囲チェック(`type: "string"` のみ) |
| `min`/`max` | `number \| Date` | 数値・日付の範囲チェック(`type: "int"/"float"/"date"` のみ) |
| `pattern` | `RegExp` | 正規表現チェック(`type: "string"` のみ) |
| `enum` | `array` | 許可される値の一覧 |
| `custom` | `function(value, data)` | カスタム検証。`false` を返すとエラー、文字列を返すとそれをエラーメッセージとして採用 |
| `messages` | `object` | ルール名ごとのエラーメッセージ上書き(例: `{ required: "名前は必須です" }`) |

### 検証順序と挙動

- 値が無い(データにキー自体が無い、または`undefined`/`null`)場合: `required` チェック → `default` 補完 → いずれも無ければそのまま許容、という順で以降のチェックはスキップされます。
- 値がある場合: `type` → `minLen`/`maxLen`(string) → `min`/`max`(int/float/date) → `pattern`(string) → `enum` → `custom` の順にチェックし、**1フィールドにつき最初に失敗したルールのみ**を `errors` に積みます(同一フィールドで複数エラーは重ねません)。
- スキーマに定義の無いプロパティはチェック対象外で、そのまま `data` に素通りします(strictチェックは行いません)。

### 戻り値

```javascript
{
  valid: boolean,               // errorsが空ならtrue
  errors: [
    { field: string, rule: string, message: string },
    ...
  ],
  data: object                  // default値を補完したオブジェクト(元のdataは変更しない)
}
```

### 使用例

```javascript
const validate = $loadLib("validate.js");

const result = validate.check(data, {
  name: {
    type: "string", required: true, minLen: 1, maxLen: 50,
    messages: { required: "名前は必須です" }
  },
  age: { type: "int", min: 0, max: 150 },
  email: { type: "string", pattern: /^[^@]+@[^@]+$/ },
  role: { type: "string", enum: ["admin", "user"], default: "user" }
});

if (!result.valid) {
    // result.errors: [{ field, rule, message }, ...]
    throw new Error(result.errors[0].message);
}
// result.data にdefault値補完済みのオブジェクトが入る
```

---

## 依存・注意事項

- 依存モジュールは無し(`$loadLib` による他モジュール依存無し)。
- 対応する `type` は `string`/`int`/`float`/`boolean`/`date` の5種類のみです。`json`/`array`/ネストオブジェクトのスキーマ検証はサポートされません。
- GETパラメータ由来の文字列値を想定し、`int`/`float` は数字表記の文字列も型OKとしますが、値そのものは数値へ変換されません(必要なら呼び出し側で変換すること)。
- `boolean`/`date` は文字列を一切許容しません。呼び出し側で事前に型変換する必要があります。
- 未知の `type` を指定した場合は `Error("Unknown type: " + type)` がthrowされます。

# ◆◆◆ EOF ◆◆◆
