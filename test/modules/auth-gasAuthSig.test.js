// modules/auth/gasAuthSig.js のテスト.
// $loadLib("convb.js") 依存のため、テスト用に $loadLib をスタブしてから読み込む.
global.$loadLib = function (name) {
    if (name === "convb.js") {
        return require("../../modules/auth/convb.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};

// createSessionId が rand.getArray/rand.next に依存するため、テスト用の
// 簡易グローバル乱数オブジェクトをスタブする(lambda/src/index.jsのrandと同等I/F)。
global.rand = {
    next: function () {
        return Math.floor(Math.random() * 0x100000000);
    },
    getArray: function (out, len) {
        for (let i = 0; i < len; i++) {
            out[i] = Math.floor(Math.random() * 0x100);
        }
    },
    getBytes: function (len) {
        const ret = Buffer.alloc(len);
        for (let i = 0; i < len; i++) {
            ret[i] = Math.floor(Math.random() * 0x100);
        }
        return ret;
    }
};

const sig = require("../../modules/auth/gasAuthSig.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("gasAuthSig: cutEndBase64Eq は末尾の=を全て除去する", () => {
    assert.equal(sig.cutEndBase64Eq("abc=="), "abc");
    assert.equal(sig.cutEndBase64Eq("abcd"), "abcd");
    assert.equal(sig.cutEndBase64Eq("===="), "");
});

test("gasAuthSig: getPassCode は同じuser/passwordなら同じ結果になる", () => {
    const a = sig.getPassCode("user1", "password1");
    const b = sig.getPassCode("user1", "password1");
    assert.equal(a, b);
    assert.equal(typeof a, "string");
});

test("gasAuthSig: getPassCode はuserかpasswordが違えば異なる結果になる", () => {
    const a = sig.getPassCode("user1", "password1");
    const b = sig.getPassCode("user2", "password1");
    const c = sig.getPassCode("user1", "password2");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
});

test("gasAuthSig: createSessionId はデフォルト長で生成できる", () => {
    const id = sig.createSessionId();
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
});

test("gasAuthSig: createSessionId は最大長を超えると例外を投げる", () => {
    assert.throws(() => {
        sig.createSessionId(200);
    });
});

test("gasAuthSig: encodeToken/decodeToken は往復して同じ内容が復元できる", () => {
    const keyCode = "test-key-code";
    const user = "user@example.com";
    const passCode = sig.getPassCode(user, "password");
    const sessionId = sig.createSessionId();
    const token = sig.encodeToken(keyCode, user, passCode, sessionId, null, 60000);
    const decoded = sig.decodeToken(keyCode, token);
    assert.equal(decoded.user, user);
    assert.equal(decoded.passCode, passCode);
    assert.equal(decoded.sessionId, sessionId);
    assert.equal(typeof decoded.expire, "number");
    assert.ok(decoded.expire > Date.now());
});

test("gasAuthSig: decodeToken は異なるkeyCodeで検証すると例外を投げる", () => {
    const user = "user@example.com";
    const passCode = sig.getPassCode(user, "password");
    const sessionId = sig.createSessionId();
    const token = sig.encodeToken("key-a", user, passCode, sessionId, null, 60000);
    assert.throws(() => {
        sig.decodeToken("key-b", token);
    });
});

test("gasAuthSig: encodeToken はuser/sessionIdが文字列でない場合に例外を投げる", () => {
    assert.throws(() => {
        sig.encodeToken("key", 123, "pass", "sid", null, 1000);
    });
    assert.throws(() => {
        sig.encodeToken("key", "user", "pass", 123, null, 1000);
    });
});
