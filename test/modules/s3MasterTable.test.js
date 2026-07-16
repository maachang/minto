// modules/s3table/s3MasterTable.js のテスト.
// 実際のS3への通信は行わず、get/put/deleteをインメモリでエミュレートする
// フェイクなs3sdkを $loadLib 経由で注入して検証する
// (s3MasterTable.jsはlistを使用しないため、s3IndexTable.jsと異なりCRUD全体を
//  実際に動かして検証できる)。
const { test } = require("node:test");
const assert = require("node:assert/strict");

// フェイクS3(bucket/prefix/keyの組をMapで管理する).
// storeを直接公開し、flush前後でS3(相当)に実際に反映されたかをテストから
// 直接検証できるようにする.
const makeFakeS3sdk = function () {
    const store = new Map();
    const k = (bucket, prefix, key) => bucket + "/" + (prefix || "") + "/" + key;
    return {
        store: store,
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

// $loadLib("s3sdk.js")はs3MasterTable.jsのモジュールロード時に1度だけ
// 呼ばれるため、ここで生成したインスタンスがテスト全体で共有される.
const fakeS3sdk = makeFakeS3sdk();

// フェイクs3Lock(インメモリのSetでロック中キーを管理する).
// create()を呼ぶたびに独立したロック名前空間を持たせる
// (db(=s3MasterTable.create())インスタンスごとにロックが分離されるように).
const makeFakeS3Lock = function () {
    return {
        create: () => {
            const locked = new Set();
            return {
                acquire: async (lockKey) => {
                    if (locked.has(lockKey)) {
                        return false;
                    }
                    locked.add(lockKey);
                    return true;
                },
                release: async (lockKey) => {
                    locked.delete(lockKey);
                }
            };
        }
    };
};

global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return fakeS3sdk;
    }
    if (name === "csvReader.js") {
        return require("../../modules/csv/csvReader.js");
    }
    if (name === "csvWriter.js") {
        return require("../../modules/csv/csvWriter.js");
    }
    if (name === "seqId.js") {
        return require("../../modules/s3table/seqId.js");
    }
    if (name === "s3Lock.js") {
        return makeFakeS3Lock();
    }
    throw new Error("unexpected $loadLib: " + name);
};

// s3MasterTable.js はrequireキャッシュされるため、テストごとに独立したフェイク
// S3state(=db)が欲しい場合は create() の bucket を変えて分離する。
const s3MasterTable = require("../../modules/s3table/s3MasterTable.js");

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

test("s3MasterTable: seqId型は値省略時に自動採番され、一意なIDになる", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: {
            id: { type: "seqId", primaryKey: true },
            name: { type: "string" }
        }
    });
    const [alice] = await db.insert("users", { name: "Alice" });
    const [bob] = await db.insert("users", { name: "Bob" });
    assert.equal(typeof alice.id, "string");
    assert.match(alice.id, /^[0-9a-f]{16}$/);
    assert.notEqual(alice.id, bob.id);
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

test("s3MasterTable: listTablesは全テーブル分の定義をテーブル名キーで返す", async () => {
    const db = createDb();
    await db.createTable("users", { columns: { name: { type: "string" } } });
    await db.createTable("orders", { columns: { amount: { type: "int" } } });

    const tables = await db.listTables();
    assert.deepEqual(Object.keys(tables).sort(), ["orders", "users"]);
    assert.equal(tables.users.columns.name.type, "string");

    await db.dropTable("orders");
    const after = await db.listTables();
    assert.deepEqual(Object.keys(after), ["users"]);
});

