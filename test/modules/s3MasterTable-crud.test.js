// modules/s3table/s3MasterTable.js のCRUD/検索エンジン本体のテスト.
//
// s3IndexTable-crud.test.jsと同じ方針で、tools/localS3.js(ローカルS3
// エミュレータ)を子プロセスとして起動し、実際に@aws-sdk/client-s3経由で
// テーブル全体1JSON方式のCRUD・where演算子・GROUP BY・CSVエクスポート/
// インポートを検証する。
//
// 本テストの実行には @aws-sdk/client-s3(devDependencies)が必要。
// `npm install` 済みであれば自動的に実行される。
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const LOCAL_S3_JS = path.join(MINTO_HOME, "tools", "localS3.js");
const BUCKET = "test-bucket";

let child;
let storageDir;
let baseUrl;

// OSに空きポートを割り当ててもらう.
const getFreePort = function () {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const p = srv.address().port;
            srv.close(() => resolve(p));
        });
        srv.on("error", reject);
    });
};

// サーバーが起動してリクエストに応答できるようになるまでポーリングする.
const waitForServer = async function (url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const res = await fetch(url);
            await res.arrayBuffer();
            return;
        } catch (e) {
            if (Date.now() - start > timeoutMs) {
                throw new Error("localS3 did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3MasterTable-test-"));
    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [LOCAL_S3_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/" + BUCKET + "?list-type=2", 5000);

    // AWSクレデンシャルは明示的に設定しない。MINTO_LOCAL_S3_ENDPOINT設定時は
    // s3sdk.js側が自動的にダミークレデンシャルを使うため不要(この動作自体の
    // 回帰テストを兼ねる)。実行環境に既にAWS認証情報が設定されていてもその
    // 経路を通らないことを保証するため、明示的に削除しておく.
    process.env.MINTO_LOCAL_S3_ENDPOINT = baseUrl;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
});

after(() => {
    if (child != null) {
        child.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
});

// s3MasterTable.jsは $loadLib 経由でs3sdk.js/csvWriter.js/csvReader.jsを
// 取得する実装のため、テスト用にスタブしてから読み込む.
global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return require("../../modules/s3table/s3sdk.js");
    }
    if (name === "csvWriter.js") {
        return require("../../modules/csv/csvWriter.js");
    }
    if (name === "csvReader.js") {
        return require("../../modules/csv/csvReader.js");
    }
    if (name === "seqId.js") {
        return require("../../modules/s3table/seqId.js");
    }
    if (name === "s3Lock.js") {
        return require("../../modules/s3table/s3Lock.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.$require = function (name) {
    return require(name);
};
const s3MasterTable = require("../../modules/s3table/s3MasterTable.js");
const s3sdk = require("../../modules/s3table/s3sdk.js");

let _tableSeq = 0;
// テスト間で衝突しないユニークなテーブル名を生成.
const nextTableName = function () {
    return "tbl_" + (_tableSeq++);
};

const createDb = function () {
    return s3MasterTable.create({ bucket: BUCKET });
};

test("s3MasterTable: createTable + insert + select(全件)で登録した行が取得できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            name: { type: "string" },
            age: { type: "int" }
        }
    });
    await db.insert(table, { name: "alice", age: 20 });
    await db.insert(table, [{ name: "bob", age: 30 }, { name: "carol", age: 40 }]);

    const rows = await db.select(table, {});
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.name).sort(), ["alice", "bob", "carol"]);
});

test("s3MasterTable: createTableは同名テーブルの再作成をエラーにする", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.createTable(table, { columns: { name: { type: "string" } } }));
});

test("s3MasterTable: where演算子(eq/ne/gt/gte/lt/lte/in/ni/between/regexp)が機能する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, score: { type: "int" } }
    });
    await db.insert(table, [
        { name: "alice", score: 10 },
        { name: "bob", score: 20 },
        { name: "carol", score: 30 },
        { name: "dave", score: 40 }
    ]);

    const eq = await db.select(table, { where: { score: { eq: 20 } } });
    assert.deepEqual(eq.map((r) => r.name), ["bob"]);

    const ne = await db.select(table, { where: { score: { ne: 20 } } });
    assert.deepEqual(ne.map((r) => r.name).sort(), ["alice", "carol", "dave"]);

    const gt = await db.select(table, { where: { score: { gt: 20 } } });
    assert.deepEqual(gt.map((r) => r.name).sort(), ["carol", "dave"]);

    const gte = await db.select(table, { where: { score: { gte: 20 } } });
    assert.deepEqual(gte.map((r) => r.name).sort(), ["bob", "carol", "dave"]);

    const lt = await db.select(table, { where: { score: { lt: 20 } } });
    assert.deepEqual(lt.map((r) => r.name), ["alice"]);

    const lte = await db.select(table, { where: { score: { lte: 20 } } });
    assert.deepEqual(lte.map((r) => r.name).sort(), ["alice", "bob"]);

    const inOp = await db.select(table, { where: { score: { in: [10, 30] } } });
    assert.deepEqual(inOp.map((r) => r.name).sort(), ["alice", "carol"]);

    const ni = await db.select(table, { where: { score: { ni: [10, 30] } } });
    assert.deepEqual(ni.map((r) => r.name).sort(), ["bob", "dave"]);

    const between = await db.select(table, { where: { score: { between: [20, 30] } } });
    assert.deepEqual(between.map((r) => r.name).sort(), ["bob", "carol"]);

    const regexp = await db.select(table, { where: { name: { regexp: "^(a|b)" } } });
    assert.deepEqual(regexp.map((r) => r.name).sort(), ["alice", "bob"]);
});

