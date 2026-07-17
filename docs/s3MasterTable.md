# s3MasterTable.js

## 概要

aws lambda(LLRM) での 関数URLの実装に対して、AWS RDS を使う事は「コスト高」になる。

一方で、DynamoDBと言う選択肢もあるが、どちらかと言えば「もっと低コストで実現」したい。

また「AWSではS3が最も安いストレージである」が一方で「S3はKeyValueストレージ」でもあり、比較的拘束なI/Oが実現できる。

それと「S3利用を同一AWS内で利用する場合」は「通信コストが発生しない」ため、実質「S3ストレージ容量」にのみ、コストが発生する。

あと「S3自身のストレージコスト＝1TBで25USD/月」であり、たとえば10MBのテーブルが10個=100MB の場合「0.00025USD/月=1ドル160円計算=0.04円」と超リーズナブルな価格となる。

小規模なWebアプリとして LLRM + minto + 関数URL を利用する場合、この s3MasterTable.js を利用する事で、低コストなWebサービスが実現できるようになる。

## s3IndexTable.js との使い分け

`modules/s3table/`配下には、S3をバックエンドにしたデータベースがもう1つ存在する（[modules/s3table/s3IndexTable.js](https://github.com/maachang/minto/blob/main/modules/s3table/s3IndexTable.js)、設計の詳細は[docs/s3-row-store-design.md](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)を参照）。用途に応じて使い分けること。

| | `s3MasterTable.js`（本ドキュメント） | `s3IndexTable.js` |
|---|---|---|
| データ格納単位 | テーブル全体で1つのJSON | 1行＝1ファイル |
| 向いている用途 | **書き込み頻度が少なく、読み込み頻度が多い**もの | **書き込み頻度が多い**もの |
| 書き込み競合 | テーブル全体をread-modify-writeするため競合しやすい | 行単位のファイルなのでほぼ競合しない |
| 検索方法 | `where`（宣言的な条件オブジェクト）でテーブル全件走査。自由な条件検索が可能 | 事前定義したインデックス経由のみ。複合インデックスは先頭カラムのみ範囲検索可 |

## 注意点

- **同時書き込み**: S3 には行ロックがないため、高頻度の並行書き込みには向きません。読み取り中心・低〜中頻度の書き込みユースケースに最適です（高頻度の書き込みが必要な場合は`s3IndexTable.js`を検討してください）。安全に更新したい場合は後述の`transaction()`(テーブル単位ロック)を使ってください。
- **データ量**: テーブル全体を1つの JSON として読み書きするため、数万行程度までが実用的です。それ以上は DynamoDB や Aurora Serverless の検討をおすすめします。
- **依存**: `modules/s3table/s3sdk.js`（内部でS3のput/get/delete操作を行う）、`modules/s3table/s3Lock.js`（`transaction()`のテーブルロックに使用）

## 主な機能

| 操作 | メソッド | 備考 |
|---|---|---|
| **CREATE TABLE** | `createTable(name, schema)` | 型定義・PK・UNIQUE・NOT NULL・デフォルト値 |
| **DROP TABLE** | `dropTable(name)` | スキーマ＋データ削除 |
| **DESCRIBE TABLE** | `describeTable(name)` | テーブル定義を取得 |
| **SHOW TABLES** | `listTables()` | 全テーブル分の定義を`{テーブル名: schema}`形式で取得 |
| **ALTER TABLE** | `alterColumns(name, columns)` | カラム定義を丸ごと差し替え(データは変更しない)。`bin/tableTool`経由での利用を想定 |
| **INSERT** | `insert(table, row)` | 単一/バルク挿入、制約チェック付き。**S3への即時アップロードは行わない**(後述) |
| **SELECT** | `select(table, query)` | WHERE・ORDER BY・LIMIT/OFFSET・GROUP BY・集計関数 (COUNT/SUM/AVG/MIN/MAX) |
| **UPDATE** | `update(table, query, patch)` | 条件指定で部分更新。**S3への即時アップロードは行わない**(後述) |
| **DELETE** | `delete(table, query)` | 条件指定で削除。**S3への即時アップロードは行わない**(後述) |
| **FLUSH** | `flush(table)` | 保留中の変更を実際にS3へアップロードする |
| **TRANSACTION** | `transaction(table, fn)` | テーブル単位ロック＋`fn`実行＋`flush`＋ロック解放を一括で行う |
| **BACKUP** | `backupTable(name)` | 行データ・スキーマの新しいバックアップ世代を作成。`bin/tableTool`経由での利用を想定 |
| **SHOW BACKUPS** | `listBackups(name)` | 既存バックアップ世代(backupId)一覧を古い順で取得 |
| **RESTORE** | `restoreTable(name, backupId)` | 指定世代の内容でテーブルを全置換(差分マージなし) |
| **PREVIEW RESTORE** | `previewRestore(name, backupId)` | `restoreTable`のdry-run。現在とバックアップの行数を比較するだけで復元はしない |
| **PRUNE BACKUPS** | `pruneBackups(name, keep)` | 直近`keep`世代だけ残し、古いバックアップ世代を削除する |

`join`は不要機能として提供していません（過去バージョンにはありましたが削除しました）。`transaction`は後述の形で復活させています。

### バックアップ/リストア

`backupTable`/`listBackups`/`restoreTable`/`previewRestore`/`pruneBackups`は`s3IndexTable.js`と共通の物理コピー方式(S3の`CopyObject`は使わず既存の`get`/`put`経由で複製)です。本モジュールはテーブル全体1JSON(`data.json`)方式なのでインデックスは無く、`data.json`＋スキーマ定義の2ファイルを`backup/{テーブル名}/{backupId}/`配下(`backupId`は実行時のUnixTimeミリ秒)に複製するだけで済みます(`s3IndexTable.js`より単純)。

- `backupTable`は`_loadRows`経由で行データを取得するため、`flush`前の未反映な変更(自分がinsertした内容)もバックアップ対象に含まれます(`select`と同じ「現在の実効値」を見る挙動)
- 複数世代を保持でき、`pruneBackups(name, keep)`で直近`keep`世代だけを残して古い世代を削除できます(`keep`以下の世代数なら何もしません)。`pruneBackups`を呼ばない限り古い世代は自動では削除されません
- `restoreTable`は指定世代の内容で現在のテーブル(行データ・スキーマ)を**全置換**します(差分マージはしない)。復元後は即座にS3へ書き込まれ、メモリキャッシュも復元後の内容にリセットされるため`flush`は不要です
- `previewRestore(name, backupId)`は`restoreTable`実行前のdry-runです。現在の行数とバックアップの行数を比較するだけで、実際の復元・削除は一切行いません(行数以外のスキーマ差分等は表示しません)
- バックアップ/リストア実行中も通常のCRUD処理自体はロックされないため、整合性の取れたバックアップ/リストアを行うにはメンテナンス時間帯に実行する運用が前提となります(`bin/tableTool`のメンテナンスロックにより、他の管理コマンドとの多重実行のみ防止されます)

### 書き込みのバッファリングとflush/transaction

`insert`/`update`/`delete`/`importCsv`は、呼び出しの度にS3へアップロードするのではなく、**メモリ上にのみ変更を保持**します。これは、1回の処理内で複数回の書き込みが発生する場合にS3へのアップロード回数を減らすためです。実際にS3へ反映するには、明示的に`flush(table)`を呼び出す必要があります(`flush`を呼ばないままLambdaの実行が終了すると、変更は失われます)。

同一の`db`インスタンス内であれば、`select`は`flush`前の変更(自分がinsertした内容)も正しく参照できます(read-your-own-writes)。

```js
const db = s3MasterTable.create({ bucket: "my-bucket" });
await db.insert("users", { name: "Alice" });
// この時点ではまだS3には反映されていない.
await db.flush("users");
// ここでS3へアップロードされる.
```

`flush`は`transaction`を使わずに単体でも呼び出せる公開APIです。ただし、この場合はテーブルロックが掛からないため、複数の実行環境からの同時書き込みに対する安全性は利用者側の責任になります。安全に更新したい場合は`transaction(table, fn)`を使ってください。

```js
await db.transaction("users", async () => {
    await db.insert("users", { name: "Alice" });
    await db.update("users", { where: { name: { eq: "Bob" } } }, { age: 26 });
});
```

`transaction(table, fn)`は以下の流れで動作します。

1. `modules/s3table/s3Lock.js`で`"master." + table`というキーのロックを取得する(取得できない場合は即座にエラーになる。リトライはしない)
2. ロック取得直後、**キャッシュの有無に関わらず必ずS3から最新の行データを取得し直す**(ロック取得前に別の処理が作った可能性のある古いキャッシュは信用しない。これにより、ロックを取得した時点で他の実行環境が直前に書き込んだ内容を正しく引き継いだ状態から更新を始められる)
3. `fn`(引数無しのasync関数)を実行する
4. `fn`が正常終了したら`flush(table)`を実行する
5. ロックを解放する

`fn`実行中に例外が発生した場合は、手順2で取得した(ロック取得直後の)状態にロールバックし(S3へは一切アップロードしない)、ロックを解放してから例外を再throwします。

`transaction`は1テーブル単位でロックするため、複数テーブルにまたがる更新をまとめて安全に行いたい場合は、テーブルごとに`transaction`を呼び分けてください。

## カラム型・オプション

`modules/s3table/s3IndexTable.js`と共通の型システムを採用しています。

| タイプ名 | 説明 |
|---|---|
| `string` | 文字列 |
| `int` | 整数 |
| `float` | 浮動小数点 |
| `boolean` | 真偽値 |
| `date` | 日付・日時。内部的にはUnixTimeミリ秒のnumberとして保存されるが、insert時にJSの`Date`オブジェクトを受け取り、select時（`groupBy`未指定の場合）も`Date`オブジェクトとして返す |
| `json` | 任意のJSON値（オブジェクト・配列など） |
| `seqId` | Snowflake ID方式のユニークID（固定長16桁の小文字hex文字列）。insert時に値省略で自動生成される（後述） |

カラムのオプションは以下の通りです。

- `notNull`: 必須項目にする
- `default`: 省略時のデフォルト値（関数も指定可）
- `primaryKey` / `unique`: 一意性制約。テーブル全体を1回の読み込み→書き戻しサイクルの中で検証するため、`s3IndexTable.js`とは異なりサポートしています

`autoIncrement`（連番の自動採番）はサポートしていません。insertの度に変わる値をテーブル定義の集約ファイルに同居させると書き込み競合・性能劣化を招くためです。連番的な採番が必要な場合は、代わりに`type: "seqId"`を使ってください。

### seqId型（Snowflake ID方式のユニークID発行）

`type: "seqId"`のカラムは、insert時に値を省略すると自動的にユニークなIDが生成されます（旧`autoIncrement`の使い勝手を踏襲）。

```js
await db.createTable("users", {
  columns: {
    id:   { type: "seqId" },
    name: { type: "string", notNull: true },
  }
});
const [row] = await db.insert("users", { name: "Alice" });
// row.id === "04aa00d7160af000" のような固定長16桁の小文字hex文字列
```

- Twitter社が採用していたSnowflake ID方式（タイムスタンプ+ワーカーID+シーケンス番号をビットパックする方式）を採用しています。ロック・中央採番管理を一切必要としないため、`autoIncrement`が抱えていた書き込み競合の問題が起きません。
- 実装は`modules/s3table/seqId.js`（64bit = タイムスタンプ42bit + ワーカーID10bit + シーケンス12bit）。他テーブルとの紐付けキーとしての利用を主眼に置いており、値は算術演算ではなく不透明な識別子として扱ってください。
- 値は固定長16桁の小文字hex文字列で返却されます。これは64bit値をJSの安全な整数範囲(2^53)を超えても精度を落とさず扱うため（内部はBigInt）、かつ固定長にすることで文字列比較(`<`, `>`)がそのまま生成順（数値順）と一致するようにするためです。
- `primaryKey`/`unique`と組み合わせて使うことを想定しています（衝突確率は極めて低いですが、ゼロではありません）。

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

