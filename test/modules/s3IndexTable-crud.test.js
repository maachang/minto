// modules/s3table/s3IndexTable.js のCRUD/検索エンジン本体のテスト.
//
// エンコードロジックのみのテストは s3IndexTable-encode.test.js を参照。
// ここでは実際のS3通信(insert/select/update/delete、インデックス、
// 範囲検索、GROUP BY、自己修復など)を tools/localS3.js(ローカルS3
// エミュレータ)を子プロセスとして起動した上で検証する。
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3IndexTable-test-"));
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

// s3IndexTable.jsは $loadLib("s3sdk.js") 経由でs3sdk.jsを取得する実装のため、
// テスト用にスタブしてから読み込む(auth-jwt.test.js等と同じパターン).
global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return require("../../modules/s3table/s3sdk.js");
    }
    if (name === "seqId.js") {
        return require("../../modules/s3table/seqId.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.$require = function (name) {
    return require(name);
};
const s3IndexTable = require("../../modules/s3table/s3IndexTable.js");
const s3sdk = require("../../modules/s3table/s3sdk.js");

let _tableSeq = 0;
// テスト間で衝突しないユニークなテーブル名を生成.
const nextTableName = function () {
    return "tbl_" + (_tableSeq++);
};

const createDb = function () {
    return s3IndexTable.create({ bucket: BUCKET });
};

test("s3IndexTable: createTable + insert + select(eq)で登録した行が取得できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            name: { type: "string" },
            age: { type: "int" }
        },
        indexes: {
            byName: ["name"]
        }
    });
    await db.insert(table, { name: "alice", age: 20 });
    await db.insert(table, { name: "bob", age: 30 });

    const rows = await db.select(table, { where: { byName: { name: "alice" } } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "alice");
    assert.equal(rows[0].age, 20);
});

test("s3IndexTable: 複合インデックス(先頭範囲+後続eq)で絞り込める", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            category: { type: "string" },
            price: { type: "int" }
        },
        indexes: {
            byCategoryPrice: ["category", "price"]
        }
    });
    await db.insert(table, { category: "a", price: 100 });
    await db.insert(table, { category: "a", price: 200 });
    await db.insert(table, { category: "b", price: 100 });

    const rows = await db.select(table, {
        where: { byCategoryPrice: { category: "a", price: 100 } }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, "a");
    assert.equal(rows[0].price, 100);
});

test("s3IndexTable: 範囲検索(gt/gte/lt/lte)が数値順に一致する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { score: { type: "int" } },
        indexes: { byScore: ["score"] }
    });
    for (const v of [10, 20, 30, 40, 50]) {
        await db.insert(table, { score: v });
    }

    const gte30 = await db.select(table, { where: { byScore: { score: { gte: 30 } } } });
    assert.deepEqual(gte30.map((r) => r.score).sort((a, b) => a - b), [30, 40, 50]);

    const gt30 = await db.select(table, { where: { byScore: { score: { gt: 30 } } } });
    assert.deepEqual(gt30.map((r) => r.score).sort((a, b) => a - b), [40, 50]);

    const lte30 = await db.select(table, { where: { byScore: { score: { lte: 30 } } } });
    assert.deepEqual(lte30.map((r) => r.score).sort((a, b) => a - b), [10, 20, 30]);

    const lt30 = await db.select(table, { where: { byScore: { score: { lt: 30 } } } });
    assert.deepEqual(lt30.map((r) => r.score).sort((a, b) => a - b), [10, 20]);

    const between = await db.select(table, {
        where: { byScore: { score: { gte: 20, lte: 40 } } }
    });
    assert.deepEqual(between.map((r) => r.score).sort((a, b) => a - b), [20, 30, 40]);
});

test("s3IndexTable: in検索で複数値のOR条件を取得できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { status: { type: "string" } },
        indexes: { byStatus: ["status"] }
    });
    await db.insert(table, { status: "open" });
    await db.insert(table, { status: "closed" });
    await db.insert(table, { status: "pending" });

    const rows = await db.select(table, {
        where: { byStatus: { status: { in: ["open", "closed"] } } }
    });
    assert.deepEqual(rows.map((r) => r.status).sort(), ["closed", "open"]);
});

