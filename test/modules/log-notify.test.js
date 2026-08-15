// modules/notification/log.js および notifyError.js のテスト.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

let consoleLogs = [];
let consoleWarns = [];
let consoleErrors = [];
let fetchCalls = [];

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
const origFetch = global.fetch;

beforeEach(() => {
    consoleLogs = [];
    consoleWarns = [];
    consoleErrors = [];
    fetchCalls = [];

    console.log = function (...args) {
        consoleLogs.push(args.join(" "));
    };
    console.warn = function (...args) {
        consoleWarns.push(args.join(" "));
    };
    console.error = function (...args) {
        consoleErrors.push(args.join(" "));
    };
    global.fetch = async function (url, options) {
        fetchCalls.push({ url: url, options: options });
        return {
            status: 200,
            json: async () => ({ ok: true })
        };
    };

    global.$requestId = function () {
        return "req-test-12345";
    };
    global.$request = function () {
        return {
            path: () => "/api/users/profile",
            method: () => "POST"
        };
    };
});

afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    global.fetch = origFetch;
    delete process.env.LOG_LEVEL;
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_ERROR_WEBHOOK_URL;
    delete process.env.SLACK_TOKEN;
});

const log = require("../../modules/notification/log.js");
const notifyError = require("../../modules/notification/notifyError.js");

test("log: 構造化ログがJSON 1行形式で出力され、requestIdやpathが自動付与される", () => {
    log.info("User created", { userId: "u123", email: "test@example.com" });

    assert.equal(consoleLogs.length, 1);
    const parsed = JSON.parse(consoleLogs[0]);
    assert.equal(parsed.level, "INFO");
    assert.equal(parsed.message, "User created");
    assert.equal(parsed.requestId, "req-test-12345");
    assert.equal(parsed.path, "/api/users/profile");
    assert.equal(parsed.method, "POST");
    assert.equal(parsed.data.userId, "u123");
    assert.equal(parsed.data.email, "test@example.com");
    assert.ok(typeof parsed.time === "string");
});

test("log.error: Errorオブジェクトのname/message/stackが自動シリアライズされる", () => {
    const customErr = new Error("Database connection timeout");
    customErr.code = "ECONNTIMEOUT";
    log.error("DB Error occurred", customErr, { table: "users" });

    assert.equal(consoleErrors.length, 1);
    const parsed = JSON.parse(consoleErrors[0]);
    assert.equal(parsed.level, "ERROR");
    assert.equal(parsed.message, "DB Error occurred");
    assert.equal(parsed.error.name, "Error");
    assert.equal(parsed.error.message, "Database connection timeout");
    assert.equal(parsed.error.code, "ECONNTIMEOUT");
    assert.ok(typeof parsed.error.stack === "string");
});

test("log: LOG_LEVEL 環境変数による出力抑制", () => {
    process.env.LOG_LEVEL = "warn";

    log.debug("Debug msg");
    log.info("Info msg");
    assert.equal(consoleLogs.length, 0);

    log.warn("Warn msg");
    assert.equal(consoleWarns.length, 1);

    log.error("Error msg");
    assert.equal(consoleErrors.length, 1);
});

test("notifyError: Webhook URL が設定されている場合にSlackへリッチメッセージが送信される", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T00/B00/X00";

    const err = new Error("Payment gateway failure");
    const res = await notifyError(err, { orderId: "ord_999", amount: 5000 });

    assert.equal(res.ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://hooks.slack.com/services/T00/B00/X00");

    const payload = JSON.parse(fetchCalls[0].options.body);
    assert.ok(payload.text.includes("Payment gateway failure"));
    assert.equal(payload.attachments[0].color, "#e01e5a");

    const fields = payload.attachments[0].fields;
    const reqField = fields.find(f => f.title === "Request ID");
    assert.ok(reqField.value.includes("req-test-12345"));

    const endpointField = fields.find(f => f.title === "Endpoint");
    assert.ok(endpointField.value.includes("POST /api/users/profile"));

    const orderField = fields.find(f => f.title === "orderId");
    assert.equal(orderField.value, "ord_999");
});

test("notifyError: 未設定時は例外を投げず安全にフォールバックする", async () => {
    const err = new Error("Some minor failure");
    const res = await notifyError(err);

    assert.equal(res.ok, false);
    assert.equal(res.reason, "No webhook or token configured");
    // 構造化ログには記録されている
    assert.equal(consoleErrors.length, 1);
});

test("notifyError: throwError: true 指定時は例外が再送出される", async () => {
    const err = new Error("Fatal fatal");
    await assert.rejects(async () => {
        await notifyError(err, {}, { throwError: true });
    }, /Fatal fatal/);
});

test("notifyError.catch: 非同期関数ラッパーでエラーが通知され再送出される", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/mock";

    const faultyFunction = notifyError.catch(async (id) => {
        throw new Error("Failed to process item: " + id);
    }, { service: "order-processor" });

    await assert.rejects(async () => {
        await faultyFunction(42);
    }, /Failed to process item: 42/);

    assert.equal(fetchCalls.length, 1);
    const payload = JSON.parse(fetchCalls[0].options.body);
    assert.ok(payload.text.includes("Failed to process item: 42"));
});
