# ◆◆◆ csvReader.js ◆◆◆

CSV文字列を行単位でパース・読み込むためのモジュールです。  
Node.js（CommonJS）とブラウザ環境の両方で動作します。

---

## エクスポート

| 環境 | アクセス方法 |
|---|---|
| Node.js | `const { createCsvReader, readCsv } = require('./csvReader')` |
| ブラウザ | `window.CsvReader.createCsvReader` / `window.CsvReader.readCsv` |

---

## `readCsv(csvString[, options])`

CSV文字列を一括解析し、ヘッダーと行データをJSON形式で返す簡易関数です。

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `csvString` | `string` | 解析対象のCSV文字列 |
| `options` | `object` | オプション（後述） |

### 戻り値

```javascript
{
  headers: ["col1", "col2", ...],   // ヘッダー名の配列
  rows: [
    { col1: "value1", col2: "value2", ... },  // 各行はカラム名をキーとしたオブジェクト
    ...
  ]
}
```

> ⚠️ `readCsv` はすべての値を**文字列**のまま返します。型変換が必要な場合は `createCsvReader` を使用してください。

### 使用例

```javascript
const { readCsv } = require('./csvReader');

const csv = `name,age,active
Alice,30,true
Bob,25,false`;

const result = readCsv(csv);
console.log(result.headers);    // ["name", "age", "active"]
console.log(result.rows[0]);    // { name: "Alice", age: "30", active: "true" }
```

---

## `createCsvReader(csvString[, options])`

行単位でデータを逐次取得するリーダーオブジェクトを生成します。大量データを1行ずつ処理する場合に適しています。

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `csvString` | `string` | 解析対象のCSV文字列 |
| `options` | `object` | オプション（後述） |

### オプション

| プロパティ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `parseCode` | `string` | `","` | 列の区切り文字 |
| `convertFunc` | `function` | 組み込み変換 | 型変換処理をカスタマイズする関数（後述） |
| `headerKeyArray` | `string[]` | `undefined` | CSVにヘッダー行がない場合に指定するカラム名配列 |
| `jsIterator` | `boolean` | `false` | `true` にするとES Iteratorプロトコルで動作 |

### 返却オブジェクトのメソッド（通常モード）

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `hasNext()` | `boolean` | 次の行が存在する場合 `true` |
| `next()` | `CsvRow` | 次の行をCsvRowオブジェクトとして返す。末尾以降の呼び出しはエラー |
| `resetPosition()` | `this` | 読み込み位置を先頭（データ1行目）に戻す |
| `getHeaders()` | `string[]` | ヘッダー名の配列を返す |
| `isJsIterator()` | `boolean` | jsIteratorモードかどうかを返す |

### 返却オブジェクトのメソッド（jsIteratorモード）

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `next()` | `{ value: CsvRow, done: boolean }` | ES Iterator準拠の形式で返す |

### 使用例（通常モード）

```javascript
const { createCsvReader } = require('./csvReader');

const csv = `id,name,price
1,Apple,120
2,Banana,80`;

const reader = createCsvReader(csv);

while (reader.hasNext()) {
  const row = reader.next();
  console.log(row.getString("name"), row.getNumber("price"));
  // Apple 120
  // Banana 80
}
```

### 使用例（ヘッダーなしCSV）

```javascript
const csv = `1,Alice,30
2,Bob,25`;

const reader = createCsvReader(csv, {
  headerKeyArray: ["id", "name", "age"]
});

while (reader.hasNext()) {
  const row = reader.next();
  console.log(row.getNumber("id"), row.getString("name"), row.getNumber("age"));
}
```

### 使用例（カスタム区切り文字）

```javascript
const tsv = `name\tage\tscore
Alice\t30\t95`;

const reader = createCsvReader(tsv, { parseCode: "\t" });

while (reader.hasNext()) {
  const row = reader.next();
  console.log(row.getString("name")); // Alice
}
```

---

## CsvRowオブジェクト

`reader.next()` が返すオブジェクトです。各セルの値を型を指定して取得できます。

引数 `name` にはカラム名（文字列）または列インデックス（数値、0始まり）を指定できます。