test("s3IndexTable: orderBy(インデックス使用/メモリソート双方)が機能する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { score: { type: "int" }, name: { type: "string" } },
        indexes: { byScore: ["score"] }
    });
    await db.insert(table, { score: 30, name: "c" });
    await db.insert(table, { score: 10, name: "a" });
    await db.insert(table, { score: 20, name: "b" });

    // whereで使ったインデックスによる並び替え.
    const ascByIndex = await db.select(table, {
        where: { byScore: { score: { gte: 0 } } },
        orderBy: { byScore: "asc" }
    });
    assert.deepEqual(ascByIndex.map((r) => r.score), [10, 20, 30]);

    const descByIndex = await db.select(table, {
        where: { byScore: { score: { gte: 0 } } },
        orderBy: { byScore: "desc" }
    });
    assert.deepEqual(descByIndex.map((r) => r.score), [30, 20, 10]);
});

test("s3IndexTable: offset/limitでページングできる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { n: { type: "int" } },
        indexes: { byN: ["n"] }
    });
    for (const v of [1, 2, 3, 4, 5]) {
        await db.insert(table, { n: v });
    }
    const rows = await db.select(table, {
        where: { byN: { n: { gte: 0 } } },
        orderBy: { byN: "asc" },
        offset: 1,
        limit: 2
    });
    assert.deepEqual(rows.map((r) => r.n), [2, 3]);
});

test("s3IndexTable: groupBy/集計(count/sum/avg/min/max)が計算できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { category: { type: "string" }, price: { type: "int" } },
        indexes: { byCategory: ["category"] }
    });
    await db.insert(table, { category: "a", price: 100 });
    await db.insert(table, { category: "a", price: 300 });
    await db.insert(table, { category: "b", price: 50 });

    const result = await db.select(table, {
        where: { byCategory: { category: { in: ["a", "b"] } } },
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

test("s3IndexTable: updateで内容が更新され、更新後の値で検索できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, age: { type: "int" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice", age: 20 });

    const cnt = await db.update(table, { where: { byName: { name: "alice" } } }, { age: 21 });
    assert.equal(cnt, 1);

    const rows = await db.select(table, { where: { byName: { name: "alice" } } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].age, 21);
});

test("s3IndexTable: deleteで行が削除され検索結果から消える", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });
    const cnt = await db.delete(table, { where: { byName: { name: "alice" } } });
    assert.equal(cnt, 1);

    const rows = await db.select(table, { where: { byName: { name: "alice" } } });
    assert.equal(rows.length, 0);
});

test("s3IndexTable: 行ファイルが直接削除されていてもselectはエラーにならず自己修復する", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "ghost" });

    // db.delete()を経由せず、行ファイルだけを直接削除(インデックスは残った状態=stale).
    const listRes = await s3sdk.list(BUCKET, "table/" + table, { noError: false });
    assert.equal(listRes.Contents.length, 1);
    const rowKey = listRes.Contents[0].Key;
    await s3sdk.delete(BUCKET, null, rowKey, { noError: false });

    // staleなインデックスが残っている状態でも例外にならず、単に結果から除外される.
    const rows = await db.select(table, { where: { byName: { name: "ghost" } } });
    assert.equal(rows.length, 0);

    // 自己修復によりインデックスエントリも削除されているはず.
    const idxRes = await s3sdk.list(BUCKET, "index/" + table + "/name", { noError: false });
    assert.equal((idxRes.Contents || []).length, 0);
});

test("s3IndexTable: createIndexで既存行にインデックスをバックフィルできる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: {}
    });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });

    await db.createIndex(table, "byName", ["name"]);

    const rows = await db.select(table, { where: { byName: { name: "alice" } } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "alice");
});

test("s3IndexTable: dropIndexでインデックスエントリが削除される", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });

    await db.dropIndex(table, "byName");

    const idxRes = await s3sdk.list(BUCKET, "index/" + table + "/name", { noError: false });
    assert.equal((idxRes.Contents || []).length, 0);
});

