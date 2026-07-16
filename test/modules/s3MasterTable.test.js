// modules/sdk/s3MasterTable.js のテスト.
// 実際のS3への通信は行わず、get/put/deleteをインメモリでエミュレートする
// フェイクなs3sdkを $loadLib 経由で注入して検証する
// (s3MasterTable.jsはlistを使用しないため、s3IndexTable.jsと異なりCRUD全体を
//  実際に動かして検証できる)。
const { test } = require("node:test");
const assert = require("node:assert/strict");

// フェイクS3(bucket/prefix/keyの組をMapで管理する).
const makeFakeS3sdk = function () {
    const store = new Map();
    const k = (bucket, prefix, key) => bucket + "/" + (prefix || "") + "/" + key;
    return {
        put: async (bucket, prefix, key, body) => {
            store.set(k(bucket, prefix, key), body);
            return true;
        },
        get: async (bucket, prefix, key) => {
            const key2 = k(bucket, prefix, key);
            if (!store.has(key2)) {
                return null;
            }
            const body = store.get(key2);
            return { Body: { transformToString: async () => body } };
        },
        delete: async (bucket, prefix, key) => {
            store.delete(k(bucket, prefix, key));
            return true;
        },
        list: async () => ({ Contents: [], IsTruncated: false })
    };
};

global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return makeFakeS3sdk();
    }
    if (name === "csvReader.js") {
        return require("../../modules/csv/csvReader.js");
    }
    if (name === "csvWriter.js") {
        return require("../../modules/csv/csvWriter.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};

// s3MasterTable.js はrequireキャッシュされるため、テストごとに独立したフェイク
// S3state(=db)が欲しい場合は create() の bucket を変えて分離する。
const s3MasterTable = require("../../modules/sdk/s3MasterTable.js");

let bucketSeq = 0;
const createDb = () => s3MasterTable.create({ bucket: "test-bucket-" + (bucketSeq++) });

test("s3MasterTable: createTable/dropTable/describeTable", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            id: { type: "int", primaryKey: true },
            name: { type: "string", notNull: true }
        }
    });
    const schema = await db.describeTable("users");
    assert.equal(schema.columns.name.notNull, true);

    await db.dropTable("users");
    await assert.rejects(() => db.describeTable("users"));
});

test("s3MasterTable: createTableは既存テーブルに対してエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", { columns: { id: { type: "int" } } });
    await assert.rejects(() => db.createTable("users", { columns: { id: { type: "int" } } }));
});

test("s3MasterTable: insert/selectの基本動作", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            id: { type: "int" },
            name: { type: "string" },
            age: { type: "int" }
        }
    });
    await db.insert("users", { id: 1, name: "Alice", age: 30 });
    await db.insert("users", { id: 2, name: "Bob", age: 25 });

    const rows = await db.select("users", {});
    assert.equal(rows.length, 2);
});

test("s3MasterTable: notNullを満たさないinsertはエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { name: { type: "string", notNull: true } }
    });
    await assert.rejects(() => db.insert("users", {}));
});

test("s3MasterTable: defaultは値省略時に適用される", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            name: { type: "string" },
            role: { type: "string", default: "user" }
        }
    });
    const [row] = await db.insert("users", { name: "Alice" });
    assert.equal(row.role, "user");
});

test("s3MasterTable: unique/primaryKeyは重複をエラーにする", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { email: { type: "string", unique: true } }
    });
    await db.insert("users", { email: "a@example.com" });
    await assert.rejects(() => db.insert("users", { email: "a@example.com" }));
});

test("s3MasterTable: 型が一致しないinsertはエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", { columns: { age: { type: "int" } } });
    await assert.rejects(() => db.insert("users", { age: "not-a-number" }));
});

test("s3MasterTable: whereの演算子(eq/gte/lte/in/ni/between/regexp)が動作する", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert("users", [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 },
        { id: 3, name: "Carol", age: 42 },
        { id: 4, name: "Dave", age: 22 }
    ]);

    let rows = await db.select("users", { where: { age: { gte: 25, lte: 40 } } });
    assert.deepEqual(rows.map((r) => r.name).sort(), ["Alice", "Bob"]);

    rows = await db.select("users", { where: { id: { in: [1, 3] } } });
    assert.deepEqual(rows.map((r) => r.name).sort(), ["Alice", "Carol"]);

    rows = await db.select("users", { where: { id: { ni: [1, 3] } } });
    assert.deepEqual(rows.map((r) => r.name).sort(), ["Bob", "Dave"]);

    rows = await db.select("users", { where: { age: { between: [20, 30] } } });
    assert.deepEqual(rows.map((r) => r.name).sort(), ["Alice", "Bob", "Dave"]);

    rows = await db.select("users", { where: { name: { regexp: /^A/ } } });
    assert.deepEqual(rows.map((r) => r.name), ["Alice"]);
});