test("s3MasterTable: orderBy(asc/desc)・offset/limit・columns指定が機能する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, score: { type: "int" } }
    });
    await db.insert(table, [
        { name: "c", score: 30 },
        { name: "a", score: 10 },
        { name: "b", score: 20 }
    ]);

    const asc = await db.select(table, { orderBy: { score: "asc" } });
    assert.deepEqual(asc.map((r) => r.score), [10, 20, 30]);

    const desc = await db.select(table, { orderBy: { score: "desc" } });
    assert.deepEqual(desc.map((r) => r.score), [30, 20, 10]);

    const paged = await db.select(table, { orderBy: { score: "asc" }, offset: 1, limit: 1 });
    assert.equal(paged.length, 1);
    assert.equal(paged[0].score, 20);

    const projected = await db.select(table, { orderBy: { score: "asc" }, columns: ["score"] });
    assert.deepEqual(projected, [{ score: 10 }, { score: 20 }, { score: 30 }]);
});

test("s3MasterTable: groupBy/集計(count/sum/avg/min/max)が計算できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { category: { type: "string" }, price: { type: "int" } }
    });
    await db.insert(table, [
        { category: "a", price: 100 },
        { category: "a", price: 300 },
        { category: "b", price: 50 }
    ]);

    const result = await db.select(table, {
        groupBy: ["category"],
        aggregates: {
            cnt: { fn: "count" },
            total: { fn: "sum", col: "price" },
            avgPrice: { fn: "avg", col: "price" },
            minPrice: { fn: "min", col: "price" },
            maxPrice: { fn: "max", col: "price" }
        }
    });
    const byCat = {};
    for (const r of result) { byCat[r.category] = r; }
    assert.equal(byCat.a.cnt, 2);
    assert.equal(byCat.a.total, 400);
    assert.equal(byCat.a.avgPrice, 200);
    assert.equal(byCat.a.minPrice, 100);
    assert.equal(byCat.a.maxPrice, 300);
    assert.equal(byCat.b.cnt, 1);
});

test("s3MasterTable: updateで内容が更新され、更新後の値で検索できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert(table, { name: "alice", age: 20 });

    const cnt = await db.update(table, { where: { name: { eq: "alice" } } }, { age: 21 });
    assert.equal(cnt, 1);

    const rows = await db.select(table, { where: { name: { eq: "alice" } } });
    assert.equal(rows[0].age, 21);
});

test("s3MasterTable: deleteで行が削除され検索結果から消える", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, [{ name: "alice" }, { name: "bob" }]);

    const cnt = await db.delete(table, { where: { name: { eq: "alice" } } });
    assert.equal(cnt, 1);

    const rows = await db.select(table, {});
    assert.deepEqual(rows.map((r) => r.name), ["bob"]);
});

test("s3MasterTable: primaryKey/uniqueカラムは重複挿入がエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            email: { type: "string", unique: true },
            name: { type: "string" }
        }
    });
    await db.insert(table, { email: "a@example.com", name: "alice" });
    await assert.rejects(() => db.insert(table, { email: "a@example.com", name: "alice2" }));
});

test("s3MasterTable: seqId型は自動採番され、生成順に範囲検索(gt)で並べられる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            id: { type: "seqId", primaryKey: true },
            name: { type: "string" }
        }
    });
    const [alice] = await db.insert(table, { name: "alice" });
    const [bob] = await db.insert(table, { name: "bob" });
    const [carol] = await db.insert(table, { name: "carol" });

    const rows = await db.select(table, { where: { id: { gt: alice.id } }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.name), ["bob", "carol"]);
    assert.equal(bob.id < carol.id, true);
});

test("s3MasterTable: date型カラムはDateオブジェクトで挿入・取得・比較できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, birthday: { type: "date" } }
    });
    const birthday = new Date("2000-01-01T00:00:00Z");
    await db.insert(table, { name: "alice", birthday: birthday });

    const rows = await db.select(table, {});
    assert.equal(rows[0].birthday instanceof Date, true);
    assert.equal(rows[0].birthday.getTime(), birthday.getTime());

    const filtered = await db.select(table, {
        where: { birthday: { eq: new Date("2000-01-01T00:00:00Z") } }
    });
    assert.equal(filtered.length, 1);
});

