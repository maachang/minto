// modules/auth/csrf.js のテスト.
// $request()/$require("crypto")依存のため、テスト用にスタブしてから読み込む.
global.$require = function (name) {
    return require(name);
};
let _cookies;
let _reqHeaders;
global.$request = function () {
    return {
        cookie: function (name) {
            return _cookies[name];
        },
        header: function (name) {
            return _reqHeaders[name];
        }
    };
};

const csrf = require("../../modules/auth/csrf.js");

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

beforeEach(() => {
    _cookies = {};
    _reqHeaders = {};
});

test("csrf.generateToken: セッションIDが無い場合はnullを返す", () => {
    const token = csrf.generateToken();
    assert.equal(token, null);
});

test("csrf.generateToken: セッションIDがある場合はトークン(hex文字列)を返す", () => {
    _cookies["minto_sid"] = "sid-001";
    const token = csrf.generateToken();
    assert.equal(typeof token, "string");
    assert.match(token, /^[0-9a-f]{64}$/);
});

test("csrf.generateToken: 同じセッションIDなら常に同じトークンを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    const token1 = csrf.generateToken();
    const token2 = csrf.generateToken();
    assert.equal(token1, token2);
});

test("csrf.generateToken: セッションIDが異なれば異なるトークンを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    const token1 = csrf.generateToken();
    _cookies["minto_sid"] = "sid-002";
    const token2 = csrf.generateToken();
    assert.notEqual(token1, token2);
});

test("csrf.verify: セッションIDが無い場合はfalseを返す", () => {
    _reqHeaders["x-csrf-token"] = "dummy";
    assert.equal(csrf.verify(), false);
});

test("csrf.verify: ヘッダーが無い場合はfalseを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    assert.equal(csrf.verify(), false);
});

test("csrf.verify: generateTokenと同じ値をヘッダーに設定した場合はtrueを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    const token = csrf.generateToken();
    _reqHeaders["x-csrf-token"] = token;
    assert.equal(csrf.verify(), true);
});

test("csrf.verify: 不正なトークンの場合はfalseを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    csrf.generateToken();
    _reqHeaders["x-csrf-token"] = "invalid-token";
    assert.equal(csrf.verify(), false);
});

test("csrf.verify: 異なるセッションIDのトークンを使い回した場合はfalseを返す", () => {
    _cookies["minto_sid"] = "sid-001";
    const token = csrf.generateToken();
    _cookies["minto_sid"] = "sid-002";
    _reqHeaders["x-csrf-token"] = token;
    assert.equal(csrf.verify(), false);
});
