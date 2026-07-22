// modules/auth/session.js のテスト.
// $loadLib("s3sdk.js")/$require("crypto")/$request/$response/$cache 依存のため、
// テスト用にs3sdkをインメモリのフェイク実装に差し替えてスタブする。
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

let _cookies;
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
        }
    };
};
global.$cache = function () {
    return _cache;
};

const session = require("../../modules/auth/session.js");

beforeEach(() => {
    _store = new Map();
    _cookies = {};
    _cache = {};
});

test("session: start/getで登録したuserId/userDataが取得できる", async () => {
    const store = session.create({ bucket: "test-bucket" });
    const sid = await store.start("user1", { role: "admin" });
    assert.equal(typeof sid, "string");
    const ses = await store.get(sid);
    assert.equal(ses.userId, "user1");
    assert.deepEqual(ses.data, { role: "admin" });
});

test("session: 存在しないセッションIDはnullが返る", async () => {
    const store = session.create({ bucket: "test-bucket" });
    assert.equal(await store.get("not-exists"), null);
    assert.equal(await store.get(null), null);
    assert.equal(await store.get(""), null);
});

test("session: timeoutMinを超えたセッションはgetでnullになり自動削除される", async () => {
    const store = session.create({ bucket: "test-bucket", timeoutMin: 30 });
    const sid = await store.start("user1", {});
    // lastAccessを timeout超過分だけ過去に書き換えてタイムアウトを再現する.
    const key = "sessions/" + sid + ".json";
    const raw = JSON.parse(_store.get(key));
    raw.lastAccess = Date.now() - (31 * 60 * 1000);
    _store.set(key, JSON.stringify(raw));

    assert.equal(await store.get(sid), null);
    assert.equal(_store.has(key), false);
});

test("session: destroyでセッションが削除される", async () => {
    const store = session.create({ bucket: "test-bucket" });
    const sid = await store.start("user1", {});
    await store.destroy(sid);
    assert.equal(await store.get(sid), null);
});

test("session: destroyはsidが無い場合何もしない", async () => {
    const store = session.create({ bucket: "test-bucket" });
    await store.destroy(null);
    await store.destroy("");
});

test("session: countは現在保存されているセッション数を返す", async () => {
    const store = session.create({ bucket: "test-bucket" });
    await store.start("user1", {});
    await store.start("user2", {});
    assert.equal(await store.count(), 2);
});

test("session: setCookieはCookieにセッションIDを設定しgetCookieで取得できる", async () => {
    const store = session.create({ bucket: "test-bucket" });
    const sid = await store.setCookie("user1", { role: "admin" });
    assert.equal(_cookies["minto_sid"], sid);
    const ses = await store.getCookie();
    assert.equal(ses.userId, "user1");
});

test("session: getCookieは同一リクエスト内でキャッシュされる", async () => {
    const store = session.create({ bucket: "test-bucket" });
    await store.setCookie("user1", {});
    const first = await store.getCookie();
    // ストアから直接削除してもキャッシュにより同じ結果が返ることを確認する.
    await store.destroy(_cookies["minto_sid"]);
    const second = await store.getCookie();
    assert.deepEqual(second, first);
});

test("session: destroyCookieはS3のセッションとCookieを両方クリアする", async () => {
    const store = session.create({ bucket: "test-bucket" });
    const sid = await store.setCookie("user1", {});
    await store.destroyCookie();
    assert.equal(_cookies["minto_sid"], "");
    assert.equal(await store.get(sid), null);
});

test("session: options.bucket未指定の場合は例外を投げる", () => {
    assert.throws(() => {
        session.create({});
    });
});