test("s3IndexTable: dropTableでtable/index配下と集約定義が全て削除される", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });

    await db.dropTable(table);

    const tableRes = await s3sdk.list(BUCKET, "table/" + table, { noError: false });
    assert.equal((tableRes.Contents || []).length, 0);
    const idxRes = await s3sdk.list(BUCKET, "index/" + table, { noError: false });
    assert.equal((idxRes.Contents || []).length, 0);

    // 集約ファイル(table.json)からも該当テーブルの定義が削除されていること.
    const defsRes = await s3sdk.get(BUCKET, null, "table.json", { noError: true });
    const defs = defsRes == null ? {} : JSON.parse(await defsRes.Body.transformToString("utf-8"));
    assert.equal(defs[table], undefined);
});

test("s3IndexTable: 既存テーブル名でcreateTableするとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.createTable(table, { columns: { name: { type: "string" } } }));
});

test("s3IndexTable: listTablesは全テーブル分の定義をテーブル名キーで返す", async () => {
    const db = createDb();
    const table1 = nextTableName();
    const table2 = nextTableName();
    await db.createTable(table1, { columns: { name: { type: "string" } } });
    await db.createTable(table2, { columns: { amount: { type: "int" } } });

    const tables = await db.listTables();
    assert.equal(tables[table1].columns.name.type, "string");
    assert.equal(tables[table2].columns.amount.type, "int");

    await db.dropTable(table2);
    const after = await db.listTables();
    assert.equal(after[table2], undefined);
});

test("s3IndexTable: alterColumnsでカラム定義を差し替えられる(既存データは保持、削除列はselectで除外)", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" }, age: { type: "int" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice", age: 20 });

    // age列を削除し、role列(default付き)を追加.
    await db.alterColumns(table, {
        name: { type: "string" },
        role: { type: "string", default: "member" }
    });

    const rows = await db.select(table, { where: { byName: { name: "alice" } } });
    assert.equal(rows[0].age, undefined);
    assert.equal(rows[0].name, "alice");

    await assert.rejects(() => db.alterColumns("no-such-table", {}));
});

test("s3IndexTable: backupTable/restoreTableで行データ・インデックス・スキーマを世代管理して復元できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });

    const backup1 = await db.backupTable(table);
    assert.equal(backup1.tableName, table);
    assert.equal(backup1.rowCount, 2);
    assert.equal(backup1.indexEntryCount, 2);

    // バックアップ後にデータを変更(carolを追加、aliceを削除).
    await db.insert(table, { name: "carol" });
    await db.delete(table, { where: { byName: { name: "alice" } } });
    const beforeRestore = await db.select(table, { where: { byName: {} } });
    assert.deepEqual(beforeRestore.map((r) => r.name).sort(), ["bob", "carol"]);

    // バックアップ世代一覧に含まれていること.
    const backups = await db.listBackups(table);
    assert.deepEqual(backups, [backup1.backupId]);

    // 復元するとバックアップ時点(alice, bob)の状態に完全に戻る(carolは消える).
    const restored = await db.restoreTable(table, backup1.backupId);
    assert.equal(restored.rowCount, 2);
    assert.equal(restored.indexEntryCount, 2);
    const afterRestore = await db.select(table, { where: { byName: {} } });
    assert.deepEqual(afterRestore.map((r) => r.name).sort(), ["alice", "bob"]);
});

test("s3IndexTable: restoreTableは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.restoreTable(table, "no-such-backup"));
});

test("s3IndexTable: previewRestoreはrestoreTableを実行せずに現在とバックアップの行数を比較できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await db.insert(table, { name: "alice" });
    const backup1 = await db.backupTable(table);

    await db.insert(table, { name: "bob" });
    await db.insert(table, { name: "carol" });

    const preview = await db.previewRestore(table, backup1.backupId);
    assert.equal(preview.tableName, table);
    assert.equal(preview.backupId, backup1.backupId);
    assert.equal(preview.currentRowCount, 3);
    assert.equal(preview.backupRowCount, 1);

    // previewRestoreは実際には何も変更しない(再度previewしても件数は変わらない).
    const preview2 = await db.previewRestore(table, backup1.backupId);
    assert.equal(preview2.currentRowCount, 3);
});

