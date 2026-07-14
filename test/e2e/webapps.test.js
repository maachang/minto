// e2eテスト: tools/webapps.js(=lambda/src/index.jsを内部で使うローカルサーバー)
// を実際に起動し、簡単なサンプルプロジェクト(fixtures/sample-project)に対して
// 実HTTPリクエストで動作確認を行う.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const PROJECT_DIR = path.join(__dirname, ".fixtures", "sample-project");
const RUN_SERVER = path.join(__dirname, ".fixtures", "runServer.js");

let child;
let port;
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
                throw new Error("server did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

before(async () => {
    port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [RUN_SERVER, PROJECT_DIR, String(port)], {
        env: Object.assign({}, process.env, { MINTO_HOME: MINTO_HOME }),
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/hello", 5000);
});

after(() => {
    if (child != null) {
        child.kill();
    }
});

test("e2e: mt.js は指定通りのJSONを返す", async () => {
    const res = await fetch(baseUrl + "/hello");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    const body = await res.json();
    assert.equal(body.hello, "world");
    assert.equal(typeof body.requestId, "string");
    assert.equal(body.requestId.length > 0, true);
});

test("e2e: jhtml(mt.html) はURLパラメータを反映したHTMLを返す", async () => {
    const res = await fetch(baseUrl + "/index?name=Minto");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const text = await res.text();
    assert.match(text, /Hello, Minto!/);
});

test("e2e: jhtml(mt.html) はパラメータ省略時にデフォルト値を使う", async () => {
    const res = await fetch(baseUrl + "/index");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Hello, minto!/);
});

test("e2e: 存在しないパスは404を返す", async () => {
    const res = await fetch(baseUrl + "/no-such-path");
    assert.equal(res.status, 404);
});

test("e2e: filter.mt.jsが存在してもtrueを返せば処理が継続する", async () => {
    // filter.mt.js は常にtrueを返すので、/hello は通常通り応答するはず.
    const res = await fetch(baseUrl + "/hello");
    assert.equal(res.status, 200);
});