### メソッド一覧

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `getString(name)` | `string \| undefined` | 値を文字列として取得 |
| `getNumber(name)` | `number \| undefined` | 値を数値（`parseFloat`）として取得 |
| `getBoolean(name)` | `boolean \| undefined` | 値を真偽値として取得。`"true"` / `"on"` / `"t"` → `true`、それ以外 → `false` |
| `getDate(name)` | `Date \| undefined` | 値を `new Date(value)` で変換して取得 |
| `getJSON(name)` | `any \| undefined` | 値をJSON.parseして取得 |
| `contains(name)` | `boolean` | 指定カラムが存在するか確認 |
| `length()` | `number` | 現在行のセル数を返す |
| `toJSON()` | `object` | 行全体を `{ カラム名: 値, ... }` のオブジェクトとして返す。値はすべて文字列 |

---

## カスタム型変換（`convertFunc`）

`get系メソッド`の変換処理をカスタマイズできます。

```javascript
// 引数: (type: string, value: string) => any
const reader = createCsvReader(csv, {
  convertFunc: (type, value) => {
    if (type === "number") return parseInt(value, 10);  // 整数に限定
    if (type === "string") return value.trim();
    return value;
  }
});
```

`type` に渡される値は `"number"` / `"string"` / `"boolean"` / `"date"` / `"json"` のいずれかです。

---

## パース仕様

- `\r\n`・`\r` は `\n` に正規化してから処理します
- ダブルクォーテーションで囲まれたフィールドは内部の区切り文字・改行を無視します
- `""` はエスケープされたダブルクォーテーション（`"`）として処理します
- 先頭行がヘッダーとして使用されます（`headerKeyArray` 指定時を除く）

# ◆◆◆ csvWriter.js ◆◆◆

CSV文字列を生成・書き込むためのモジュールです。  
Node.js（CommonJS）とブラウザ環境の両方で動作します。

---

## エクスポート

| 環境 | アクセス方法 |
|---|---|
| Node.js | `const { createCsvWriter } = require('./csvWriter')` |
| ブラウザ | `window.csvWriter.createCsvWriter` |

---

## `createCsvWriter(headers[, options])`

カラム定義を受け取り、CSVライターオブジェクトを生成します。  
インスタンス生成時に自動でヘッダー行が出力バッファに書き込まれます。

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `headers` | `string[]` | カラム名の配列。CSVの列順を定義します |
| `options` | `object` | オプション（後述） |

### オプション

| プロパティ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `parseCode` | `string` | `","` | 列の区切り文字 |
| `lineBreak` | `string` | `"\n"` | 改行コード |
| `convertFunc` | `function` | 組み込み変換 | `put()` に渡す値の文字列変換をカスタマイズする関数（後述） |

---

## 返却オブジェクトのメソッド

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `put(key, value)` | `this` | 指定カラムに値をセット。メソッドチェーン可。存在しないカラム名を指定すると `Error` |
| `putRow(values)` | `void` | `{ カラム名: 値, ... }` で一行分の値を一括セット |
| `next()` | `this` | 現在セット中の行をバッファに書き込み、次の行へ進める |
| `getWriteCsv()` | `string` | バッファ全体をCSV文字列として返す（末尾に改行あり） |
| `toString()` | `string` | `getWriteCsv()` と同じ |
| `clear()` | `void` | バッファをリセットし、ヘッダー行を再書き込み |
| `count()` | `number` | 書き込み済みのデータ行数を返す（ヘッダーは含まない） |
| `getHeaders()` | `string[]` | ヘッダー名のコピーを返す |
| `getHeaderLength()` | `number` | カラム数を返す |

---

## 使用例

### 基本的な書き込み

```javascript
const { createCsvWriter } = require('./csvWriter');

const writer = createCsvWriter(["id", "name", "price"]);

writer.put("id", 1).put("name", "Apple").put("price", 120).next();
writer.put("id", 2).put("name", "Banana").put("price", 80).next();

console.log(writer.getWriteCsv());
// id,name,price
// 1,Apple,120
// 2,Banana,80
```

