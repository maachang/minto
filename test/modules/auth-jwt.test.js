// modules/auth/jwt.js のテスト.
// $require("crypto") 依存のため、テスト用に $require をスタブしてから読み込む.
global.$require = function (name) {
    return require(name);
};
const jwt = require("../../modules/auth/jwt.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("jwt: sign/verify で正しいpayloadが検証成功する", () => {
    const token = jwt.sign({ userId: 1 }, "secret", { expiresIn: 60 });
    const payload = jwt.verify(token, "secret");
    assert.equal(payload.userId, 1);
    assert.equal(typeof payload.iat, "number");
    assert.equal(typeof payload.exp, "number");
    assert.equal(payload.exp - payload.iat, 60);
});

test("jwt: 異なるsecretで検証すると失敗しnullが返る", () => {
    const token = jwt.sign({ userId: 1 }, "secret", { expiresIn: 60 });
    assert.equal(jwt.verify(token, "wrong-secret"), null);
});

test("jwt: 期限切れのトークンは検証失敗する", () => {
    // sign()はexpiresInに正数を要求するため、一旦発行後にpayloadのexpを
    // 過去日時に差し替えて署名し直し、期限切れ状態を再現する.
    const crypto = require("crypto");
    const base64url = (buf) => Buffer.from(buf).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ userId: 1, exp: 0 }));
    const headerPayload = header + "." + payload;
    const sign = base64url(crypto.createHmac("sha256", "secret").update(headerPayload).digest());
    const expiredToken = headerPayload + "." + sign;
    assert.equal(jwt.verify(expiredToken, "secret"), null);
});

test("jwt: フォーマット不正なトークンは検証失敗する", () => {
    assert.equal(jwt.verify("invalid.token", "secret"), null);
    assert.equal(jwt.verify(123, "secret"), null);
});

test("jwt: options.noError == false の場合は例外throwする", () => {
    assert.throws(() => {
        jwt.verify("invalid.token", "secret", { noError: false });
    });
});

test("jwt: options.expiresIn 未指定はエラーになる", () => {
    assert.throws(() => {
        jwt.sign({ userId: 1 }, "secret");
    });
});

test("jwt: options.expiresIn が0以下はエラーになる", () => {
    assert.throws(() => {
        jwt.sign({ userId: 1 }, "secret", { expiresIn: 0 });
    });
});

test("jwt: payloadにiat/expを指定しても自動付与された値で上書きされる", () => {
    const token = jwt.sign({ exp: 1, iat: 1 }, "secret", { expiresIn: 60 });
    const payload = jwt.verify(token, "secret");
    assert.notEqual(payload.exp, 1);
    assert.notEqual(payload.iat, 1);
});
