// modules/util/encrypt.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const encryptUtil = require("../../modules/util/encrypt.js");

test("encrypt: AES-256-GCM の暗号化と復号", async () => {
    const key = "my-secret-key-12345";
    const plainText = "Hello, minto! 日本語テスト 12345";

    // 暗号化
    const encrypted = await encryptUtil.encrypt(plainText, key);
    assert.equal(typeof encrypted, "string");
    assert.equal(encrypted.split(":").length, 3); // iv:authTag:ciphertext

    // 復号
    const decrypted = await encryptUtil.decrypt(encrypted, key);
    assert.equal(decrypted, plainText);

    // オブジェクトの暗号化
    const obj = { userId: "user-001", role: "admin", active: true };
    const encryptedObj = await encryptUtil.encrypt(obj, key);
    const decryptedObj = await encryptUtil.decrypt(encryptedObj, key);
    assert.deepEqual(JSON.parse(decryptedObj), obj);

    // 空文字・null の暗号化
    assert.equal(await encryptUtil.encrypt("", key), "");
    assert.equal(await encryptUtil.encrypt(null, key), "");
    assert.equal(await encryptUtil.encrypt(undefined, key), "");
});

test("encrypt: 改ざん検知および不正なキーのエラーハンドリング", async () => {
    const key = "correct-secret-key";
    const wrongKey = "wrong-secret-key";
    const plainText = "Sensitive user information";

    const encrypted = await encryptUtil.encrypt(plainText, key);

    // 1. 間違ったキーで復号 -> null
    const wrongResult = await encryptUtil.decrypt(encrypted, wrongKey);
    assert.equal(wrongResult, null);

    // 2. 暗号文が改ざんされた場合 -> null
    const parts = encrypted.split(":");
    // 暗号文部分を改ざん
    const tamperedCipher = parts[0] + ":" + parts[1] + ":" + parts[2].slice(0, -2) + "00";
    const tamperedResult = await encryptUtil.decrypt(tamperedCipher, key);
    assert.equal(tamperedResult, null);

    // 3. 認証タグが改ざんされた場合 -> null
    const tamperedTag = parts[0] + ":" + parts[1].slice(0, -2) + "00" + ":" + parts[2];
    const tagResult = await encryptUtil.decrypt(tamperedTag, key);
    assert.equal(tagResult, null);

    // 4. 不正なフォーマット -> null
    assert.equal(await encryptUtil.decrypt("invalid-string", key), null);
    assert.equal(await encryptUtil.decrypt("", key), null);
    assert.equal(await encryptUtil.decrypt(null, key), null);
});

test("encrypt: randomToken / sha256 / hmac", () => {
    // 1. randomToken
    const token1 = encryptUtil.randomToken(32);
    const token2 = encryptUtil.randomToken(32);
    const tokenShort = encryptUtil.randomToken(16);

    assert.equal(typeof token1, "string");
    assert.equal(token1.length, 32);
    assert.equal(tokenShort.length, 16);
    assert.notEqual(token1, token2); // 重複しない
    assert.match(token1, /^[A-Za-z0-9_-]+$/); // URLセーフ

    // 2. sha256
    const hash = encryptUtil.sha256("minto-test");
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
    assert.equal(hash, encryptUtil.sha256("minto-test")); // 決定論的
    assert.notEqual(hash, encryptUtil.sha256("other-text"));

    // 3. hmac
    const sig = encryptUtil.hmac("message-payload", "secret-key");
    assert.equal(typeof sig, "string");
    assert.equal(sig.length, 64);
    assert.equal(sig, encryptUtil.hmac("message-payload", "secret-key"));
    assert.notEqual(sig, encryptUtil.hmac("message-payload", "different-key"));
});
