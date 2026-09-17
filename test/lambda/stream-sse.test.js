// test/lambda/stream-sse.test.js
// レスポンスストリーミングおよびSSE機能のテスト.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const mintoLambdaIndex = require("../../lambda/src/index.js");

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-stream-test-"));
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

test("stream: $response().stream(...) でチャンクが逐次書き込みできる", async () => {
    fs.writeFileSync(path.join(tmpDir, "public", "stream.mt.js"), `
        exports.handler = async () => {
            $response().stream(async (stream) => {
                stream.write("chunk-1;");
                stream.write("chunk-2;");
                stream.end("chunk-3");
            });
        };
    `);

    const rawResult = await mintoLambdaIndex.handler(createEvent("/stream"), {});
    assert.equal(rawResult.isStream, true);
    assert.equal(typeof rawResult.streamHandler, "function");

    const consumed = await mintoLambdaIndex.consumeStreamResponse(rawResult);
    assert.equal(consumed.statusCode, 200);
    assert.equal(consumed.body, "chunk-1;chunk-2;chunk-3");
});

test("sse: $response().sse(...) でContent-Typeがtext/event-streamになりsendEventでフォーマット送信される", async () => {
    fs.writeFileSync(path.join(tmpDir, "public", "sse.mt.js"), `
        exports.handler = async () => {
            $response().sse(async (stream) => {
                stream.sendEvent("simple text");
                stream.sendEvent({ count: 1 }, { event: "update", id: "101", retry: 3000 });
                stream.sendEvent("line1\\nline2", { event: "multiline" });
            });
        };
    `);

    const rawResult = await mintoLambdaIndex.handler(createEvent("/sse"), {});
    assert.equal(rawResult.isStream, true);
    assert.equal(rawResult.headers["content-type"], "text/event-stream");
    assert.equal(rawResult.headers["cache-control"], "no-cache");
    assert.equal(rawResult.headers["connection"], "keep-alive");

    const consumed = await mintoLambdaIndex.consumeStreamResponse(rawResult);
    assert.equal(consumed.statusCode, 200);

    const expected =
        "data: simple text\n\n" +
        "id: 101\n" +
        "event: update\n" +
        "retry: 3000\n" +
        'data: {"count":1}\n\n' +
        "event: multiline\n" +
        "data: line1\n" +
        "data: line2\n\n";

    assert.equal(consumed.body, expected);
});

test("stream: stream.write / end のクローズ状態判定と自動クローズ", async () => {
    fs.writeFileSync(path.join(tmpDir, "public", "autoclose.mt.js"), `
        exports.handler = async () => {
            $response().stream(async (stream) => {
                stream.write("part1");
                // 明示的 end() を呼ばずに正常終了
            });
        };
    `);

    const rawResult = await mintoLambdaIndex.handler(createEvent("/autoclose"), {});
    const consumed = await mintoLambdaIndex.consumeStreamResponse(rawResult);
    assert.equal(consumed.body, "part1");
});