test("s3MasterTable: dropTable後はdescribeTable/selectがエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.dropTable(table);

    await assert.rejects(() => db.describeTable(table));
    await assert.rejects(() => db.select(table, {}));

    // 集約ファイル(table.json)からも該当テーブルの定義が削除されていること.
    const defsRes = await s3sdk.get(BUCKET, null, "table.json", { noError: true });
    const defs = defsRes == null ? {} : JSON.parse(await defsRes.Body.transformToString("utf-8"));
    assert.equal(defs[table], undefined);
});

test("s3MasterTable: exportCsv/importCsvでテーブル内容を往復できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, age: { type: "int" } }
    });
    await db.insert(table, [{ name: "alice", age: 20 }, { name: "bob", age: 30 }]);

    const csv = await db.exportCsv(table);
    assert.match(csv, /alice/);
    assert.match(csv, /bob/);

    const table2 = nextTableName();
    await db.createTable(table2, {
        columns: { name: { type: "string" }, age: { type: "int" } }
    });
    const importedCount = await db.importCsv(table2, csv);
    assert.equal(importedCount, 2);

    const rows = await db.select(table2, { orderBy: { name: "asc" } });
    assert.deepEqual(rows.map((r) => r.name), ["alice", "bob"]);
    assert.deepEqual(rows.map((r) => r.age), [20, 30]);
});

// S3(localS3)上の生の行データを直接取得する(flushされたかどうかの確認用).
const rawStoredRows = async function (table) {
    const res = await s3sdk.get(BUCKET, "table/" + table, "data.json", { noError: true });
    if (res == null) {
        return undefined;
    }
    return JSON.parse(await res.Body.transformToString("utf-8"));
};

test("s3MasterTable: insertはflushするまで実際のS3に反映されず、flush後に反映される", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });

    await db.insert(table, { name: "alice" });
    assert.deepEqual(await rawStoredRows(table), []);

    await db.flush(table);
    assert.deepEqual(await rawStoredRows(table), [{ name: "alice" }]);
});

test("s3MasterTable: transactionは実際のS3上でテーブルロック(master.テーブル名)を使い、成功時にflushする", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });

    await db.transaction(table, async () => {
        await db.insert(table, { name: "alice" });
    });
    assert.deepEqual(await rawStoredRows(table), [{ name: "alice" }]);

    // transaction完了後はロックが解放されているため、既存のs3Lock.js経由でも
    // 同じロックキー("master."+テーブル名)を取得できる.
    const s3Lock = require("../../modules/s3table/s3Lock.js");
    const lock = s3Lock.create({ bucket: BUCKET });
    const acquired = await lock.acquire("master." + table);
    assert.equal(acquired, true);
    await lock.release("master." + table);
});

test("s3MasterTable: 実際のS3上で既にロックが取得されている場合、transactionは失敗する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });

    const s3Lock = require("../../modules/s3table/s3Lock.js");
    const lock = s3Lock.create({ bucket: BUCKET });
    await lock.acquire("master." + table);

    await assert.rejects(() => db.transaction(table, async () => {
        await db.insert(table, { name: "alice" });
    }), /Failed to acquire lock/);

    // 失敗時は何もアップロードされていない.
    assert.deepEqual(await rawStoredRows(table), []);

    await lock.release("master." + table);
});

test("s3MasterTable: backupTable/restoreTableで行データ・スキーマを世代管理して復元できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, { name: "alice" });
    await db.flush(table);

    const backup1 = await db.backupTable(table);
    assert.equal(backup1.tableName, table);
    assert.equal(backup1.rowCount, 1);
    // s3MasterTable.jsにはインデックスが無いためindexEntryCountは含まれない.
    assert.equal(backup1.indexEntryCount, undefined);

    // バックアップ後にデータを変更(bobを追加、flushして反映).
    await db.insert(table, { name: "bob" });
    await db.flush(table);
    assert.deepEqual((await db.select(table, {})).map((r) => r.name).sort(), ["alice", "bob"]);

    const backups = await db.listBackups(table);
    assert.deepEqual(backups, [backup1.backupId]);

    // 復元するとバックアップ時点(aliceのみ)の状態に完全に戻る(bobは消える).
    // 復元は即座にS3へ反映されるためflush不要.
    const restored = await db.restoreTable(table, backup1.backupId);
    assert.equal(restored.rowCount, 1);
    assert.deepEqual(await rawStoredRows(table), [{ name: "alice" }]);
    assert.deepEqual((await db.select(table, {})).map((r) => r.name), ["alice"]);
});