### `putRow` を使った一括セット

```javascript
const writer = createCsvWriter(["id", "name", "price"]);

const data = [
  { id: 1, name: "Apple",  price: 120 },
  { id: 2, name: "Banana", price: 80  },
];

for (const item of data) {
  writer.putRow(item);
  writer.next();
}

console.log(writer.toString());
```

### タブ区切り（TSV）での出力

```javascript
const writer = createCsvWriter(["name", "score"], { parseCode: "\t" });

writer.put("name", "Alice").put("score", 95).next();
writer.put("name", "Bob").put("score", 80).next();

console.log(writer.getWriteCsv());
// name	score
// Alice	95
// Bob	80
```

### バッファのリセット

```javascript
const writer = createCsvWriter(["id", "name"]);

writer.put("id", 1).put("name", "Alice").next();
console.log(writer.count()); // 1

writer.clear();
console.log(writer.count()); // 0（ヘッダーは再書き込み済み）

writer.put("id", 2).put("name", "Bob").next();
console.log(writer.getWriteCsv());
// id,name
// 2,Bob
```

---

## ダブルクォーテーションの自動エスケープ

カンマ・ダブルクォーテーション・タブ・改行を含む値は RFC 4180 に従い自動でクォートされます。  
ダブルクォーテーション自体は `""` にエスケープされます。

```javascript
const writer = createCsvWriter(["name", "comment"]);

writer.put("name", "Alice").put("comment", 'He said, "Hello"').next();

console.log(writer.getWriteCsv());
// name,comment
// Alice,"He said, ""Hello"""
```

---

## デフォルトの型変換ルール

`put()` / `putRow()` に渡した値は以下のルールで文字列に変換されます。

| 型 | 変換結果 |
|---|---|
| `string` / `number` / `boolean` | `String(value)` |
| `Date` | `value.toString()` |
| `null` / `undefined` | `""` (空文字列) |
| その他のオブジェクト | `JSON.stringify(value)` |

カスタム変換が必要な場合は `options.convertFunc` を指定してください。

```javascript
// 引数: (value: any) => string
const writer = createCsvWriter(["id", "date"], {
  convertFunc: (value) => {
    if (value instanceof Date) {
      // ISO 8601形式で出力
      return value.toISOString();
    }
    return value == null ? "" : String(value);
  }
});
```

---

## 注意事項

- インスタンス生成時にヘッダーが自動書き込みされます。`put()` でヘッダー行を手動追加しないでください。
- `put()` に未定義のカラム名を渡すと `Error` がスローされます。
- `next()` を呼ばずに次の行の `put()` を始めると、前の行のデータが上書きされます。必ず1行分のセットが終わったら `next()` を呼んでください。

# ◆◆◆ jsonb.js ◆◆◆

JSオブジェクトをバイナリ形式（JSONB）にシリアライズ・デシリアライズするモジュールです。  
`JSON.stringify` / `JSON.parse` と比較して、GCスパイクを抑えたパフォーマンス重視の設計になっています。

Node.js（CommonJS）・ブラウザ・Google Apps Script（GAS）環境で動作します。

---

## エクスポート

| 環境 | アクセス方法 |
|---|---|
| Node.js | `const { encode, decode } = require('./jsonb')` |
| ブラウザ | `window.jsonb.encode` / `window.jsonb.decode` |

---

## 設計思想

通常の `JSON.stringify` / `JSON.parse` は文字列の生成と大量のメモリ確保を伴うため、リアルタイム処理ではGC（ガベージコレクション）スパイクの原因となります。本モジュールは以下の技術でこれを抑制します。

- **DataViewと事前割り当てバッファの使い回し** — エンコードのたびに `new ArrayBuffer` を行わず、共有の内部バッファ（スクラッチパッド）を再利用することでGCを抑制します
- **BigIntによる64bit整数処理** — JavaScriptの `Number` では精度が失われる64bit整数を `BigInt` で安全に扱います
- **TextEncoder / TextDecoderによる文字列処理** — ネイティブAPIを利用したマルチバイト対応の高速変換を行います

---

## `encode(value)`

