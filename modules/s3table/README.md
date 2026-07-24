# ◆◆◆ s3sdk.js ◆◆◆

AWS-SDK-V3(`@aws-sdk/client-s3`)を利用した、S3への最低限のI/O(put/get/delete/list)を提供するモジュールです。`modules/s3table/`配下の他モジュール(s3MasterTable.js/s3IndexTable.js/session.js/admin.jsなど)から共通的に利用される低レベル基盤です。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.put(bucket, prefix, key, body, options)` | オブジェクトを書き込む |
| `exports.delete(bucket, prefix, key, options)` | オブジェクトを削除する |
| `exports.get(bucket, prefix, key, options)` | オブジェクトを取得する |
| `exports.list(bucket, prefix, options)` | prefix以下のオブジェクト一覧を取得する |

いずれの関数も第一引数`bucket`が必須で、`options`で接続先リージョン・クレデンシャル・エラー時の挙動を共通的に制御できます。

---

## 共通の`options`

| プロパティ | 型 | 説明 |
|---|---|---|
| `noError` | `boolean` | `false`の場合、エラー時に例外をthrowする(デフォルト`true`＝例外を投げず失敗値を返す) |
| `region` | `string` | 接続先リージョン(デフォルト`"ap-northeast-1"`) |
| `credentials` | `object` | `{access_key, secret_access_key, session_token}`。省略時は環境変数(`AWS_ACCESS_KEY_ID`等)から取得 |

エラー発生時は必ず`console.warn`でログ出力してから、`noError`の設定に応じて例外throwまたは失敗値を返します。

---

## `put(bucket, prefix, key, body, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `bucket` | `string` | 対象のBucket名 |
| `prefix` | `string` | 対象のprefix |
| `key` | `string` | 対象のkey |
| `body` | `string \| Buffer \| Uint8Array` | 書き込む内容 |
| `options` | `object` | 共通オプション |

### 戻り値

`boolean` — 成功時`true`、失敗時(`noError`がデフォルトの場合)`false`。

### 使用例

```javascript
const s3sdk = $loadLib("s3sdk.js");

await s3sdk.put("my-bucket", "table/users", "data.json", JSON.stringify(rows));
```

---

## `delete(bucket, prefix, key, options)`

`put`と同じ引数構成(`body`無し)。オブジェクトを削除し、成功時`true`を返します。

---

## `get(bucket, prefix, key, options)`

### 戻り値

`GetObjectCommand`の実行結果オブジェクト(`{Body, ...}`)。オブジェクトが存在しない・エラー発生時(`noError`がデフォルトの場合)は`null`を返します。`Body`はストリームのため、文字列化するには`res.Body.transformToString("utf-8")`を使う必要があります(llrtでは`for-await-of`構文が使えないため)。

### 使用例

```javascript
const res = await s3sdk.get("my-bucket", "table/users", "data.json");
if (res != null) {
    const rows = JSON.parse(await res.Body.transformToString("utf-8"));
}
```

---

## `list(bucket, prefix, options)`

### 引数(`options`追加分)

| プロパティ | 型 | 説明 |
|---|---|---|
| `maxKey` | `number` | 取得件数上限(最大1000) |
| `delimiter` | `string` | 階層区切り文字 |
| `continuationToken` | `string` | 前回の`list()`が`{IsTruncated: true}`を返した場合の`NextContinuationToken` |
| `startAfter` | `string` | 指定文字列より後(排他的)から一覧取得を開始(範囲検索の開始位置指定に利用) |

### 戻り値

`{Contents: [...], IsTruncated, NextContinuationToken}` — `ListObjectsV2Command`の実行結果。エラー時(`noError`がデフォルトの場合)は`{Contents: [], IsTruncated: false}`を返します。

### 使用例

```javascript
let token = undefined;
do {
    const res = await s3sdk.list("my-bucket", "table/users", { continuationToken: token, maxKey: 1000 });
    for (const obj of res.Contents) {
        console.log(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);
```

---

## 依存・設定・注意事項

- 依存モジュールは無し(`@aws-sdk/client-s3`のみ利用)。
- **環境変数`MINTO_LOCAL_S3_ENDPOINT`**: 設定されている場合、実AWS S3ではなく`tools/localS3.js`(ローカルS3エミュレータ)へ接続します(`forcePathStyle: true`)。ローカル接続時、環境変数にもクレデンシャルが無い場合はダミークレデンシャル(`local`/`local`)を使い、実AWSへの接続やAWS_PROFILE等の設定を要求しないようにしています。
- **AWS Lambda環境でのデプロイ**: `@aws-sdk/client-s3`を利用するため、AWS Lambda環境では`llrt-lambda-{cpu名}-full-sdk.zip`のレイヤーが必要です。
- リージョン・クレデンシャルごとに`S3Client`インスタンスをキャッシュしており、同一組み合わせであれば使い回されます。

---

# ◆◆◆ s3Lock.js ◆◆◆

S3の条件付き書き込み(`PutObjectCommand`の`IfNoneMatch: "*"`)を利用した、複数Lambda実行環境間での簡易排他ロックです。期限切れロック(stale)の自動失捉(reclaim)に対応しています。

s3sdk.jsは失敗時に必ず`console.warn`でログ出力する設計ですが、ロック競合(`PreconditionFailed`)はロック機構における正常系の一部であり、毎回警告ログを出すのは不適切なため、本モジュールは`s3sdk.js`を経由せず内部で直接`S3Client`を扱っています。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.create(options)` | ロックストア(`{acquire, release}`)を生成 |

---

## `create(options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `options.bucket` | `string` | 対象のS3バケット名(必須) |
| `options.prefix` | `string` | ロック保存先prefix(デフォルト`"locks/"`) |
| `options.timeoutMs` | `number` | ロック有効期限(ms)。これを超えたロックはstaleとみなし自動失捉する(デフォルト30000) |
| `options.region` / `options.credentials` | | S3接続オプション |

### 戻り値のメソッド

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `acquire(lockKey)` | `Promise<boolean>` | ロックを取得。成功時`true`、既に他者が保持中(かつstaleでない)場合`false` |
| `release(lockKey)` | `Promise<void>` | ロックを解放 |

### 使用例

```javascript
const s3Lock = $loadLib("s3Lock.js");

const lock = s3Lock.create({ bucket: "my-bucket", timeoutMs: 30000 });

if (await lock.acquire("master.users")) {
    try {
        // 排他区間の処理
    } finally {
        await lock.release("master.users");
    }
} else {
    throw new Error("ロック取得に失敗しました");
}
```

---

## 依存・設定・注意事項

- 依存モジュールは無し(`@aws-sdk/client-s3`を直接利用。`s3sdk.js`には依存しない設計)。
- 環境変数`MINTO_LOCAL_S3_ENDPOINT`によるローカルS3エミュレータ接続に対応(`s3sdk.js`と同じロジック)。
- ロックオブジェクトは`{key}.lock`というキーで`{acquiredAt}`(タイムスタンプ)を保存します。
- `acquire`はリトライを行いません(1回試して駄目なら`false`を返すのみ)。呼び出し側でリトライが必要な場合は自前で実装する必要があります。
- `s3MasterTable.js`は`"master." + tableName`、`s3IndexTable.js`は`"index." + tableName`というキー命名でこのロックを利用しています(同一bucket内でも用途ごとにキー衝突しないようにするため)。
- AWS Lambda環境では`s3sdk.js`と同様に`llrt-lambda-{cpu名}-full-sdk.zip`のレイヤーが必要です。

---

# ◆◆◆ seqId.js ◆◆◆

Snowflake ID方式(タイムスタンプ42bit＋ワーカーID10bit＋シーケンス12bit、Twitter社のSnowflake IDと同じ発想)による、連番的なユニークID発行モジュールです。旧`autoIncrement`の代替として使います。

`autoIncrement`は「insertの度に変わる値をテーブル定義の集約ファイルに同居させると書き込み競合・性能劣化を招く」という理由で廃止されており、本モジュールはロック・中央採番管理を一切必要とせず、各Lambda実行環境が完全に独立して一意なIDを生成できるため、`s3MasterTable.js`・`s3IndexTable.js`の両方から共通で使われています。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.generate()` | Snowflake ID方式のユニークIDを1件生成 |
| `exports.isValid(value)` | 値が固定長16桁の小文字hex文字列かどうかを判定 |

---

## `generate()`

### 戻り値

`string` — 固定長16桁の小文字hex文字列(64bit値のhex表現)。

### 使用例

```javascript
const seqId = $loadLib("seqId.js");

const id = seqId.generate();
// "04aa00d7160af000" のような固定長16桁の小文字hex文字列
```

## `isValid(value)`

### 戻り値

`boolean` — `value`が16桁の小文字hex文字列(`/^[0-9a-f]{16}$/`)にマッチする場合`true`。

---

## 依存・設定・注意事項

- 依存モジュールは無し。
- 用途は主に他テーブルとの紐付けキーであり算術演算の必要性は低いため、JSの安全な整数範囲(2^53)に収める設計は採用していません。内部はBigIntで64bitフル精度を扱い、外部には固定長16桁の小文字hex文字列として渡します(`JSON.stringify`がBigIntを扱えないことと、固定長にすることで文字列比較(`<`, `>`)がそのまま数値順と一致することの両方を満たすため)。
- ワーカーID(同一ミリ秒内で別のLambda実行環境が生成した場合に衝突しないための識別子)は、`$requestId()`を自前のFNV-1a風ハッシュ関数(crypto非使用、`Math.imul`による純粋なビット演算)で10bitに畳み込んで使います。`crypto.createHash`のllrtでのサポート状況が未確認のため、確実に動作する自前実装を選んでいます。モジュールロード時点ではまだ有効なリクエストコンテキストが無いため、初回`generate()`呼び出し時に遅延計算してメモ化します。
- シーケンス(同一ミリ秒内の連番)が4096件を超えた場合は、次のミリ秒になるまでビジーウェイトします(想定利用規模(1テーブル1万件程度)では実質発生しない前提)。
- カラム定義で`type: "seqId"`を指定すると、`s3MasterTable.js`/`s3IndexTable.js`のinsert時に値省略なら自動生成されます。

---

# ◆◆◆ s3MasterTable.js ◆◆◆

テーブル全体を1つのJSON(`table/{table名}/data.json`)としてS3に読み込み→メモリ上でフィルタ・更新→丸ごと書き戻す方式のRDBMSライクなデータベースです。**書き込み頻度が少なく、読み込み頻度が多い**マスターデータ向けの用途に適しています。

対になるモジュール`s3IndexTable.js`(1行=1ファイル、書き込み頻度が多い用途向け)とは使い分けが必要です。詳細な設計思想は[docs/s3MasterTable.md](https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md)を参照してください。

---

## エクスポート(`create(options).xxx`)

`exports.create(options)`でインスタンスを生成し、返却オブジェクトの各メソッドを呼び出します。

| 引数 | 型 | 説明 |
|---|---|---|
| `options.bucket` | `string` | 対象のS3バケット名(必須) |
| `options.prefix` | `string` | バケット内の格納先prefix(省略可) |
| `options.region` / `options.credentials` | | S3接続オプション |

### 主要API一覧

| 分類 | メソッド | 説明 |
|---|---|---|
| テーブル管理 | `createTable(name, schema)` | テーブル作成(型定義・PK・UNIQUE・NOT NULL・デフォルト値) |
| | `dropTable(name)` | テーブル削除(スキーマ＋データ) |
| | `describeTable(name)` | テーブル定義を取得 |
| | `listTables()` | 全テーブル分の定義を`{テーブル名: schema}`で取得 |
| | `alterColumns(name, columns)` | カラム定義を丸ごと差し替え(データは変更しない) |
| CRUD | `insert(table, row)` | 単一/バルク挿入。制約チェック付き。**S3への即時反映は行わない** |
| | `select(table, query)` | WHERE・ORDER BY・LIMIT/OFFSET・GROUP BY・集計関数(COUNT/SUM/AVG/MIN/MAX) |
| | `update(table, query, patch)` | 条件指定で部分更新。**S3への即時反映は行わない** |
| | `delete(table, query)` | 条件指定で削除。**S3への即時反映は行わない** |
| 書き込み反映 | `flush(table)` | 保留中の変更を実際にS3へアップロード |
| | `transaction(table, fn)` | テーブル単位ロック＋`fn`実行＋`flush`＋ロック解放を一括実行 |
| バックアップ | `backupTable(name)` | 新しいバックアップ世代を作成 |
| | `listBackups(name)` | 既存バックアップ世代一覧(古い順) |
| | `restoreTable(name, backupId)` | 指定世代の内容でテーブルを全置換 |
| | `previewRestore(name, backupId)` | `restoreTable`のdry-run(行数比較のみ) |
| | `pruneBackups(name, keep)` | 直近`keep`世代だけ残し古い世代を削除 |
| | `describeBackup(name, backupId)` | 復元せずにバックアップの中身を確認 |
| | `restoreBackupAs(name, backupId, destName)` | 別テーブル名として新規復元(クローン) |
| CSV | `exportCsv(table)` | テーブル全体をCSV文字列としてエクスポート |
| | `importCsv(table, csvString)` | CSV文字列でテーブル全体を置換(インポート) |

---

## 書き込みのバッファリング(重要)

`insert`/`update`/`delete`/`importCsv`は呼び出しの度にS3へアップロードするのではなく、**メモリキャッシュにのみ変更を保持**します。実際にS3へ反映するには`flush(tableName)`を呼ぶか、`transaction(tableName, fn)`経由で行う必要があります。`flush`を呼ばずにLambda実行が終了すると変更は失われます。

```javascript
const s3MasterTable = $loadLib("s3MasterTable.js");
const db = s3MasterTable.create({ bucket: "my-bucket", prefix: "myapp/" });

await db.insert("users", { name: "Alice" });
// この時点ではまだS3には反映されていない.
await db.flush("users");
// ここでS3へアップロードされる.
```

`transaction(tableName, fn)`は以下の流れで動作します。

1. `s3Lock.js`で`"master." + tableName`というキーのロックを取得(取得できなければ即座にエラー、リトライ無し)
2. ロック取得直後、キャッシュの有無に関わらず**必ずS3から最新の行データを再取得**する
3. `fn`(引数無しのasync関数)を実行
4. 正常終了時は`flush(tableName)`を実行
5. ロックを解放

`fn`内で例外が発生した場合は、手順2で取得した状態にロールバックし(S3へは一切アップロードしない)、ロックを解放してから例外を再throwします。

```javascript
await db.transaction("users", async () => {
    await db.insert("users", { name: "Alice" });
    await db.update("users", { where: { name: { eq: "Bob" } } }, { age: 26 });
});
```

---

## カラム型・オプション

`string`/`int`/`float`/`boolean`/`date`/`json`/`seqId`の7種類。`date`型はinsert時にDateオブジェクトを受け取り、内部的にはUnixTimeミリ秒のnumberとして保存、select時にDateオブジェクトに変換して返します。`seqId`型は固定長16桁の小文字hex文字列(`modules/s3table/seqId.js`)で、insert時に値省略なら自動生成されます。

カラムオプション: `notNull`(必須)、`default`(デフォルト値、関数も可)、`primaryKey`/`unique`(一意性制約)。`s3IndexTable.js`と異なり、テーブル全体を1回の読み込み→書き戻しサイクルの中で検証できるため`primaryKey`/`unique`をサポートしています(ただし複数の書き込みが同時に発生した場合、後勝ちで上書きされる可能性は既存の制約として残ります)。

`autoIncrement`は提供していません(理由は`seqId.js`の節を参照)。

---

## whereの演算子仕様

`modules/csv/memoryTable.js`相当の演算子(全件走査前提なのでS3側のLIST変換を考慮する必要が無く、そのまま使えます)。

| 演算子 | 意味 |
|---|---|
| `eq` / `ne` | 一致 / 不一致 |
| `gt` / `gte` / `lt` / `lte` | 大小比較(`gte`+`lte`を同じ条件オブジェクトに書けば範囲検索) |
| `in` / `ni` | 複数値のいずれかに一致 / いずれにも一致しない |
| `between` | `[min, max]`の範囲内 |
| `regexp` | 正規表現にマッチ |

複数演算子・複数カラムはいずれもAND評価です。

---

## 使用例

```javascript
const s3MasterTable = $loadLib("s3MasterTable.js");
const db = s3MasterTable.create({ bucket: "my-bucket", prefix: "myapp/" });

await db.createTable("users", {
    columns: {
        id:    { type: "seqId" },
        name:  { type: "string", notNull: true },
        email: { type: "string", unique: true },
        age:   { type: "int", default: 0 },
    }
});

await db.insert("users", { name: "Alice", email: "alice@example.com", age: 30 });
await db.flush("users");

const adults = await db.select("users", {
    where: { age: { gte: 20 } },
    orderBy: { age: "desc" },
});

const stats = await db.select("users", {
    groupBy: ["age"],
    aggregates: { count: { fn: "count" } },
});
```

より詳細な仕様(集計・バックアップ/リストア・CSVインポート/エクスポート等)は[docs/s3MasterTable.md](https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md)を参照してください。

---

## 依存・設定・注意事項

- 依存モジュール: `s3sdk.js`(S3のput/get/delete)、`seqId.js`(seqId型のID発行)、`s3Lock.js`(`transaction()`のテーブルロック)。いずれも`$loadLib`経由。
- **同時書き込み**: S3には行ロックがないため、高頻度の並行書き込みには向きません。読み取り中心・低〜中頻度の書き込みユースケースに最適です(高頻度の書き込みが必要な場合は`s3IndexTable.js`を検討)。
- **データ量**: テーブル全体を1つのJSONとして読み書きするため、数万行程度までが実用的です。
- AWS Lambda環境では`@aws-sdk/client-s3`を利用するため`llrt-lambda-{cpu名}-full-sdk.zip`のレイヤーが必要です。
- `createTable`/`dropTable`/`alterColumns`等のテーブル定義操作は`bin/tableTool`コマンドから操作する想定です(詳細は`bin/README.md`のtableToolコマンド節を参照)。

---

# ◆◆◆ s3IndexTable.js ◆◆◆

1行=1ファイル(`table/{table名}/{行ファイル名}`)でS3に保存する行ファイル型データベースです。**書き込み頻度が多い**用途向けで、行単位のファイルなので書き込み競合がほぼ起きません。代わりに、検索は事前定義したインデックス経由のみ・複合インデックスは先頭カラムのみ範囲検索可、という制約があります(1テーブル1万件程度の小規模利用を想定)。

詳細設計は[docs/s3-row-store-design.md](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)を参照してください。

---

## エクスポート(`create(options).xxx`)

`exports.create(options)`でインスタンスを生成します(`options.bucket`必須、`prefix`/`region`/`credentials`は`s3MasterTable.js`と同様)。

### 主要API一覧

| 分類 | メソッド | 説明 |
|---|---|---|
| テーブル管理 | `createTable(name, schema)` | テーブル作成(カラム定義＋インデックス定義を同時指定) |
| | `dropTable(name)` | テーブル削除(行・インデックス全削除。行数分のDeleteObjectを要する) |
| | `describeTable(name)` / `listTables()` | テーブル定義を取得 |
| | `alterColumns(name, columns)` | カラム定義を丸ごと差し替え(インデックス定義・データは変更しない) |
| インデックス管理 | `createIndex(name, indexName, columns)` | インデックス追加(既存の全行に対してバックフィル) |
| | `dropIndex(name, indexName)` | インデックス削除(定義のみ削除。既存エントリは自己修復に任せる) |
| CRUD | `insert(table, row)` | 1行挿入。呼び出しの度に即座にS3へ反映される(バッファリング無し) |
| | `select(table, query)` | インデックス経由のWHERE・ORDER BY・LIMIT/OFFSET・GROUP BY・集計関数 |
| | `count(table, where)` | WHEREに一致する行数を、インデックスのLISTのみで算出(GetObject無し) |
| | `update(table, query, patch)` | 内部的には対象行を検索→削除→新規行として再作成 |
| | `delete(table, query)` | 行ファイルを即時削除(インデックスは自己修復) |
| 排他制御 | `transaction(table, fn)` | テーブル単位ロック取得＋`fn`実行(ロールバックは提供しない) |
| バックアップ | `backupTable`/`listBackups`/`restoreTable`/`previewRestore`/`pruneBackups`/`describeBackup`/`restoreBackupAs` | `s3MasterTable.js`と同名・同趣旨のAPI |

---

## whereの形式(インデックス名がキー)

`s3MasterTable.js`と異なり、`where`は「**インデックス名をキー**とし、値にそのインデックスの条件を持つオブジェクト」という形式です。`where`が空、またはインデックス名に一致するキーが1つも無い場合はエラーになります(検索は必ず何らかのインデックス経由でなければならない、という制約をこの形式で強制しています)。

```javascript
const s3IndexTable = $loadLib("s3IndexTable.js");
const db = s3IndexTable.create({ bucket: "my-bucket", prefix: "myapp/" });

await db.createTable("users", {
    columns: {
        id:        { type: "seqId" },
        name:      { type: "string", notNull: true },
        email:     { type: "string", notNull: true },
        age:       { type: "int", default: 0 },
        createdAt: { type: "date", default: () => new Date() },
    },
    indexes: {
        byId: ["id"],
        byEmail: ["email"],
        byAgeCreated: ["age", "createdAt"], // 複合インデックス(先頭カラムのみ範囲検索可)
    }
});

const row = await db.insert("users", { name: "Alice", email: "a@example.com", age: 30 });

// 先頭カラム(age)のみ範囲検索、以降(createdAt)は等価のみ
const rows = await db.select("users", {
    where: { byAgeCreated: { age: { gte: 20, lte: 40 }, createdAt: 12345678 } },
    orderBy: { byAgeCreated: "asc" },
    limit: 100,
});

// 複数インデックスをまたぐAND条件(候補行ファイル名の積集合)
const rows2 = await db.select("users", {
    where: { byEmail: { email: "a@example.com" }, byId: {} }
});

await db.update("users", { where: { byId: { id: row.id } } }, { age: 31 });
await db.delete("users", { where: { byId: { id: row.id } } });
```

サポートする演算子は先頭カラムが`eq`/`gt`/`gte`/`lt`/`lte`/`in`、後続カラムが`eq`/`in`のみです(`ne`・`regexp`・部分一致は非対応。理由は`docs/s3-row-store-design.md`参照)。

---

## カラム型・インデックス対応

`string`/`int`/`float`/`boolean`/`date`/`json`/`seqId`。**`json`型カラムはインデックス対象にできません**(`createTable`/`createIndex`時にエラー)。カラムオプションは`notNull`と`default`のみで、`primaryKey`/`unique`/`autoIncrement`はサポートしていません(挿入時の一意性確認と書き込みの間にTOCTOU競合が起きるため。連番採番が必要な場合は`seqId`型を使用)。

数値・日付は固定長バイナリ化+符号ビット反転してからhexエンコードすることで、辞書順ソート=数値順ソートを実現しています。文字列はUTF-8バイナリをそのままhex化します(インデックス対象文字列はUTF-8で255バイトまで)。

---

## 自己修復・トランザクションの制約

- **DELETE**は行ファイルを即座に削除するだけで、インデックスの後始末はしません。読み取り時にインデックス経由でGetObjectして存在しない(404相当)場合、その場でそのインデックスエントリだけ削除する「自己修復」方式です。
- **UPDATE**は内部的に「削除＋新規行として再作成」であり、旧インデックスエントリは古い行ファイルを指したまま残りますが、これも自己修復で処理されます。
- `transaction(tableName, fn)`は`s3MasterTable.js`と異なり**ロールバックを提供しません**。`insert`/`update`/`delete`が呼び出しの度に即座にS3へ反映される設計のため、途中まで書き込んだ変更を安価に巻き戻す手段が無く、同時実行の排他(複数の`transaction`が同じテーブルに同時に走らないこと)のみを保証します。
- `count(tableName, where)`は`select`と異なり自己修復を行わないため、staleなインデックスエントリが残っている場合、実件数より多く数える可能性があります。

---

## 使用例

```javascript
const db = s3IndexTable.create({ bucket: "my-bucket", prefix: "myapp/" });

await db.transaction("users", async () => {
    await db.insert("users", { name: "Alice", email: "a@example.com", age: 30 });
});

const stats = await db.select("users", {
    where: { byAgeCreated: { age: { gte: 20, lte: 40 } } },
    groupBy: ["age"],
    aggregates: { count: { fn: "count" }, avgCreatedAt: { fn: "avg", col: "createdAt" } },
});
```

より詳細な仕様(値エンコード方式・積集合アルゴリズム・ページングの制約等)は[docs/s3-row-store-design.md](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)を参照してください。

---

## 依存・設定・注意事項

- 依存モジュール: `s3sdk.js`、`seqId.js`、`s3Lock.js`(いずれも`$loadLib`経由)。加えて`crypto`(`$require("crypto")`、行ファイル名のランダム部分生成用)を利用。
- `dropTable`は行数分のDeleteObjectを要し、既存テーブルへの`createIndex`は全行分のバックフィルを要します。`update`も対象行の全インデックスエントリを作り直すコストを伴います。いずれも1万件程度までを前提とした許容コストです。
- バックアップ/リストア系API(`backupTable`/`listBackups`/`restoreTable`/`previewRestore`/`pruneBackups`/`describeBackup`/`restoreBackupAs`)は`s3MasterTable.js`と共通の物理コピー方式(S3の`CopyObject`は使わずget/put経由で複製)です。行データに加えてインデックスエントリも複製する点が`s3MasterTable.js`との違いです。
- AWS Lambda環境では`@aws-sdk/client-s3`を利用するため`llrt-lambda-{cpu名}-full-sdk.zip`のレイヤーが必要です。
- `createTable`/`dropTable`/`alterColumns`/`createIndex`/`dropIndex`等のテーブル管理操作は`bin/tableTool`コマンドから操作する想定です(詳細は`bin/README.md`のtableToolコマンド節を参照)。

# ◆◆◆ EOF ◆◆◆