test("s3MasterTable: backupTableはflush前の未反映な変更も対象に含む(read-your-own-writes)", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    // flushせずにinsertした直後にbackupTableを呼ぶ.
    await db.insert(table, { name: "alice" });

    const backup1 = await db.backupTable(table);
    assert.equal(backup1.rowCount, 1);

    // 実データ(S3)側にはまだ反映されていないことの確認(flush前のため).
    assert.deepEqual(await rawStoredRows(table), []);
});

test("s3MasterTable: restoreTableは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.restoreTable(table, "no-such-backup"));
});

test("s3MasterTable: previewRestoreはrestoreTableを実行せずに現在とバックアップの行数を比較できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, { name: "alice" });
    await db.flush(table);
    const backup1 = await db.backupTable(table);

    await db.insert(table, { name: "bob" });
    await db.insert(table, { name: "carol" });
    await db.flush(table);

    const preview = await db.previewRestore(table, backup1.backupId);
    assert.equal(preview.tableName, table);
    assert.equal(preview.backupId, backup1.backupId);
    assert.equal(preview.currentRowCount, 3);
    assert.equal(preview.backupRowCount, 1);

    // previewRestoreは実際には何も変更しない(現在の3件がそのまま残っている).
    assert.equal((await db.select(table, {})).length, 3);
});

test("s3MasterTable: previewRestoreは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.previewRestore(table, "no-such-backup"));
});

test("s3MasterTable: pruneBackupsは直近keep世代だけを残し、古い世代を削除する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });

    const backupIds = [];
    for (let i = 0; i < 3; i++) {
        const b = await db.backupTable(table);
        backupIds.push(b.backupId);
        // backupIdはUnixTimeミリ秒のため、連続実行時に同一世代になる
        // 衝突を避けるテスト用の小待機.
        await new Promise((r) => setTimeout(r, 5));
    }

    const before = await db.listBackups(table);
    assert.deepEqual(before, backupIds);

    const result = await db.pruneBackups(table, 1);
    assert.equal(result.tableName, table);
    assert.equal(result.keep, 1);
    assert.deepEqual(result.deleted, backupIds.slice(0, 2));

    const after = await db.listBackups(table);
    assert.deepEqual(after, [backupIds[2]]);

    // 削除された世代からはリストアできない(実体が消えていること)の確認.
    await assert.rejects(() => db.restoreTable(table, backupIds[0]));
});

test("s3MasterTable: pruneBackupsはkeep以下の世代数なら何も削除しない", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    const b1 = await db.backupTable(table);

    const result = await db.pruneBackups(table, 5);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(await db.listBackups(table), [b1.backupId]);
});

test("s3MasterTable: describeBackupは復元せずにバックアップの中身(スキーマ・行数)を確認できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });
    await db.flush(table);
    const backup1 = await db.backupTable(table);

    // バックアップ後にデータを変更しても、describeBackupの結果はバックアップ時点のまま.
    await db.insert(table, { name: "carol" });
    await db.flush(table);

    const desc = await db.describeBackup(table, backup1.backupId);
    assert.equal(desc.tableName, table);
    assert.equal(desc.backupId, backup1.backupId);
    assert.equal(desc.rowCount, 2);
    assert.deepEqual(desc.schema.columns, { name: { type: "string" } });

    // 現在のテーブルは変更されていない(3件のまま).
    assert.equal((await db.select(table, {})).length, 3);
});

test("s3MasterTable: describeBackupは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.describeBackup(table, "no-such-backup"));
});

test("s3MasterTable: restoreBackupAsでバックアップを別テーブル名として複製できる(クローン)", async () => {
    const db = createDb();
    const table = nextTableName();
    const destTable = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });
    await db.flush(table);
    const backup1 = await db.backupTable(table);

    const result = await db.restoreBackupAs(table, backup1.backupId, destTable);
    assert.equal(result.sourceTableName, table);
    assert.equal(result.destTableName, destTable);
    assert.equal(result.backupId, backup1.backupId);
    assert.equal(result.rowCount, 2);

    // 複製先テーブルは独立したテーブルとして機能する(元テーブルへの影響なし).
    const destRows = await db.select(destTable, {});
    assert.deepEqual(destRows.map((r) => r.name).sort(), ["alice", "bob"]);
    await db.insert(destTable, { name: "carol" });
    await db.flush(destTable);
    const srcRows = await db.select(table, {});
    assert.deepEqual(srcRows.map((r) => r.name).sort(), ["alice", "bob"]);
});

test("s3MasterTable: restoreBackupAsは複製先テーブル名が既に存在する場合はエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    const destTable = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.createTable(destTable, { columns: { name: { type: "string" } } });
    const backup1 = await db.backupTable(table);

    await assert.rejects(
        () => db.restoreBackupAs(table, backup1.backupId, destTable),
        /Destination table already exists/
    );
});
