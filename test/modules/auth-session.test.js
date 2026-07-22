// modules/auth/session.js のテスト.
// $loadLib("s3sdk.js")/$loadConf("session.json")/$request/$response/$cache
// 依存のため、テスト用にs3sdkをインメモリのフェイク実装に差し替え、
// $loadConfもスタブしてから読み込む。
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// s3上のオブジェクトをメモリ上のMapで模したフェイクs3sdk.
let _store;
const fakeS3sdk = {
    put: async function (bucket, prefix, key, body) {
        _store.set(prefix + key, body);
    },
    get: async function (bucket, prefix, key) {
        const body = _store.get(prefix + key);
        if (body === undefined) {
            return null;
        }
        return { Body: { transformToString: async function () { return body; } } };
    },
    delete: async function (bucket, prefix, key) {
        _store.delete(prefix + key);
    },
    list: async function (bucket, prefix) {
        const contents = [];
        for (const k of _store.keys()) {
            if (k.startsWith(prefix)) {
                contents.push({ Key: k });
            }
        }
        return { Contents: contents };
    }
};

global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return fakeS3sdk;
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.$require = function (name) {
    return require(name);
};

let _sessionConf;
global.$loadConf = function (name) {
    if (name === "session.json") {
        return _sessionConf;
    }
    throw new Error("unexpected $loadConf: " + name);
};

let _cookies;
let _cookieOpts;
let _cache;
global.$request = function () {
    return {
        cookie: function (name) {
            return _cookies[name];
        }
    };
};
global.$response = function () {
    return {
        cookie: function (name, opts) {
            _cookies[name] = opts.value;
            _cookieOpts[name] = opts;
        }
    };
};
global.$cache = function () {
    return _cache;
};

beforeEach(() => {
    _store = new Map();
    _cookies = {};
    _cookieOpts = {};
    _cache = {};
    _sessionConf = { bucket: "test-bucket" };
    // conf/session.jsonはモジュール初回利用時に一度だけ読み込みキャッシュ
    // されるため、beforeEachごとにモジュールキャッシュもクリアする.
    delete require.cache[require.resolve("../../modules/auth/session.js")];
});

test("session: conf/session.jsonにbucketが無い場合は例外を投げる", async () => {
    _sessionConf = {};
    const session = require("../../modules/auth/session.js");
    await assert.rejects(async () => {
        await session.start("user1", {});
    });
});

test("session: conf/session.jsonが存在しない場合は例外を投げる", async () => {
    _sessionConf = null;
    const session = require("../../modules/auth/session.js");
    await assert.rejects(async () => {
        await session.start("user1", {});
    });
});

test("session: start/getで登録したuserId/userDataが取得できる", async () => {
    const session = require("../../modules/auth/session.js");
    const sid = await session.start("user1", { role: "admin" });
    assert.equal(typeof sid, "string");
    const ses = await session.get(sid);
    assert.equal(ses.userId, "user1");
    assert.deepEqual(ses.data, { role: "admin" });
});

test("session: 存在しないセッションIDはnullが返る", async () => {
    const session = require("../../modules/auth/session.js");
    assert.equal(await session.get("not-exists"), null);
    assert.equal(await session.get(null), null);
    assert.equal(await session.get(""), null);
});

test("session: timeoutMinを超えたセッションはgetでnullになり自動削除される", async () => {
    _sessionConf = { bucket: "test-bucket", timeoutMin: 30 };
    const session = require("../../modules/auth/session.js");
    const sid = await session.start("user1", {});
    // lastAccessを timeout超過分だけ過去に書き換えてタイムアウトを再現する.
    const key = "sessions/" + sid + ".json";
    const raw = JSON.parse(_store.get(key));
    raw.lastAccess = Date.now() - (31 * 60 * 1000);
    _store.set(key, JSON.stringify(raw));

    assert.equal(await session.get(sid), null);
    assert.equal(_store.has(key), false);
});

test("session: destroyでセッションが削除される", async () => {
    const session = require("../../modules/auth/session.js");
    const sid = await session.start("user1", {});
    await session.destroy(sid);
    assert.equal(await session.get(sid), null);
});

test("session: destroyはsidが無い場合何もしない", async () => {
    const session = require("../../modules/auth/session.js");
    await session.destroy(null);
    await session.destroy("");
});

test("session: countは現在保存されているセッション数を返す", async () => {
    const session = require("../../modules/auth/session.js");
    await session.start("user1", {});
    await session.start("user2", {});
    assert.equal(await session.count(), 2);
});

test("session: setCookieはCookieにセッションIDを設定しgetCookieで取得できる", async () => {
    const session = require("../../modules/auth/session.js");
    const sid = await session.setCookie("user1", { role: "admin" });
    assert.equal(_cookies["minto_sid"], sid);
    const ses = await session.getCookie();
    assert.equal(ses.userId, "user1");
});

test("session: getCookieは同一リクエスト内でキャッシュされる", async () => {
    const session = require("../../modules/auth/session.js");
    await session.setCookie("user1", {});
    const first = await session.getCookie();
    // ストアから直接削除してもキャッシュにより同じ結果が返ることを確認する.
    await session.destroy(_cookies["minto_sid"]);
    const second = await session.getCookie();
    assert.deepEqual(second, first);
});

test("session: destroyCookieはS3のセッションとCookieを両方クリアする", async () => {
    const session = require("../../modules/auth/session.js");
    const sid = await session.setCookie("user1", {});
    await session.destroyCookie();
    assert.equal(_cookies["minto_sid"], "");
    assert.equal(await session.get(sid), null);
});

test("session: conf/session.jsonにsamesite未設定の場合はCookieがlaxになる", async () => {
    const session = require("../../modules/auth/session.js");
    await session.setCookie("user1", {});
    assert.equal(_cookieOpts["minto_sid"].samesite, "lax");
});

test("session: conf/session.jsonのsamesiteを設定した場合はCookieに反映される", async () => {
    _sessionConf = { bucket: "test-bucket", samesite: "strict" };
    const session = require("../../modules/auth/session.js");
    await session.setCookie("user1", {});
    assert.equal(_cookieOpts["minto_sid"].samesite, "strict");
});

test("session: destroyCookie時のCookieクリアにもsamesite設定が反映される", async () => {
    _sessionConf = { bucket: "test-bucket", samesite: "none" };
    const session = require("../../modules/auth/session.js");
    await session.setCookie("user1", {});
    await session.destroyCookie();
    assert.equal(_cookieOpts["minto_sid"].samesite, "none");
});
