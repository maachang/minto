// modules/util/http.js のテスト.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const httpClient = require("../../modules/util/http.js");

let server;
let serverPort;
let serverUrl;
let retryCount = 0;

before(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === "/test-get") {
            const q = url.searchParams.get("q");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, q: q }));
            return;
        }

        if (url.pathname === "/test-post-json") {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                const parsed = JSON.parse(body);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ received: parsed, headerFoo: req.headers["x-foo"] }));
            });
            return;
        }

        if (url.pathname === "/test-put") {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("PUT:" + body);
            });
            return;
        }

        if (url.pathname === "/test-delete") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (url.pathname === "/test-retry") {
            retryCount++;
            if (retryCount < 3) {
                res.writeHead(500);
                res.end("Internal Server Error");
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ retried: retryCount }));
            return;
        }

        if (url.pathname === "/test-slow") {
            setTimeout(() => {
                res.writeHead(200);
                res.end("Slow Response");
            }, 500);
            return;
        }

        res.writeHead(404);
        res.end("Not Found");
    });

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            serverPort = server.address().port;
            serverUrl = `http://127.0.0.1:${serverPort}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise(r => server.close(r));
    }
});

test("http: appendQuery クエリパラメータ生成", () => {
    assert.equal(
        httpClient.appendQuery("http://example.com/api", { a: 1, b: "test" }),
        "http://example.com/api?a=1&b=test"
    );
    assert.equal(
        httpClient.appendQuery("http://example.com/api?existing=1", { next: "true" }),
        "http://example.com/api?existing=1&next=true"
    );
    assert.equal(httpClient.appendQuery("/api/path", { x: 10 }), "/api/path?x=10");
    assert.equal(httpClient.appendQuery("/api/path", null), "/api/path");
});

test("http: get / getJson", async () => {
    // get
    const res = await httpClient.get(`${serverUrl}/test-get`, { query: { q: "hello" } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, { ok: true, q: "hello" });

    // getJson
    const json = await httpClient.getJson(`${serverUrl}/test-get`, { query: { q: "direct" } });
    assert.deepEqual(json, { ok: true, q: "direct" });
});

test("http: post / postJson / put / delete", async () => {
    // postJson
    const postRes = await httpClient.postJson(
        `${serverUrl}/test-post-json`,
        { name: "minto", count: 42 },
        { headers: { "X-Foo": "bar" } }
    );
    assert.deepEqual(postRes.received, { name: "minto", count: 42 });
    assert.equal(postRes.headerFoo, "bar");

    // put
    const putRes = await httpClient.put(`${serverUrl}/test-put`, "hello-body");
    assert.equal(putRes.status, 200);
    const putText = await putRes.text();
    assert.equal(putText, "PUT:hello-body");

    // delete
    const delRes = await httpClient.delete(`${serverUrl}/test-delete`);
    assert.equal(delRes.status, 204);
});

test("http: 5xx リトライ制御 (retry)", async () => {
    retryCount = 0;
    const res = await httpClient.get(`${serverUrl}/test-retry`, { retry: 3, retryDelay: 50 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.retried, 3);
});

test("http: タイムアウト制御 (timeout)", async () => {
    await assert.rejects(
        async () => {
            await httpClient.get(`${serverUrl}/test-slow`, { timeout: 100 });
        },
        /timeout/i
    );
});