test("s3MasterTable: alterColumnsでカラム定義を差し替えられる(既存データは保持)", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert("users", { name: "Alice", age: 30 });

    // age列を削除し、role列(default付き)を追加.
    await db.alterColumns("users", {
        name: { type: "string" },
        role: { type: "string", default: "member" }
    });

    const rows = await db.select("users", {});
    // 削除されたage列はselect結果から除外される.
    assert.equal(rows[0].age, undefined);
    assert.equal(rows[0].name, "Alice");

    const [added] = await db.insert("users", { name: "Bob" });
    assert.equal(added.role, "member");

    await assert.rejects(() => db.alterColumns("no-such-table", {}));
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

// フェイクS3(fakeS3sdk.store)に実際にアップロードされた行データを直接取得する
// (無ければundefined). bucket 対象バケット名. tableName 対象テーブル名.
const rawStoredRows = function (bucket, tableName) {
    const key = bucket + "/table/" + tableName + "/data.json";
    if (!fakeS3sdk.store.has(key)) {
        return undefined;
    }
    return JSON.parse(fakeS3sdk.store.get(key));
};

test("s3MasterTable: insert/update/deleteはflushするまでS3(相当)に反映されない", async () => {
    const db = createDb();
    const bucket = "test-bucket-" + (bucketSeq - 1);
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" } }
    });
    // createTableの時点で空配列が即時アップロードされている.
    assert.deepEqual(rawStoredRows(bucket, "users"), []);

    await db.insert("users", { id: 1, name: "Alice" });
    // flush前なのでS3(相当)にはまだ反映されていない.
    assert.deepEqual(rawStoredRows(bucket, "users"), []);
    // 一方でselect(同一db内)は未flushの変更を参照できる(read-your-own-writes).
    assert.equal((await db.select("users", {})).length, 1);

    await db.flush("users");
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice" }]);

    await db.update("users", { where: { id: { eq: 1 } } }, { name: "Alice2" });
    await db.delete("users", { where: { id: { eq: 99 } } });
    // update/delete後もflush前はS3(相当)は直前のflush時点のまま.
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice" }]);

    await db.flush("users");
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice2" }]);
});

test("s3MasterTable: transactionは成功時にロック取得→flush→ロック解放まで行う", async () => {
    const db = createDb();
    const bucket = "test-bucket-" + (bucketSeq - 1);
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" } }
    });

    await db.transaction("users", async () => {
        await db.insert("users", { id: 1, name: "Alice" });
        // flush前なのでこの時点ではまだS3(相当)には反映されない.
        assert.deepEqual(rawStoredRows(bucket, "users"), []);
    });

    // transaction完了後はflushされている.
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice" }]);

    // ロックは解放されているので再度transactionを実行できる.
    await db.transaction("users", async () => {
        await db.insert("users", { id: 2, name: "Bob" });
    });
    assert.deepEqual(rawStoredRows(bucket, "users"), [
        { id: 1, name: "Alice" }, { id: 2, name: "Bob" }
    ]);
});

test("s3MasterTable: transaction内で例外が発生した場合はロールバックしS3(相当)に反映されない", async () => {
    const db = createDb();
    const bucket = "test-bucket-" + (bucketSeq - 1);
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" } }
    });
    await db.insert("users", { id: 1, name: "Alice" });
    await db.flush("users");
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice" }]);

    await assert.rejects(() => db.transaction("users", async () => {
        await db.insert("users", { id: 2, name: "Bob" });
        throw new Error("boom");
    }), /boom/);

    // ロールバックにより、メモリ・S3(相当)ともにtransaction前の状態のまま.
    assert.deepEqual(rawStoredRows(bucket, "users"), [{ id: 1, name: "Alice" }]);
    assert.deepEqual(await db.select("users", {}), [{ id: 1, name: "Alice" }]);

    // ロックは例外発生時も解放されているので、再度transactionを実行できる.
    await db.transaction("users", async () => {
        await db.insert("users", { id: 2, name: "Bob" });
    });
    assert.deepEqual(rawStoredRows(bucket, "users"), [
        { id: 1, name: "Alice" }, { id: 2, name: "Bob" }
    ]);
});

test("s3MasterTable: 同じテーブルで既にtransactionが実行中の場合は即座にエラーになる", async () => {
    const db = createDb();
    await db.createTable("users", {
        columns: { id: { type: "int" }, name: { type: "string" } }
    });

    let releaseFirst;
    const firstTransaction = db.transaction("users", async () => {
        await new Promise((resolve) => { releaseFirst = resolve; });
        await db.insert("users", { id: 1, name: "Alice" });
    });

    // 1つ目のtransactionがロックを保持している間に、2つ目を実行すると失敗する.
    await assert.rejects(() => db.transaction("users", async () => {
        await db.insert("users", { id: 2, name: "Bob" });
    }), /Failed to acquire lock/);

    releaseFirst();
    await firstTransaction;
});