JSオブジェクトをバイナリ配列（`Uint8Array`）に変換します。

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `value` | `any` | エンコード対象のJSオブジェクト・プリミティブ |

### 戻り値

`Uint8Array` — エンコードされたバイナリデータ

### ⚠️ スレッドセーフの注意

`encode()` は**スレッドセーフではありません**。内部バッファをモジュールグローバルで共有しているため、Worker Threads等で並行呼び出しするとデータが破損します。並行処理が必要な場合はスレッドごとにモジュールを分離してください。

---

## `decode(bin)`

バイナリ配列（`Uint8Array`）をJSオブジェクトに復元します。

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `bin` | `Uint8Array \| Array` | デコード対象のバイナリデータ |

### 戻り値

`any` — 復元されたJSオブジェクト・プリミティブ

---

## 使用例

```javascript
const { encode, decode } = require('./jsonb');

const original = {
  name: "Alice",
  age: 30,
  scores: [95, 80, 72],
  active: true,
  createdAt: new Date("2024-01-15"),
};

const binary = encode(original);
console.log(binary instanceof Uint8Array); // true

const restored = decode(binary);
console.log(restored.name);      // "Alice"
console.log(restored.age);       // 30
console.log(restored.scores);    // [95, 80, 72]
console.log(restored.active);    // true
console.log(restored.createdAt); // Date オブジェクト
```

---

## 対応データ型

エンコード・デコードで対応している型は以下の通りです。

| JSの型 | 内部表現 | 備考 |
|---|---|---|
| `null` / `undefined` | NULL (1バイト) | どちらも `null` としてエンコード |
| `number` (整数 0〜255) | UINT8 (2バイト) | 値域により最小サイズを自動選択 |
| `number` (整数 0〜65535) | UINT16 (3バイト) | 同上 |
| `number` (整数 ±2^31) | INT32 (5バイト) | 同上 |
| `number` (整数 ±2^63) | LONG (9バイト) | 同上 |
| `number` (浮動小数点) | FLOAT64 (9バイト) | IEEE 754 |
| `string` | STRING (4バイト長 + UTF-8バイト列) | — |
| `boolean` | BOOLEAN (2バイト) | — |
| `Date` | DATE (9バイト) | `getTime()` のミリ秒をLONGで格納 |
| `Array` | ARRAY (要素数 + 各要素) | 再帰的にエンコード |
| `object` | OBJECT (KEY+VALUE の繰り返し + 終端) | 再帰的にエンコード |
| `function` 等 | NULL (1バイト) | 未対応の型はnullとして扱う |

整数値はその値域に応じて UINT8 / UINT16 / INT32 / LONG の最小サイズが自動選択されます。

---

## ⚠️ 注意事項

### 64bit整数の精度

`decodeLong()` の内部で `BigInt` → `Number` 変換を行うため、`Number.MAX_SAFE_INTEGER`（2^53 - 1）を超える整数値は精度が失われます。巨大な整数を精度を保って扱う必要がある場合は、`BigInt` のまま返すよう `decodeLong` 関数を拡張してください。

### オブジェクトキーの長さ制限

オブジェクトのキー（プロパティ名）はUTF-8で **255バイト以内** に切り詰められます。255バイトを超えるキーは使用しないでください。切り詰め位置はマルチバイト文字の境界を考慮して安全に処理されます。

### 非対応の型

`function`、`Symbol`、`Error` などのJavaScript固有のオブジェクトは `null` として扱われます。

### バッファサイズの自動拡張

初期バッファサイズは 1MB です。エンコード対象データがこれを超える場合、内部バッファは自動的に倍増拡張されます（1MB → 2MB → 4MB …）。

---

## GAS（Google Apps Script）対応

GAS環境では `TextEncoder` / `TextDecoder` が未サポートのため、`Utilities.newBlob()` を使ったポリフィルが自動的に適用されます。利用者側での設定は不要です。

# ◆◆◆ memoryTable.js ◆◆◆

メモリ上に列定義付きのテーブルを保持し、INSERT・UPDATE・DELETE・SELECT・検索・ソートなどのDB的な操作をJavaScriptで行えるモジュールです。  
Node.js（CommonJS）とブラウザ環境の両方で動作します。

