// test/modules/auth-apiKey.test.js
// modules/auth/apiKey.js の単体テスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const apiKey = require("../../modules/auth/apiKey.js");

test("apiKey.extractToken: Authorization Bearer ヘッダーからトークンを抽出できる", () => {
    const mockReq = {
        header: (name) => (name === "authorization" ? "Bearer test-api-key-123" : null)
    };
    const token = apiKey.extractToken(mockReq);
    assert.equal(token, "test-api-key-123");
});

test("apiKey.extractToken: X-Api-Key ヘッダーからトークンを抽出できる", () => {
    const mockReq = {
        header: (name) => (name === "x-api-key" ? "my-custom-x-api-key" : null)
    };
    const token = apiKey.extractToken(mockReq);
    assert.equal(token, "my-custom-x-api-key");
});

test("apiKey.extractToken: クエリパラメータ許可時はクエリからトークンを抽出できる", () => {
    const mockReq = {
        header: () => null,
        query: (name) => (name === "apiKey" ? "query-token-abc" : null)
    };
    // 許可なし
    assert.equal(apiKey.extractToken(mockReq, { allowQuery: false }), null);
    // 許可あり
    assert.equal(apiKey.extractToken(mockReq, { allowQuery: true }), "query-token-abc");
});

test("apiKey.verify: 単一文字列キーの検証", () => {
    const valid = "secret-key-xyz";
    assert.deepEqual(apiKey.verify("secret-key-xyz", valid), {
        valid: true,
        key: "secret-key-xyz",
        meta: null
    });
    assert.equal(apiKey.verify("wrong-key", valid), null);
    assert.equal(apiKey.verify("", valid), null);
    assert.equal(apiKey.verify(null, valid), null);
});

test("apiKey.verify: 配列キーの検証", () => {
    const keys = ["key-alpha", "key-beta"];
    assert.ok(apiKey.verify("key-alpha", keys).valid);
    assert.ok(apiKey.verify("key-beta", keys).valid);
    assert.equal(apiKey.verify("key-gamma", keys), null);
});

test("apiKey.verify: Object(マップ)キーの検証とメタデータ取得", () => {
    const keyMap = {
        "admin-token": { role: "admin", user: "alice" },
        "read-token": { role: "viewer", user: "bob" }
    };
    const resAdmin = apiKey.verify("admin-token", keyMap);
    assert.equal(resAdmin.valid, true);
    assert.deepEqual(resAdmin.meta, { role: "admin", user: "alice" });

    const resViewer = apiKey.verify("read-token", keyMap);
    assert.equal(resViewer.valid, true);
    assert.deepEqual(resViewer.meta, { role: "viewer", user: "bob" });

    assert.equal(apiKey.verify("unknown-token", keyMap), null);
});

test("apiKey.verify: カスタム検証関数の検証", () => {
    const validator = (token) => {
        if (token.startsWith("tok_live_")) {
            return { environment: "live", id: token.substring(9) };
        }
        return false;
    };
    const res = apiKey.verify("tok_live_999", validator);
    assert.equal(res.valid, true);
    assert.deepEqual(res.meta, { environment: "live", id: "999" });

    assert.equal(apiKey.verify("tok_test_123", validator), null);
});

test("apiKey.guard: 認証成功時は認証結果を返し、失敗時は401を設定する", () => {
    let statusCode = null;
    let responseBody = null;
    let responseHeader = {};

    global.$request = () => ({
        header: (name) => (name === "x-api-key" ? "valid-key-1" : null)
    });
    global.$response = () => ({
        status: (code) => { statusCode = code; },
        header: (k, v) => { responseHeader[k] = v; },
        body: (b) => { responseBody = b; }
    });

    // 成功
    const successResult = apiKey.guard({ keys: ["valid-key-1", "valid-key-2"] });
    assert.equal(successResult.valid, true);
    assert.equal(statusCode, null);

    // 失敗
    global.$request = () => ({
        header: () => "invalid-key"
    });
    const failResult = apiKey.guard({ keys: ["valid-key-1", "valid-key-2"] });
    assert.equal(failResult, false);
    assert.equal(statusCode, 401);
    assert.equal(responseBody.error, "Unauthorized");
});