test("s3IndexTable: previewRestoreは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.previewRestore(table, "no-such-backup"));
});

test("s3IndexTable: pruneBackupsは直近keep世代だけを残し、古い世代を削除する", async () => {
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

test("s3IndexTable: pruneBackupsはkeep以下の世代数なら何も削除しない", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    const b1 = await db.backupTable(table);

    const result = await db.pruneBackups(table, 5);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(await db.listBackups(table), [b1.backupId]);
});

test("s3IndexTable: describeBackupは復元せずにバックアップの中身(スキーマ・行数)を確認できる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });
    const backup1 = await db.backupTable(table);

    // バックアップ後にデータを変更しても、describeBackupの結果はバックアップ時点のまま.
    await db.insert(table, { name: "carol" });

    const desc = await db.describeBackup(table, backup1.backupId);
    assert.equal(desc.tableName, table);
    assert.equal(desc.backupId, backup1.backupId);
    assert.equal(desc.rowCount, 2);
    assert.equal(desc.indexEntryCount, 2);
    assert.deepEqual(desc.schema.columns, { name: { type: "string" } });
    assert.deepEqual(desc.schema.indexes, { byName: ["name"] });

    // 現在のテーブルは変更されていない(3件のまま).
    const rows = await db.select(table, { where: { byName: {} } });
    assert.equal(rows.length, 3);
});

test("s3IndexTable: describeBackupは存在しないbackupIdを指定するとエラーになる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, { columns: { name: { type: "string" } } });
    await assert.rejects(() => db.describeBackup(table, "no-such-backup"));
});

test("s3IndexTable: restoreBackupAsでバックアップを別テーブル名として複製できる(クローン)", async () => {
    const db = createDb();
    const table = nextTableName();
    const destTable = nextTableName();
    await db.createTable(table, {
        columns: { name: { type: "string" } },
        indexes: { byName: ["name"] }
    });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });
    const backup1 = await db.backupTable(table);

    const result = await db.restoreBackupAs(table, backup1.backupId, destTable);
    assert.equal(result.sourceTableName, table);
    assert.equal(result.destTableName, destTable);
    assert.equal(result.backupId, backup1.backupId);
    assert.equal(result.rowCount, 2);
    assert.equal(result.indexEntryCount, 2);

    // 複製先テーブルは独立したテーブルとして機能する(元テーブルへの影響なし).
    const destRows = await db.select(destTable, { where: { byName: {} } });
    assert.deepEqual(destRows.map((r) => r.name).sort(), ["alice", "bob"]);
    await db.insert(destTable, { name: "carol" });
    const srcRows = await db.select(table, { where: { byName: {} } });
    assert.deepEqual(srcRows.map((r) => r.name).sort(), ["alice", "bob"]);
});

test("s3IndexTable: restoreBackupAsは複製先テーブル名が既に存在する場合はエラーになる", async () => {
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

test("s3IndexTable: seqId型は自動採番され、インデックス経由の範囲検索(gt)で生成順に並べられる", async () => {
    const db = createDb();
    const table = nextTableName();
    await db.createTable(table, {
        columns: {
            id: { type: "seqId" },
            name: { type: "string" }
        },
        indexes: { byId: ["id"] }
    });
    await db.insert(table, { name: "alice" });
    await db.insert(table, { name: "bob" });
    await db.insert(table, { name: "carol" });

    const all = await db.select(table, { where: { byId: {} }, orderBy: { byId: "asc" } });
    assert.deepEqual(all.map((r) => r.name), ["alice", "bob", "carol"]);

    const aliceId = all[0].id;
    const rows = await db.select(table, {
        where: { byId: { id: { gt: aliceId } } },
        orderBy: { byId: "asc" }
    });
    assert.deepEqual(rows.map((r) => r.name), ["bob", "carol"]);
});
