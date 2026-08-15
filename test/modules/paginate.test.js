// modules/s3table/paginate.js のテスト.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const LOCAL_S3_JS = path.join(MINTO_HOME, "tools", "localAws.js");
const BUCKET = "test-paginate-bucket";

let child;
let storageDir;
let baseUrl;

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

const waitForServer = async function (url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const res = await fetch(url);
            await res.arrayBuffer();
            return;
        } catch (e) {
            if (Date.now() - start > timeoutMs) {
                throw new Error("localAws did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-paginate-test-"));
    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [LOCAL_S3_JS, "-p", String(port), "-d", storageDir], {
        stdio: "ignore"
    });
    await waitForServer(baseUrl + "/" + BUCKET + "?list-type=2", 5000);
    process.env.MINTO_LOCAL_S3_ENDPOINT = baseUrl;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
});

after(() => {
    if (child) child.kill();
    if (storageDir && fs.existsSync(storageDir)) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
});

global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return require("../../modules/s3table/s3sdk.js");
    }
    if (name === "seqId.js") {
        return require("../../modules/s3table/seqId.js");
    }
    if (name === "s3Lock.js") {
        return require("../../modules/s3table/s3Lock.js");
    }
    if (name === "s3IndexTable.js") {
        return require("../../modules/s3table/s3IndexTable.js");
    }
    if (name === "s3MasterTable.js") {
        return require("../../modules/s3table/s3MasterTable.js");
    }
    if (name === "paginate.js") {
        return require("../../modules/s3table/paginate.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.$require = function (name) {
    return require(name);
};

const paginate = require("../../modules/s3table/paginate.js");
const s3IndexTable = require("../../modules/s3table/s3IndexTable.js");
const s3MasterTable = require("../../modules/s3table/s3MasterTable.js");

test("paginate: encodeCursor / decodeCursor の往復変換", () => {
    const original = { idx: "byCreatedAt", id: "row_123", v: 1723700000 };
    const cursorStr = paginate.encodeCursor(original);
    assert.ok(typeof cursorStr === "string");
    assert.ok(!cursorStr.includes("=")); // パディング除去
    assert.ok(!cursorStr.includes("+")); // URL safe

    const decoded = paginate.decodeCursor(cursorStr);
    assert.deepEqual(decoded, original);

    // 不正な文字列の場合は null を返却
    assert.equal(paginate.decodeCursor("invalid_cursor_!@#$"), null);
    assert.equal(paginate.decodeCursor(null), null);
    assert.equal(paginate.decodeCursor(""), null);
});

test("paginate: 配列データのオフセット式ページング (page / limit)", async () => {
    const items = [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
        { id: 3, name: "C" },
        { id: 4, name: "D" },
        { id: 5, name: "E" }
    ];

    // 1ページ目 (limit: 2, page: 1)
    const page1 = await paginate.query(items, { limit: 2, page: 1 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.items[0].id, 1);
    assert.equal(page1.items[1].id, 2);
    assert.equal(page1.totalCount, 5);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.currentPage, 1);
    assert.equal(page1.hasNext, true);
    assert.equal(page1.hasPrev, false);

    // 2ページ目 (limit: 2, page: 2)
    const page2 = await paginate.query(items, { limit: 2, page: 2 });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.items[0].id, 3);
    assert.equal(page2.items[1].id, 4);
    assert.equal(page2.currentPage, 2);
    assert.equal(page2.hasNext, true);
    assert.equal(page2.hasPrev, true);

    // 3ページ目 (limit: 2, page: 3 - 最終ページ)
    const page3 = await paginate.query(items, { limit: 2, page: 3 });
    assert.equal(page3.items.length, 1);
    assert.equal(page3.items[0].id, 5);
    assert.equal(page3.currentPage, 3);
    assert.equal(page3.hasNext, false);
    assert.equal(page3.hasPrev, true);
});

