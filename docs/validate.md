# validate.js（汎用オブジェクトバリデーター）

`modules/validate/validate.js`は、`$request().params()`で取得したリクエスト
パラメータに限らず、任意のJSオブジェクトをフィールド単位のスキーマ定義に
沿って検証するための小さなユーティリティです。POST APIの入力チェックを、
手書きのif文の羅列ではなく宣言的なスキーマとして書けるようにします。

## なぜ使うのか

素朴に書くと、入力チェックはこうなりがちです。

```js
const p = req.params();
if (!p.userId || p.userId.length < 3) {
    return { success: false, message: "..." };
}
if (!p.password || p.password.length < 4) {
    return { success: false, message: "..." };
}
// ...フィールドが増えるほどif文が増殖する.
```

`validate.check(data, schema)`は、これをスキーマ定義にまとめます。

```js
const validate = $loadLib("validate.js");
const result = validate.check(p, {
    userId: { type: "string", required: true, minLen: 3, maxLen: 32 },
    password: { type: "string", required: true, minLen: 4 }
});
if (!result.valid) {
    return { success: false, message: result.errors[0].message };
}
```

## サポートする型

`modules/s3table/s3MasterTable.js`・`s3IndexTable.js`と共通の
`string` / `int` / `float` / `boolean` / `date` の5種類のみをサポートします
(json/array/ネストオブジェクトは対象外)。

GETリクエストの`$request().params()`(`event.queryStringParameters`)は値が
全て文字列で渡ってくるため、`int`/`float`は数値型に加えて「数字として妥当な
文字列」(例: `"20"`, `"-1.5"`)も型チェックOKとして扱います。値そのものは
文字列のまま保持され、数値へは変換しません(`min`/`max`の範囲比較のみ内部で
数値化して行います)。`boolean`/`date`は文字列を許容しないため、真偽値表現や
日付文字列を検証したい場合は、呼び出し側で事前に`Boolean`/`Date`へ変換して
から`validate.check()`に渡してください。

## スキーマで指定できるルール

| ルール | 内容 |
|---|---|
| `type` | `string`/`int`/`float`/`boolean`/`date` のいずれか |
| `required` | `true`の場合、値が無い(undefined/null)とエラー |
| `default` | 値が無い場合に補完する値(関数の場合は呼び出し結果を使う) |
| `minLen`/`maxLen` | 文字列長の範囲(`type: "string"`限定) |
| `min`/`max` | 数値・日付の最小・最大(`type: "int"/"float"/"date"`限定) |
| `range` | 数値・日付の範囲。`[min, max]` または `{ min, max }` (`type: "int"/"float"/"date"`限定) |
| `mail` | `true`の場合、メールアドレス形式チェック(`type: "string"`限定) |
| `url` | `true`の場合、http/https URL形式チェック(`type: "string"`限定) |
| `zip` | `true`の場合、郵便番号形式チェック(ハイフン有無両対応、`type: "string"`限定) |
| `tel` | `true`の場合、電話番号形式チェック(固定・携帯・0120・0800・050等、ハイフン有無両対応、`type: "string"`限定) |
| `date` | `true`の場合、日付形式チェック(`yyyy-MM-dd` / `yyyy/MM/dd`、閏年・月日数も検証、`type: "string"`限定) |
| `time` | `true`の場合、時間形式チェック(`HH:mm` / `HH:mm:ss`、`type: "string"`限定) |
| `alphaNum` | `true`の場合、半角英数字チェック(`type: "string"`限定) |
| `pattern` | 正規表現(`type: "string"`限定) |
| `enum` | 許可する値のリスト |
| `custom(value, data)` | カスタム検証関数。`false`を返すとエラー、文字列を返すとそれがそのままエラーメッセージになる。`data`には検証対象オブジェクト全体が渡されるため、パスワード確認欄の一致チェックのようなフィールド間の相関チェックに使える |
| `messages` | ルール名ごとのカスタムエラーメッセージ(`{ required: "...", range: "...", mail: "..." }`) |

1フィールドにつき、最初に失敗したルールのみが`errors`に積まれます
(同一フィールドで複数エラーを重ねて出しません)。

## 戻り値

```js
{
    valid: boolean,
    errors: [{ field, rule, message }],
    data: { ... } // default値を補完したオブジェクト(元のdataは変更しない)
}
```

スキーマに定義の無いプロパティは検証対象外で、そのまま`data`に素通りします
(strictチェックは行いません)。

## 使い方（最小構成）

`$loadLib`はプロジェクトの`lib/`配下のみを検索する仕様のため、
`modules/validate/validate.js`をプロジェクトから使うには`lib/validate.js`に
以下のような再エクスポートスタブを1つ置くだけで良いです
(実体は1箇所(`modules/validate/validate.js`)に集約する)。

```js
// lib/validate.js
module.exports = require("(minto直下からの相対パス)/modules/validate/validate.js");
```

実際に組み込んだ例は
[sample/login-logout/public/api/register.mt.js](https://github.com/maachang/minto/blob/main/sample/login-logout/public/api/register.mt.js)
を参照してください(ユーザーID/パスワード/パスワード確認欄の検証を
`validate.check()`にまとめています)。