test("s3MasterTable: orderBy/offset/limitが動作する", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert("users", [
        { name: "Alice", age: 30 }, { name: "Bob", age: 25 },
        { name: "Carol", age: 42 }, { name: "Dave", age: 22 }
    ]);
    const rows = await db.select("users", {
        orderBy: { age: "asc" }, offset: 1, limit: 2
    });
    assert.deepEqual(rows.map((r) => r.name), ["Bob", "Alice"]);
});

test("s3MasterTable: groupBy/集計関数が動作する", async () => {
    const db = createDb();
    await db.createTable("orders", {
        columns: { userId: { type: "int" }, amount: { type: "int" } }
    });
    await db.insert("orders", [
        { userId: 1, amount: 100 }, { userId: 1, amount: 200 },
        { userId: 2, amount: 50 }
    ]);
    const stats = await db.select("orders", {
        groupBy: ["userId"],
        aggregates: { total: { fn: "sum", col: "amount" }, cnt: { fn: "count" } }
    });
    const byUser = Object.fromEntries(stats.map((s) => [s.userId, s]));
    assert.equal(byUser[1].total, 300);
    assert.equal(byUser[1].cnt, 2);
    assert.equal(byUser[2].total, 50);
});

test("s3MasterTable: update/deleteが動作する", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int" }, age: { type: "int" } }
    });
    await db.insert("users", [{ id: 1, age: 30 }, { id: 2, age: 25 }]);

    const updated = await db.update("users", { where: { id: { eq: 1 } } }, { age: 31 });
    assert.equal(updated, 1);
    let rows = await db.select("users", { where: { id: { eq: 1 } } });
    assert.equal(rows[0].age, 31);

    const deleted = await db.delete("users", { where: { id: { eq: 2 } } });
    assert.equal(deleted, 1);
    rows = await db.select("users", {});
    assert.equal(rows.length, 1);
});

test("s3MasterTable: date型はinsert時にDateを受け取りselect時にDateとして返す", async () => {
    const db = createDb();
    await db.createTable("events", {
        columns: { name: { type: "string" }, at: { type: "date" } }
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await db.insert("events", [
        { name: "start", at: at },
        { name: "past", at: new Date("2020-01-01T00:00:00Z") }
    ]);

    const rows = await db.select("events", { where: { name: { eq: "start" } } });
    assert.equal(rows[0].at instanceof Date, true);
    assert.equal(rows[0].at.getTime(), at.getTime());

    // where条件でもDateオブジェクトで比較できる(gteが正しく機能し、
    // 過去の日付(past)は除外されること).
    const filtered = await db.select("events", {
        where: { at: { gte: new Date("2025-12-31T00:00:00Z") } }
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].name, "start");
});

test("s3MasterTable: exportCsv はテーブル内容をCSV文字列で返す", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert("users", [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 }
    ]);
    const csv = await db.exportCsv("users");
    assert.match(csv, /id,name,age/);
    assert.match(csv, /1,Alice,30/);
    assert.match(csv, /2,Bob,25/);
});

test("s3MasterTable: importCsv はテーブル全体をCSVの内容で置き換える", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            id: { type: "int", primaryKey: true },
            name: { type: "string", notNull: true },
            age: { type: "int" }
        }
    });
    await db.insert("users", { id: 99, name: "Existing", age: 99 });

    const csv = "id,name,age\n1,Alice,30\n2,Bob,25\n";
    const count = await db.importCsv("users", csv);
    assert.equal(count, 2);

    const rows = await db.select("users", { orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.name), ["Alice", "Bob"]);

    // 既存データは完全に置き換わっている(Existingが残っていない).
    assert.equal(rows.some((r) => r.name === "Existing"), false);

    const [added] = await db.insert("users", { id: 3, name: "Carol" });
    assert.equal(added.id, 3);
});

test("s3MasterTable: importCsvはnotNull/unique違反があればエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { name: { type: "string", notNull: true }, age: { type: "int" } }
    });
    // 2行目は name が空セル(notNull違反)。
    const csv = "name,age\nAlice,30\n,10\n";
    await assert.rejects(() => db.importCsv("users", csv));
});

test("s3MasterTable: exportCsv→importCsvで内容が往復する", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert("users", [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 }
    ]);
    const csv = await db.exportCsv("users");
    await db.importCsv("users", csv);
    const rows = await db.select("users", { orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => ({ id: r.id, name: r.name, age: r.age })), [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 }
    ]);
});
