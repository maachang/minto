// test/e2e/stream-sse-e2e.test.js
// tools/webapps.js によるストリーミング / SSE およびセキュリティヘッダー配信のE2Eテスト.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const RUN_SERVER = path.join(__dirname, ".fixtures", "runServer.js");

let tmpProjectDir;
let child;
let port;
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
                throw new Error("server did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

before(async () => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-e2e-stream-"));
    fs.mkdirSync(path.join(tmpProjectDir, "conf"), { recursive: true });
    fs.mkdirSync(path.join(tmpProjectDir, "public"), { recursive: true });

    // conf/security.json
    fs.writeFileSync(path.join(tmpProjectDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-content-type-options": "nosniff",
            "x-frame-options": "SAMEORIGIN"
        }
    }));

    // public/ping.mt.js
    fs.writeFileSync(path.join(tmpProjectDir, "public", "ping.mt.js"), `
        exports.handler = async () => ({ status: "ok" });
    `);

    // public/events.mt.js (SSE)
    fs.writeFileSync(path.join(tmpProjectDir, "public", "events.mt.js"), `
        exports.handler = async () => {
            $response().sse(async (stream) => {
                stream.sendEvent({ count: 1 }, { event: "msg" });
                stream.sendEvent({ count: 2 }, { event: "msg" });
            });
        };
    `);

    // public/stream.mt.js (Response Streaming)
    fs.writeFileSync(path.join(tmpProjectDir, "public", "stream.mt.js"), `
        exports.handler = async () => {
            $response().stream(async (stream) => {
                stream.write("hello ");
                stream.write("stream");
            });
        };
    `);

    port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [RUN_SERVER, tmpProjectDir, String(port)], {
        env: Object.assign({}, process.env, { MINTO_HOME: MINTO_HOME }),
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/ping", 5000);
});

after(() => {
    if (child != null) {
        child.kill();
    }
    if (tmpProjectDir && fs.existsSync(tmpProjectDir)) {
        fs.rmSync(tmpProjectDir, { recursive: true, force: true });
    }
});

test("e2e securityHeaders: 通常エンドポイントにsecurity.jsonのヘッダーが付与される", async () => {
    const res = await fetch(baseUrl + "/ping");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("e2e SSE: /events で text/event-stream レスポンスおよびSSEイベント列を受信できる", async () => {
    const res = await fetch(baseUrl + "/events");
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/event-stream"));
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");

    const text = await res.text();
    const expected =
        "event: msg\n" +
        'data: {"count":1}\n\n' +
        "event: msg\n" +
        'data: {"count":2}\n\n';
    assert.equal(text, expected);
});

test("e2e Stream: /stream でストリーミングデータを受信できる", async () => {
    const res = await fetch(baseUrl + "/stream");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, "hello stream");
});
