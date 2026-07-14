// modules/sdk/s3db.js のテスト.
// 実際のS3への通信は行わず、get/put/deleteをインメモリでエミュレートする
// フェイクなs3sdkを $loadLib 経由で注入して検証する
// (s3db.jsはlistを使用しないため、s3IndexTable.jsと異なりCRUD全体を
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
    throw new Error("unexpected $loadLib: " + name);
};

// s3db.js はrequireキャッシュされるため、テストごとに独立したフェイク
// S3state(=db)が欲しい場合は create() の bucket を変えて分離する。
const s3db = require("../../modules/sdk/s3db.js");

let bucketSeq = 0;
const createDb = () => s3db.create({ bucket: "test-bucket-" + (bucketSeq++) });

test("s3db: createTable/dropTable/describeTable", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            id: { type: "int", primaryKey: true, autoIncrement: true },
            name: { type: "string", notNull: true }
        }
    });
    const schema = await db.describeTable("users");
    assert.equal(schema.columns.name.notNull, true);

    await db.dropTable("users");
    await assert.rejects(() => db.describeTable("users"));
});

test("s3db: createTableは既存テーブルに対してエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", { columns: { id: { type: "int" } } });
    await assert.rejects(() => db.createTable("users", { columns: { id: { type: "int" } } }));
});

test("s3db: insert/selectの基本動作", async () => {
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

test("s3db: notNullを満たさないinsertはエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { name: { type: "string", notNull: true } }
    });
    await assert.rejects(() => db.insert("users", {}));
});

test("s3db: defaultは値省略時に適用される", async () => {
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

test("s3db: autoIncrementは連番を振る", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int", autoIncrement: true }, name: { type: "string" } }
    });
    const [r1] = await db.insert("users", { name: "Alice" });
    const [r2] = await db.insert("users", { name: "Bob" });
    assert.equal(r1.id, 1);
    assert.equal(r2.id, 2);
});

test("s3db: unique/primaryKeyは重複をエラーにする", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { email: { type: "string", unique: true } }
    });
    await db.insert("users", { email: "a@example.com" });
    await assert.rejects(() => db.insert("users", { email: "a@example.com" }));
});

test("s3db: 型が一致しないinsertはエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", { columns: { age: { type: "int" } } });
    await assert.rejects(() => db.insert("users", { age: "not-a-number" }));
});

test("s3db: whereの演算子(eq/gte/lte/in/ni/between/regexp)が動作する", async () => {
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

test("s3db: orderBy/offset/limitが動作する", async () => {
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

test("s3db: groupBy/集計関数が動作する", async () => {
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

test("s3db: update/deleteが動作する", async () => {
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

test("s3db: date型はinsert時にDateを受け取りselect時にDateとして返す", async () => {
    const db = createDb();
    await db.createTable("events", {
        columns: { name: { type: "string" }, at: { type: "date" } }
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await db.insert("events", { name: "start", at: at });

    const rows = await db.select("events", {});
    assert.equal(rows[0].at instanceof Date, true);
    assert.equal(rows[0].at.getTime(), at.getTime());

    // where条件でもDateオブジェクトで比較できる.
    const filtered = await db.select("events", {
        where: { at: { ge: new Date("2025-12-31T00:00:00Z") } }
    });
    assert.equal(filtered.length, 1);
});
