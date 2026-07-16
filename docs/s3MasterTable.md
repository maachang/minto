# s3MasterTable.js

## 概要

aws lambda(LLRM) での 関数URLの実装に対して、AWS RDS を使う事は「コスト高」になる。

一方で、DynamoDBと言う選択肢もあるが、どちらかと言えば「もっと低コストで実現」したい。

また「AWSではS3が最も安いストレージである」が一方で「S3はKeyValueストレージ」でもあり、比較的拘束なI/Oが実現できる。

それと「S3利用を同一AWS内で利用する場合」は「通信コストが発生しない」ため、実質「S3ストレージ容量」にのみ、コストが発生する。

あと「S3自身のストレージコスト＝1TBで25USD/月」であり、たとえば10MBのテーブルが10個=100MB の場合「0.00025USD/月=1ドル160円計算=0.04円」と超リーズナブルな価格となる。

小規模なWebアプリとして LLRM + minto + 関数URL を利用する場合、この s3MasterTable.js を利用する事で、低コストなWebサービスが実現できるようになる。

## s3IndexTable.js との使い分け

`modules/sdk/`配下には、S3をバックエンドにしたデータベースがもう1つ存在する（[modules/sdk/s3IndexTable.js](https://github.com/maachang/minto/blob/main/modules/sdk/s3IndexTable.js)、設計の詳細は[docs/s3-row-store-design.md](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)を参照）。用途に応じて使い分けること。

| | `s3MasterTable.js`（本ドキュメント） | `s3IndexTable.js` |
|---|---|---|
| データ格納単位 | テーブル全体で1つのJSON | 1行＝1ファイル |
| 向いている用途 | **書き込み頻度が少なく、読み込み頻度が多い**もの | **書き込み頻度が多い**もの |
| 書き込み競合 | テーブル全体をread-modify-writeするため競合しやすい | 行単位のファイルなのでほぼ競合しない |
| 検索方法 | `where`（宣言的な条件オブジェクト）でテーブル全件走査。自由な条件検索が可能 | 事前定義したインデックス経由のみ。複合インデックスは先頭カラムのみ範囲検索可 |

## 注意点

- **同時書き込み**: S3 には行ロックがないため、高頻度の並行書き込みには向きません。読み取り中心・低〜中頻度の書き込みユースケースに最適です（高頻度の書き込みが必要な場合は`s3IndexTable.js`を検討してください）。
- **データ量**: テーブル全体を1つの JSON として読み書きするため、数万行程度までが実用的です。それ以上は DynamoDB や Aurora Serverless の検討をおすすめします。
- **依存**: `modules/sdk/s3sdk.js`（内部でS3のput/get/delete操作を行う）

## 主な機能

| 操作 | メソッド | 備考 |
|---|---|---|
| **CREATE TABLE** | `createTable(name, schema)` | 型定義・PK・UNIQUE・NOT NULL・デフォルト値 |
| **DROP TABLE** | `dropTable(name)` | スキーマ＋データ削除 |
| **DESCRIBE TABLE** | `describeTable(name)` | テーブル定義を取得 |
| **SHOW TABLES** | `listTables()` | 全テーブル分の定義を`{テーブル名: schema}`形式で取得 |
| **ALTER TABLE** | `alterColumns(name, columns)` | カラム定義を丸ごと差し替え(データは変更しない)。`bin/tableTool`経由での利用を想定 |
| **INSERT** | `insert(table, row)` | 単一/バルク挿入、制約チェック付き |
| **SELECT** | `select(table, query)` | WHERE・ORDER BY・LIMIT/OFFSET・GROUP BY・集計関数 (COUNT/SUM/AVG/MIN/MAX) |
| **UPDATE** | `update(table, query, patch)` | 条件指定で部分更新 |
| **DELETE** | `delete(table, query)` | 条件指定で削除 |

`join`・`transaction`は不要機能として提供していません（過去バージョンにはありましたが削除しました）。

## カラム型・オプション

`modules/sdk/s3IndexTable.js`と共通の型システムを採用しています。

| タイプ名 | 説明 |
|---|---|
| `string` | 文字列 |
| `int` | 整数 |
| `float` | 浮動小数点 |
| `boolean` | 真偽値 |
| `date` | 日付・日時。内部的にはUnixTimeミリ秒のnumberとして保存されるが、insert時にJSの`Date`オブジェクトを受け取り、select時（`groupBy`未指定の場合）も`Date`オブジェクトとして返す |
| `json` | 任意のJSON値（オブジェクト・配列など） |

カラムのオプションは以下の通りです。

- `notNull`: 必須項目にする
- `default`: 省略時のデフォルト値（関数も指定可）
- `primaryKey` / `unique`: 一意性制約。テーブル全体を1回の読み込み→書き戻しサイクルの中で検証するため、`s3IndexTable.js`とは異なりサポートしています

`autoIncrement`（連番の自動採番）はサポートしていません。insertの度に変わる値をテーブル定義の集約ファイルに同居させると書き込み競合・性能劣化を招くためです。連番的な採番が必要な場合はソート可能なユニークID発行等、別の仕組みで対応してください。

## where の演算子仕様

`modules/csv/memoryTable.js`相当の演算子（全件走査前提のため、S3側のLIST操作への変換を考慮する必要が無く、この演算子セットをそのまま使えます）。

| 演算子 | 意味 |
|---|---|
| `eq` | 一致 |
| `ne` | 不一致 |
| `gt` / `gte` / `lt` / `lte` | 大小比較（`gte`+`lte`を同じ条件オブジェクトに書けば範囲検索になる） |
| `in` | 複数値のいずれかに一致 |
| `ni` | 複数値のいずれにも一致しない |
| `between` | `[min, max]`の範囲内（`gte`+`lte`と同義） |
| `regexp` | 正規表現にマッチ |

条件を複数指定した場合はAND評価になります（例: `{ gte: 20, lte: 40 }`）。複数カラムの条件を指定した場合もAND評価になります。

## S3 上のデータ構造

```
s3://bucket/prefix/table.json            ← 全テーブル分のスキーマ定義を集約したファイル
                                            (テーブル名をキーにしたオブジェクト)
s3://bucket/prefix/table/users/data.json ← 行データ (JSON配列)
```

## 使い方（簡易説明）

```js
const s3MasterTable = $loadLib("s3MasterTable.js");
const db = s3MasterTable.create({ bucket: "my-bucket", prefix: "myapp/" });

// テーブル作成 → INSERT → SELECT の流れ
await db.createTable("users", {
  columns: {
    id:   { type: "int", primaryKey: true },
    name: { type: "string", notNull: true },
  }
});
await db.insert("users", { name: "Alice" });
const rows = await db.select("users", { where: { name: { eq: "Alice" } } });
```

## 実装例

~~~js
// ════════════════════════════════════════════════════════════════
//  Lambda ハンドラー例
// ════════════════════════════════════════════════════════════════
const s3MasterTable = $loadLib("s3MasterTable.js");

const db = s3MasterTable.create({ bucket: "my-data-bucket", prefix: "myapp/" });

exports.handler = async (event) => {
    // ── CREATE TABLE ──
    await db.createTable("users", {
        columns: {
            id:    { type: "int", primaryKey: true },
            name:  { type: "string", notNull: true },
            email: { type: "string", unique: true },
            age:   { type: "int", default: 0 },
        }
    });

    await db.createTable("orders", {
        columns: {
            id:      { type: "int", primaryKey: true },
            userId:  { type: "int", notNull: true },
            product: { type: "string" },
            amount:  { type: "int" },
        }
    });

    // ── INSERT ──
    await db.insert("users", [
        { name: "Alice", email: "alice@example.com", age: 30 },
        { name: "Bob",   email: "bob@example.com",   age: 25 },
        { name: "Carol", email: "carol@example.com",  age: 35 },
    ]);

    await db.insert("orders", [
        { userId: 1, product: "Widget",  amount: 1200 },
        { userId: 1, product: "Gadget",  amount: 3400 },
        { userId: 2, product: "Widget",  amount: 1200 },
        { userId: 3, product: "Thingamajig", amount: 5600 },
    ]);

    // ── SELECT WHERE ──
    const adults = await db.select("users", {
        where: { age: { gte: 30 } },
        orderBy: { age: "desc" },
    });
    console.log("Adults:", adults);

    // ── SELECT with GROUP BY + aggregates ──
    const stats = await db.select("orders", {
        groupBy: ["userId"],
        aggregates: {
            totalAmount: { fn: "sum", col: "amount" },
            orderCount:  { fn: "count" },
        },
    });
    console.log("Order stats:", stats);

    // ── UPDATE ──
    await db.update("users", { where: { name: { eq: "Bob" } } }, { age: 26 });

    // ── DELETE ──
    const del = await db.delete("orders", { where: { amount: { lt: 2000 } } });
    console.log("Deleted:", del);

    // ── DROP TABLE ──
    // await db.dropTable("orders");

    return { statusCode: 200, body: JSON.stringify({ adults, stats }) };
};
~~~