---

## エクスポート

| 環境 | アクセス方法 |
|---|---|
| Node.js | `const { create, open, setMemoryTableToUtc, getMemoryTableToUtc } = require('./memoryTable')` |
| ブラウザ | `window.memoryTable.create` / `window.memoryTable.open` など |

---

## モジュールレベル関数

### `create(...columns)` — テーブル生成

カラム名を引数に渡してメモリテーブルを生成します。

```javascript
// 個別引数
const tbl = create("id", "name", "age");

// 配列でもOK
const tbl = create(["id", "name", "age"]);
```

### `open(json)` — テーブル復元

`table.save()` で出力した保存オブジェクトからテーブルを復元します。

```javascript
const saved = table.save();
const tbl = open(saved);
```

### `setMemoryTableToUtc(utc)` — グローバルUTC設定

全テーブルのDate出力をUTC（true）またはローカル時刻（false）に設定します。  
テーブルごとに `setUtc()` で個別上書きも可能です。

### `getMemoryTableToUtc()` — グローバルUTC取得

現在のグローバルUTC設定値（`boolean`）を返します。

---

## テーブルオブジェクトのAPI

`create()` または `open()` が返すオブジェクトが持つメソッドです。

---

### カラム設定

#### `setColumnTypes(...args)` — カラムタイプ設定

カラム名とタイプを交互に指定します。設定後はINSERT/UPDATE時に型変換が行われ、SELECT時は指定した型で返却されます。

```javascript
tbl.setColumnTypes(
  "id",        "number",
  "name",      "string",
  "active",    "boolean",
  "birthDate", "date",
  "updatedAt", "timestamp",
  "meta",      "json"
);
```

| タイプ名（省略形） | 内部格納形式 | 取得時の返却型 |
|---|---|---|
| `string` / `str` / `s` | 文字列 | `string` |
| `number` / `num` / `n` | 数値 | `number` |
| `boolean` / `bool` / `b` | 真偽値 | `boolean` |
| `date` / `d` | `yyyyMMdd` 形式の数値（`Date.getTime()`） | `Date` |
| `timestamp` / `tms` / `t` | ミリ秒数値（`Date.getTime()`） | `Date` |
| `json` / `jsn` / `j` / `object` / `obj` / `o` | JSON文字列 or オブジェクト | 解析済みオブジェクト |

#### `getColumnTypes()` — カラムタイプ取得

現在のカラムタイプを `{ カラム名: タイプ名, ... }` 形式で返します。未設定の場合は `null`。

#### `isColumnTypes()` — カラムタイプ設定確認

カラムタイプが設定済みなら `true` を返します。

#### `changeColumnsName(changeNames)` — カラム名変更

```javascript
// { 変更元: 変更先, ... }
tbl.changeColumnsName({ oldName: "newName" });
```

カラム名に紐づくインデックスも同時にリネームされます。変更元が存在しない場合やリネーム後に重複が生じる場合は `false` を返します。

#### `getHeaders()` — ヘッダー一覧取得

カラム名の配列を返します。

---

### UTC設定

#### `setUtc(utc)` — UTC出力設定

`true` を渡すと、このテーブルのDate出力がUTCになります。

#### `isUtc()` — UTC設定確認

現在のUTC設定値（`boolean`）を返します。

---

### インデックス

#### `createIndex(name)` — インデックス生成

指定カラムにインデックスを作成します。`eq()` / `ne()` 検索でインデックスが自動利用されます。

```javascript
tbl.createIndex("id");
tbl.createIndex("name");
```

INSERT / UPDATE / DELETE 実行時は自動で再構築フラグが立ち、次回検索時に最新状態に作り直されます。

#### `getIndexColumns()` — インデックスカラム名一覧

インデックスが設定されているカラム名の配列を返します。

---

### データ操作

#### `insert(values)` — 1行追加

```javascript
tbl.insert({ id: 1, name: "Alice", age: 30 });
```

戻り値: `boolean`（追加成功 → `true`）

