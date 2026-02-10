# s3db.js

## 概要

aws lambda(LLRM) での 関数URLの実装に対して、AWS RDS を使う事は「コスト高」になる。

一方で、DynamoDBと言う選択肢もあるが、どちらかと言えば「もっと低コストで実現」したい。

また「AWSではS3が最も安いストレージである」が一方で「S3はKeyValueストレージ」でもあり、比較的拘束なI/Oが実現できる。

それと「S3利用を同一AWS内で利用する場合」は「通信コストが発生しない」ため、実質「S3ストレージ容量」にのみ、コストが発生する。

あと「S3自身のストレージコスト＝1TBで25USD/月」であり、たとえば10MBのテーブルが10個=100MB の場合「0.00025USD/月=1ドル160円計算=0.04円」と超リーズナブルな価格となる。

小規模なWebアプリとして LLRM + minto + 関数URL を利用する場合、この s3db.js を利用する事で、低コストなWebサービスが実現できるようになる。

## 注意点

- **同時書き込み**: S3 には行ロックがないため、高頻度の並行書き込みには向きません。読み取り中心・低〜中頻度の書き込みユースケースに最適です。
- **データ量**: テーブル全体を1つの JSON として読み書きするため、数万行程度までが実用的です。それ以上は DynamoDB や Aurora Serverless の検討をおすすめします。
- **依存**: `@aws-sdk/client-s3`（Lambda Node.js 18+ ランタイムには同梱済み）

## 主な機能

| 操作 | メソッド | 備考 |
|---|---|---|
| **CREATE TABLE** | `createTable(name, columns)` | 型定義・PK・UNIQUE・NOT NULL・デフォルト値・AUTO INCREMENT |
| **DROP TABLE** | `dropTable(name)` | スキーマ＋データ削除 |
| **INSERT** | `insert(table, rows)` | 単一/バルク挿入、制約チェック付き |
| **SELECT** | `select(table, opts)` | WHERE・ORDER BY・LIMIT/OFFSET・GROUP BY・集計関数 (COUNT/SUM/AVG/MIN/MAX) |
| **UPDATE** | `update(table, where, set)` | 条件指定で部分更新 |
| **DELETE** | `delete(table, where)` | 条件指定で削除 |
| **INNER JOIN** | `innerJoin(a, b, on)` | 2テーブル内部結合 |
| **LEFT JOIN** | `leftJoin(a, b, on)` | 左外部結合 |
| **トランザクション** | `transaction(fn)` | 簡易ラッパー |

## S3 上のデータ構造

```
s3://bucket/prefix/_schema/users.json   ← スキーマ定義
s3://bucket/prefix/users/data.json      ← 行データ (JSON配列)
```

## 使い方（簡易説明）

```js
const { S3Database } = require("./s3db.js");
const db = new S3Database({ bucket: "my-bucket", prefix: "myapp/" });

// テーブル作成 → INSERT → SELECT の流れ
await db.createTable("users", {
  id:   { type: "number", primaryKey: true, autoIncrement: true },
  name: { type: "string", notNull: true },
});
await db.insert("users", { name: "Alice" });
const rows = await db.select("users", { where: r => r.name === "Alice" });
```

## 実装例

~~~js
// ════════════════════════════════════════════════════════════════
//  Lambda ハンドラー例
// ════════════════════════════════════════════════════════════════
const { S3Database } = require("./s3db.js");

const db = new S3Database({ bucket: "my-data-bucket", prefix: "myapp/" });

exports.handler = async (event) => {
    // ── CREATE TABLE ──
    await db.createTable("users", {
    id:    { type: "number", primaryKey: true, autoIncrement: true },
    name:  { type: "string", notNull: true },
    email: { type: "string", unique: true },
    age:   { type: "number", default: 0 },
    });

    await db.createTable("orders", {
    id:      { type: "number", primaryKey: true, autoIncrement: true },
    userId:  { type: "number", notNull: true },
    product: { type: "string" },
    amount:  { type: "number" },
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
    where: (r) => r.age >= 30,
    orderBy: "age",
    order: "desc",
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
    await db.update("users", (r) => r.name === "Bob", { age: 26 });

    // ── INNER JOIN ──
    const joined = await db.innerJoin("users", "orders",
    (u, o) => u.id === o.userId
    );
    console.log("Joined:", joined);

    // ── LEFT JOIN ──
    const left = await db.leftJoin("users", "orders",
    (u, o) => u.id === o.userId
    );
    console.log("Left join:", left);

    // ── DELETE ──
    const del = await db.delete("orders", (r) => r.amount < 2000);
    console.log("Deleted:", del);

    // ── DROP TABLE ──
    // await db.dropTable("orders");

    return { statusCode: 200, body: JSON.stringify({ adults, stats, joined }) };
};
~~~
