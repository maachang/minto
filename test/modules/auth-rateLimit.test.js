// test/modules/auth-rateLimit.test.js
// modules/auth/rateLimit.js の単体テスト.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const rateLimit = require("../../modules/auth/rateLimit.js");

beforeEach(() => {
    rateLimit.clear();
    delete global.$request;
    delete global.$response;
});

test("rateLimit.check: 初回アクセスは許可され、remainingが減少する", () => {
    const res = rateLimit.check("client-1", { windowMs: 10000, limit: 5 });
    assert.equal(res.allowed, true);
    assert.equal(res.limit, 5);
    assert.equal(res.remaining, 4);
    assert.ok(res.resetMs > 0 && res.resetMs <= 10000);
});

test("rateLimit.check: limit回数までは許可され、超過すると allowed: false になる", () => {
    const opts = { windowMs: 10000, limit: 3 };

    // 1回目 (残2)
    assert.equal(rateLimit.check("client-2", opts).allowed, true);
    // 2回目 (残1)
    assert.equal(rateLimit.check("client-2", opts).allowed, true);
    // 3回目 (残0)
    const r3 = rateLimit.check("client-2", opts);
    assert.equal(r3.allowed, true);
    assert.equal(r3.remaining, 0);

    // 4回目 (超過)
    const r4 = rateLimit.check("client-2", opts);
    assert.equal(r4.allowed, false);
    assert.equal(r4.remaining, 0);
});

test("rateLimit.check: 異なるキーは独立してカウントされる", () => {
    const opts = { windowMs: 10000, limit: 2 };
    rateLimit.check("user-a", opts);
    rateLimit.check("user-a", opts);
    assert.equal(rateLimit.check("user-a", opts).allowed, false);

    // user-b はまだ影響を受けない
    const resB = rateLimit.check("user-b", opts);
    assert.equal(resB.allowed, true);
    assert.equal(resB.remaining, 1);
});

test("rateLimit.reset: 特定キーをリセットできる", () => {
    const opts = { windowMs: 10000, limit: 1 };
    assert.equal(rateLimit.check("user-c", opts).allowed, true);
    assert.equal(rateLimit.check("user-c", opts).allowed, false);

    rateLimit.reset("user-c");
    assert.equal(rateLimit.check("user-c", opts).allowed, true);
});

test("rateLimit.check: cost オプションで消費数を指定できる", () => {
    const opts = { windowMs: 10000, limit: 10, cost: 5 };
    const r1 = rateLimit.check("user-d", opts);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 5);

    const r2 = rateLimit.check("user-d", { windowMs: 10000, limit: 10, cost: 6 });
    assert.equal(r2.allowed, false);
    assert.equal(r2.remaining, 0);
});

test("rateLimit.guard: 制限内は true を返し、X-RateLimit ヘッダーを設定する", () => {
    let headers = {};
    let status = null;
    let body = null;

    global.$request = () => ({
        ip: () => "192.168.1.100"
    });
    global.$response = () => ({
        header: (k, v) => { headers[k] = v; },
        status: (s) => { status = s; },
        body: (b) => { body = b; }
    });

    const ok = rateLimit.guard({ windowMs: 10000, limit: 5 });
    assert.equal(ok, true);
    assert.equal(status, null);
    assert.equal(headers["x-ratelimit-limit"], "5");
    assert.equal(headers["x-ratelimit-remaining"], "4");
    assert.ok(headers["x-ratelimit-reset"] !== undefined);
});

test("rateLimit.guard: 制限超過時は false を返し、HTTP 429 と Retry-After を設定する", () => {
    let headers = {};
    let status = null;
    let body = null;

    global.$request = () => ({
        ip: () => "192.168.1.200"
    });
    global.$response = () => ({
        header: (k, v) => { headers[k] = v; },
        status: (s) => { status = s; },
        body: (b) => { body = b; }
    });

    const opts = { windowMs: 10000, limit: 2 };
    assert.equal(rateLimit.guard(opts), true);
    assert.equal(rateLimit.guard(opts), true);

    // 3回目 (429)
    const blocked = rateLimit.guard(opts);
    assert.equal(blocked, false);
    assert.equal(status, 429);
    assert.equal(headers["x-ratelimit-remaining"], "0");
    assert.ok(headers["retry-after"] !== undefined);
    assert.equal(body.status, 429);
    assert.equal(body.message, "Too Many Requests");
});

test("rateLimit.guard: カスタム key または keyGenerator を指定できる", () => {
    global.$request = () => ({
        ip: () => "1.1.1.1",
        header: (name) => (name === "x-api-key" ? "my-token" : null)
    });

    const keyGen = (req) => req.header("x-api-key");
    const ok = rateLimit.guard({ limit: 1, keyGenerator: keyGen });
    assert.equal(ok, true);

    const blocked = rateLimit.guard({ limit: 1, keyGenerator: keyGen });
    assert.equal(blocked, false);
});