#### `insertList(list)` — 複数行追加

```javascript
tbl.insertList([
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
]);
```

#### `update(find, values)` — 行更新

| `find` の値 | 動作 |
|---|---|
| `undefined` / `null` / 負値 | 全行を更新 |
| 行番号（数値） | 指定行を更新 |
| 行番号の配列 | 対象行を全て更新 |
| `findObject` | 検索結果の行を更新 |

```javascript
// 全行更新
tbl.update(null, { active: false });

// 検索結果を更新
tbl.update(tbl.find().eq("id", 1), { name: "Alice Updated" });
```

#### `upsert(keyColumn, values)` — Insert or Update

`keyColumn` の値が一致する行があれば更新、なければ追加します。

```javascript
tbl.upsert("id", { id: 1, name: "Alice", age: 31 });
```

#### `delete(find)` — 行削除

| `find` の値 | 動作 |
|---|---|
| `undefined` / `null` / 負値 | 全行削除 |
| 行番号（数値） | 指定行を削除 |
| 行番号の配列 | 対象行を全て削除 |
| `findObject` | 検索結果の行を削除 |

```javascript
// 全削除
tbl.delete(null);

// 検索結果を削除
tbl.delete(tbl.find().eq("name", "Bob"));
```

---

### データ取得

#### `select(find, sortColumns, sortDesc, columns)` — 行取得

| 引数 | 型 | 説明 |
|---|---|---|
| `find` | `null \| number \| number[] \| findObject` | 取得対象。`null` で全件取得 |
| `sortColumns` | `string \| string[] \| null` | ソート対象カラム名 |
| `sortDesc` | `boolean \| boolean[] \| null` | `true` で降順。配列でカラムごとに指定可 |
| `columns` | `string[] \| null` | 取得するカラム名。省略で全カラム |

戻り値: `object[]`（行オブジェクトの配列）

```javascript
// 全件昇順
const rows = tbl.select(null, "age", false);

// 複数カラムソート
const rows = tbl.select(null, ["dept", "age"], [false, true]);

// 特定カラムのみ取得
const rows = tbl.select(null, null, null, ["id", "name"]);
```

#### `count(find)` — 行数取得

`find` が `null` の場合はテーブル全件数、`findObject` または配列を渡すとその件数を返します。

#### `row(no[, columns])` — 行番号指定で1行取得

```javascript
const row = tbl.row(0);          // 先頭行
const row = tbl.row(0, ["id"]);  // 特定カラムのみ
```

#### `search(name, value[, columns[, sortDesc]])` — 単一条件で検索

1つのカラムと値を指定して検索します。`find().eq()` の簡易版です。

```javascript
const rows = tbl.search("name", "Alice");
const rows = tbl.search("name", "Alice", null, false); // 昇順ソート付き
```

---

### 検索（find）

#### `find()` — クエリビルダー生成

メソッドチェーンで複数の検索条件を組み立てるクエリビルダーを返します。

```javascript
const result = tbl.find()
  .eq("dept", "Sales")
  .ge("age", 25)
  .result();           // 行番号配列を返す

// select に直接渡すことも可能
const rows = tbl.select(
  tbl.find().eq("active", true).lt("age", 40)
);
```

#### findオブジェクトのメソッド

**値比較**

| メソッド | 条件 |
|---|---|
| `eq(name, value)` | `=` 一致（インデックス使用） |
| `ne(name, value)` | `!=` 不一致（インデックス使用） |
| `gt(name, value)` | `>` より大きい |
| `ge(name, value)` | `>=` 以上 |
| `lt(name, value)` | `<` より小さい |
| `le(name, value)` | `<=` 以下 |
| `in(name, value[])` | 配列のいずれかに一致 |
| `ni(name, value[])` | 配列のいずれにも一致しない |
| `between(name, [min, max])` | min以上max以下 |
| `regexp(name, regexp)` | 正規表現にマッチ |

**文字列長比較**（`l` プレフィックス）