test("paginate: 配列データのカーソル式ページング (cursor / limit)", async () => {
    const items = [
        { id: "a", score: 100 },
        { id: "b", score: 90 },
        { id: "c", score: 80 },
        { id: "d", score: 70 },
        { id: "e", score: 60 }
    ];

    // 1ページ目 (limit: 2)
    const res1 = await paginate.query(items, { limit: 2 });
    assert.equal(res1.items.length, 2);
    assert.equal(res1.items[0].id, "a");
    assert.equal(res1.items[1].id, "b");
    assert.equal(res1.hasNext, true);
    assert.ok(res1.nextCursor != null);

    // 2ページ目 (res1.nextCursor を使用)
    const res2 = await paginate.query(items, { limit: 2, cursor: res1.nextCursor });
    assert.equal(res2.items.length, 2);
    assert.equal(res2.items[0].id, "c");
    assert.equal(res2.items[1].id, "d");
    assert.equal(res2.hasNext, true);
    assert.ok(res2.nextCursor != null);

    // 3ページ目 (res2.nextCursor を使用 - 最終ページ)
    const res3 = await paginate.query(items, { limit: 2, cursor: res2.nextCursor });
    assert.equal(res3.items.length, 1);
    assert.equal(res3.items[0].id, "e");
    assert.equal(res3.hasNext, false);
    assert.equal(res3.nextCursor, null);
});

test("paginate: url ヘルパーによるURL生成", () => {
    assert.equal(paginate.url("/api/posts", "cursor_123"), "/api/posts?cursor=cursor_123");
    assert.equal(paginate.url("/api/posts?cat=tech", "cursor_123"), "/api/posts?cat=tech&cursor=cursor_123");
    assert.equal(paginate.url("/api/posts", 2), "/api/posts?page=2");
    assert.equal(paginate.url("/api/posts?cat=tech&page=1", 2), "/api/posts?cat=tech&page=2");
});

test("paginate: s3IndexTable との統合 (連続カーソルページネーション)", async () => {
    const db = s3IndexTable.create({ bucket: BUCKET });

    await db.createTable("articles", {
        columns: {
            id: { type: "seqId", notNull: true },
            title: { type: "string" },
            category: { type: "string" },
            views: { type: "int" }
        },
        indexes: {
            byCategory: ["category"]
        }
    });

    for (let i = 1; i <= 10; i++) {
        await db.insert("articles", {
            title: "Article " + i,
            category: "news",
            views: i * 10
        });
    }

    // 1. オフセット式ページネーション
    const offsetRes = await paginate.query(db, "articles", {
        where: { byCategory: { category: "news" } },
        limit: 4,
        page: 1
    });
    assert.equal(offsetRes.items.length, 4);
    assert.equal(offsetRes.totalCount, 10);
    assert.equal(offsetRes.totalPages, 3);
    assert.equal(offsetRes.hasNext, true);

    // 2. カーソル式ページネーションで全件取得走査
    let fetched = [];
    let currentCursor = null;
    let pagesCount = 0;

    do {
        const page = await paginate.query(db, "articles", {
            where: { byCategory: { category: "news" } },
            limit: 4,
            cursor: currentCursor
        });
        fetched = fetched.concat(page.items);
        currentCursor = page.nextCursor;
        pagesCount++;
    } while (currentCursor);

    assert.equal(fetched.length, 10);
    assert.equal(pagesCount, 3); // 4件 + 4件 + 2件 = 3ページ
});

test("paginate: s3MasterTable との統合", async () => {
    const masterDb = s3MasterTable.create({ bucket: BUCKET });

    await masterDb.createTable("categories", {
        columns: {
            code: { type: "string", notNull: true },
            name: { type: "string" }
        },
        primaryKey: ["code"]
    });

    for (let i = 1; i <= 7; i++) {
        await masterDb.insert("categories", { code: "cat_" + i, name: "Cat " + i });
    }
    await masterDb.flush("categories");

    const res1 = await paginate.query(masterDb, "categories", { limit: 3 });
    assert.equal(res1.items.length, 3);
    assert.equal(res1.hasNext, true);

    const res2 = await paginate.query(masterDb, "categories", { limit: 3, cursor: res1.nextCursor });
    assert.equal(res2.items.length, 3);
    assert.equal(res2.hasNext, true);

    const res3 = await paginate.query(masterDb, "categories", { limit: 3, cursor: res2.nextCursor });
    assert.equal(res3.items.length, 1);
    assert.equal(res3.hasNext, false);
});
