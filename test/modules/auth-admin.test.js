// modules/auth/admin.js のテスト.
// $loadLib("s3sdk.js") 依存のため、s3sdkをインメモリのフェイク実装に
// 差し替えてスタブする(test/modules/auth-session.test.jsと同じ方式)。
// globalThis.crypto.subtle(WebCrypto)はNode.js標準で利用可能なため、
// 本体側と同じ実装のままテストできる。
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

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
    list: async function () {
        return { Contents: [] };
    }
};

// ログイン中ユーザー(session.getCookie()の戻り値)を差し替え可能にする
// フェイクsession(admin.isAdmin()がmail省略時に参照する).
let _loginUser;
const fakeSession = {
    getCookie: async function () {
        return _loginUser;
    }
};

global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return fakeS3sdk;
    }
    if (name === "session.js") {
        return fakeSession;
    }
    throw new Error("unexpected $loadLib: " + name);
};

// 1リクエスト単位の汎用キャッシュ(lambda/src/index.jsが提供する$cache()相当).
let _cache;
global.$cache = function () {
    return _cache;
};

const admin = require("../../modules/auth/admin.js");

beforeEach(() => {
    _store = new Map();
    _cache = {};
    _loginUser = null;
    delete process.env["ADMIN_ENCRYPT_KEY"];
    delete process.env["MINTO_ADMIN_INITIAL_MAIL"];
});

test("admin: options.bucket未指定の場合は例外を投げる", () => {
    assert.throws(() => {
        admin.create({});
    });
});

test("admin: 初期管理者(環境変数)はaddAdmin無しでisAdminがtrueになる", async () => {
    process.env["MINTO_ADMIN_INITIAL_MAIL"] = "root@example.com";
    const store = admin.create({ bucket: "test-bucket" });
    assert.equal(await store.isAdmin("root@example.com"), true);
    assert.equal(await store.isAdmin("other@example.com"), false);
});

test("admin: addAdmin/isAdmin/listAdminsで管理者を追加・確認できる", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    assert.equal(await store.isAdmin("user1@example.com"), false);
    await store.addAdmin("user1@example.com");
    assert.equal(await store.isAdmin("user1@example.com"), true);
    assert.deepEqual(await store.listAdmins(), ["user1@example.com"]);
});

test("admin: 同じmailを二重にaddAdminしても一覧に重複しない", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("user1@example.com");
    await store.addAdmin("user1@example.com");
    assert.deepEqual(await store.listAdmins(), ["user1@example.com"]);
});

test("admin: removeAdminで管理者を削除できる", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("user1@example.com");
    await store.removeAdmin("user1@example.com");
    assert.equal(await store.isAdmin("user1@example.com"), false);
    assert.deepEqual(await store.listAdmins(), []);
});

test("admin: 未登録mailのremoveAdminは何もしない(例外にならない)", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await store.removeAdmin("not-exists@example.com");
    assert.deepEqual(await store.listAdmins(), []);
});

test("admin: listAdminsは初期管理者を含めて返す(S3側の一覧には含まれない)", async () => {
    process.env["MINTO_ADMIN_INITIAL_MAIL"] = "root@example.com";
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("user1@example.com");
    assert.deepEqual(await store.listAdmins(), ["root@example.com", "user1@example.com"]);
});

test("admin: 初期管理者はaddAdmin/removeAdminしてもS3側の一覧に影響しない", async () => {
    process.env["MINTO_ADMIN_INITIAL_MAIL"] = "root@example.com";
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("root@example.com");
    assert.equal(_store.size, 0);
    await store.removeAdmin("root@example.com");
    assert.equal(await store.isAdmin("root@example.com"), true);
});

test("admin: addAdminはmail未指定の場合は例外を投げる", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await assert.rejects(async () => {
        await store.addAdmin("");
    });
});

test("admin: S3に保存される内容は平文のJSONではなく暗号化されている", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("user1@example.com");
    const raw = _store.get("admins/admins.json");
    assert.equal(typeof raw, "string");
    assert.equal(raw.indexOf("user1@example.com"), -1);
    assert.match(raw, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
});

test("admin: 異なるencryptKeyで暗号化されたデータは復号できない", async () => {
    const storeA = admin.create({ bucket: "test-bucket", encryptKey: "key-a" });
    await storeA.addAdmin("user1@example.com");
    const storeB = admin.create({ bucket: "test-bucket", encryptKey: "key-b" });
    await assert.rejects(async () => {
        await storeB.isAdmin("user1@example.com");
    });
});

test("admin: options.initialAdminは環境変数より優先される", async () => {
    process.env["MINTO_ADMIN_INITIAL_MAIL"] = "env-root@example.com";
    const store = admin.create({ bucket: "test-bucket", initialAdmin: "opt-root@example.com" });
    assert.equal(await store.isAdmin("opt-root@example.com"), true);
    assert.equal(await store.isAdmin("env-root@example.com"), false);
});

test("admin: mail省略時はsession.getCookie()のログイン中ユーザIDでチェックする", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    await store.addAdmin("user1@example.com");

    _loginUser = { userId: "user1@example.com", data: {} };
    assert.equal(await store.isAdmin(), true);

    _loginUser = { userId: "other@example.com", data: {} };
    assert.equal(await store.isAdmin(), false);
});

test("admin: mail省略時に未ログイン(getCookieがnull)の場合はfalseを返す", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    _loginUser = null;
    assert.equal(await store.isAdmin(), false);
    assert.equal(await store.isAdmin(""), false);
});

test("admin: S3への保存(put)が失敗した場合、キャッシュに未保存の変更が残らない", async () => {
    const store = admin.create({ bucket: "test-bucket" });
    // 既存の管理者を1人登録しておく(1回目のリクエストのつもりで別インスタンス経由).
    await store.addAdmin("existing@example.com");

    // 2回目のリクエストを想定してキャッシュをクリアし、以降のputを失敗させる.
    _cache = {};
    const originalPut = fakeS3sdk.put;
    fakeS3sdk.put = async function () {
        throw new Error("s3 put failed");
    };
    try {
        await assert.rejects(async () => {
            await store.addAdmin("user1@example.com");
        });
    } finally {
        fakeS3sdk.put = originalPut;
    }

    // put失敗後も、キャッシュ経由で「保存されていないはずの変更」が
    // 見えてはいけない(実際にS3(フェイク)にも反映されていないこと).
    assert.equal(await store.isAdmin("user1@example.com"), false);
    assert.deepEqual(await store.listAdmins(), ["existing@example.com"]);
});