| メソッド | 条件 |
|---|---|
| `leq(name, len)` | 文字列長 `=` |
| `lne(name, len)` | 文字列長 `!=` |
| `lgt(name, len)` | 文字列長 `>` |
| `lge(name, len)` | 文字列長 `>=` |
| `llt(name, len)` | 文字列長 `<` |
| `lle(name, len)` | 文字列長 `<=` |
| `lin(name, len[])` | 文字列長が配列のいずれかに一致 |
| `lni(name, len[])` | 文字列長が配列のいずれにも一致しない |
| `lbetween(name, [min, max])` | 文字列長がmin以上max以下 |

**Date比較**（`d` プレフィックス、`yyyy-MM-dd` 単位で比較）

`deq` / `dne` / `dgt` / `dge` / `dlt` / `dle` / `din` / `dni` / `dbetween`

**Timestamp比較**（`t` プレフィックス、`yyyy-MM-dd HH:mm:ss` 単位で比較）

`teq` / `tne` / `tgt` / `tge` / `tlt` / `tle` / `tin` / `tni` / `tbetween`

**カスタム比較**

```javascript
// fo.f(name, value, compareFn)
tbl.find().f("score", 60, (a, b) => a >= b); // score >= 60
```

**JSONカラム検索**

`#` プレフィックスでJSONカラムの内部を検索します（`setColumnTypes` でjson型を設定している必要があります）。

```javascript
// meta カラム（JSON）の中の city フィールドを検索
tbl.find().eq("#meta.city", "Tokyo");

// ネストした検索（ * で全キー、[] で全配列要素）
tbl.find().eq("#meta.tags.[]", "vip");
tbl.find().eq("#meta.*.label", "urgent");
tbl.find().eq("#meta.items.[1].name", "banana"); // 配列インデックス指定
```

**結果取得**

| メソッド | 説明 |
|---|---|
| `result()` / `r()` | 行番号の配列（`number[]`）を返す |
| `reset()` | 絞り込み状態をリセットして最初から条件を積み直す |

---

### AND / OR / NOT 結合

`find()` の結果や行番号配列を組み合わせることができます。

```javascript
const adults = tbl.find().ge("age", 20);
const sales  = tbl.find().eq("dept", "Sales");

// AND: 両方に一致
const rows = tbl.select(tbl.and(adults, sales));

// OR: どちらかに一致
const rows = tbl.select(tbl.or(adults, sales));

// NOT: adults に一致しない行
const rows = tbl.select(tbl.not(adults));
```

---

### 保存・復元

#### `save([cloneFlag])` — 保存用オブジェクト出力

テーブルデータを保存用のプレーンオブジェクトとして出力します。`JSON.stringify` または `jsonb.encode` でシリアライズして永続化できます。

| `cloneFlag` | 動作 |
|---|---|
| `false`（デフォルト） | 内部配列の参照共有。高速だが、後からテーブルを変更すると保存データも変わる |
| `true` | ディープコピー。安全だが低速 |

```javascript
// 保存
const saved = table.save(true);
const json = JSON.stringify(saved);

// 復元
const tbl = open(JSON.parse(json));
```

---

## 総合的な使用例

```javascript
const { create } = require('./memoryTable');

const tbl = create("id", "name", "dept", "age");

tbl.setColumnTypes("id", "number", "age", "number");
tbl.createIndex("dept");

tbl.insertList([
  { id: 1, name: "Alice", dept: "Sales",   age: 28 },
  { id: 2, name: "Bob",   dept: "Dev",     age: 35 },
  { id: 3, name: "Carol", dept: "Sales",   age: 42 },
  { id: 4, name: "Dave",  dept: "Dev",     age: 22 },
]);

// Sales部門かつ30歳以上を取得し、年齢降順でソート
const result = tbl.select(
  tbl.find().eq("dept", "Sales").ge("age", 30),
  "age",
  true
);
console.log(result);
// [{ id: 3, name: "Carol", dept: "Sales", age: 42 }]

// 全件数
console.log(tbl.count()); // 4

// Bobの年齢を更新
tbl.update(tbl.find().eq("name", "Bob"), { age: 36 });

// id=4を削除
tbl.delete(tbl.find().eq("id", 4));
```

# ◆◆◆ EOF ◆◆◆
