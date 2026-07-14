// modules/auth/password.js のテスト.
// $require("crypto") 依存のため、テスト用に $require をスタブしてから読み込む.
global.$require = function (name) {
    return require(name);
};
const password = require("../../modules/auth/password.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("password: hash/verify で正しいパスワードが検証成功する", () => {
    const stored = password.hash("correct-horse-battery-staple");
    assert.equal(typeof stored.salt, "string");
    assert.equal(typeof stored.hash, "string");
    assert.equal(stored.iterations, 10000);
    assert.equal(password.verify("correct-horse-battery-staple", stored), true);
});

test("password: 間違ったパスワードは検証失敗する", () => {
    const stored = password.hash("correct-password");
    assert.equal(password.verify("wrong-password", stored), false);
});

test("password: 同じパスワードでもsaltが異なれば結果のhashは異なる", () => {
    const a = password.hash("same-password");
    const b = password.hash("same-password");
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
});

test("password: derive はNode標準のcrypto.pbkdf2Syncと同じ結果になる", () => {
    const crypto = require("crypto");
    const salt = password.genSalt(16);
    const mine = password.derive("hello world", salt, 1000, 32);
    const official = crypto.pbkdf2Sync(
        "hello world", Buffer.from(salt, "hex"), 1000, 32, "sha256"
    ).toString("hex");
    assert.equal(mine, official);
});

test("password: verify はstoredが不正な場合falseを返す", () => {
    assert.equal(password.verify("x", null), false);
    assert.equal(password.verify("x", {}), false);
    assert.equal(password.verify("x", { salt: "aa" }), false);
});

test("password: iterationsを明示指定してhash/verifyできる", () => {
    const stored = password.hash("pw", 500);
    assert.equal(stored.iterations, 500);
    assert.equal(password.verify("pw", stored), true);
});
