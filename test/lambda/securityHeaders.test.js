// test/lambda/securityHeaders.test.js
// セキュリティヘッダー共通設定機構(conf/security.json)のテスト.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const mintoLambdaIndex = require("../../lambda/src/index.js");

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-sec-test-"));
    fs.mkdirSync(path.join(tmpDir, "conf"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "public"), { recursive: true });
    mintoLambdaIndex.setBasePath(tmpDir);
    mintoLambdaIndex.clearCache();
});

afterEach(() => {
    mintoLambdaIndex.clearCache();
    if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

const createEvent = (rawPath) => ({
    version: "2.0",
    routeKey: "$default",
    rawPath: rawPath,
    rawQueryString: "",
    headers: {
        host: "localhost"
    },
    requestContext: {
        http: {
            method: "GET",
            path: rawPath,
            protocol: "HTTP/1.1"
        }
    },
    isBase64Encoded: false
});

test("securityHeaders: conf/security.json が無効(enabled: false)の場合はセキュリティヘッダーが付与されない", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: false,
        headers: {
            "x-content-type-options": "nosniff",
            "x-frame-options": "SAMEORIGIN"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "test.mt.js"), 'exports.handler = async () => ({ hello: "world" });');

    const res = await mintoLambdaIndex.handler(createEvent("/test"), {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-content-type-options"], undefined);
    assert.equal(res.headers["x-frame-options"], undefined);
});

test("securityHeaders: conf/security.json が有効(enabled: true)の場合、動的JSレスポンスにセキュリティヘッダーが付与される", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-content-type-options": "nosniff",
            "x-frame-options": "SAMEORIGIN",
            "referrer-policy": "strict-origin-when-cross-origin"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "test.mt.js"), 'exports.handler = async () => ({ hello: "world" });');

    const res = await mintoLambdaIndex.handler(createEvent("/test"), {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("securityHeaders: 静的ファイルレスポンスおよび静的304レスポンスにもセキュリティヘッダーが付与される", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "sample.txt"), "hello static");

    const res200 = await mintoLambdaIndex.handler(createEvent("/sample.txt"), {});
    assert.equal(res200.statusCode, 200);
    assert.equal(res200.headers["x-content-type-options"], "nosniff");
    assert.equal(res200.headers["x-frame-options"], "DENY");
});

test("securityHeaders: エラーレスポンス(404, 500)にもセキュリティヘッダーが付与される", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-content-type-options": "nosniff",
            "x-frame-options": "SAMEORIGIN"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "error.mt.js"), 'exports.handler = async () => { throw new Error("boom"); };');

    // 404 (静的ファイル不在)
    const res404 = await mintoLambdaIndex.handler(createEvent("/notfound.txt"), {});
    assert.equal(res404.statusCode, 404);
    assert.equal(res404.headers["x-content-type-options"], "nosniff");
    assert.equal(res404.headers["x-frame-options"], "SAMEORIGIN");

    // 500 (JS例外)
    const res500 = await mintoLambdaIndex.handler(createEvent("/error"), {});
    assert.equal(res500.statusCode, 500);
    assert.equal(res500.headers["x-content-type-options"], "nosniff");
    assert.equal(res500.headers["x-frame-options"], "SAMEORIGIN");
});

test("securityHeaders: JSスクリプト内で個別にheader設定された場合は個別の値が優先される", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-frame-options": "SAMEORIGIN"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "custom.mt.js"), `
        exports.handler = async () => {
            $response().header("x-frame-options", "DENY");
            return { ok: true };
        };
    `);

    const res = await mintoLambdaIndex.handler(createEvent("/custom"), {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-frame-options"], "DENY");
});

test("securityHeaders: $response().securityHeaders(...) で動的設定/追加できる", async () => {
    fs.writeFileSync(path.join(tmpDir, "conf", "security.json"), JSON.stringify({
        enabled: true,
        headers: {
            "x-frame-options": "SAMEORIGIN"
        }
    }));
    fs.writeFileSync(path.join(tmpDir, "public", "csp.mt.js"), `
        exports.handler = async () => {
            $response().securityHeaders({
                "content-security-policy": "default-src 'self'",
                "x-frame-options": "ALLOWALL"
            });
            return { ok: true };
        };
    `);

    const res = await mintoLambdaIndex.handler(createEvent("/csp"), {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-security-policy"], "default-src 'self'");
    assert.equal(res.headers["x-frame-options"], "ALLOWALL");
});
