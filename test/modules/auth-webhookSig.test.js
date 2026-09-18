// test/modules/auth-webhookSig.test.js
// modules/auth/webhookSig.js の単体テスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const webhookSig = require("../../modules/auth/webhookSig.js");

test("webhookSig.verifyGithub: x-hub-signature-256 (SHA-256) 署名を正しく検証できる", () => {
    const secret = "github-webhook-secret-123";
    const body = JSON.stringify({ action: "opened", issue: { number: 42 } });
    const computed = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const header = "sha256=" + computed;

    assert.equal(webhookSig.verifyGithub(body, header, secret), true);
    assert.equal(webhookSig.verifyGithub(body, "sha256=invalidhash", secret), false);
    assert.equal(webhookSig.verifyGithub("altered body", header, secret), false);
    assert.equal(webhookSig.verifyGithub(body, header, "wrong-secret"), false);
});

test("webhookSig.verifyGithub: 旧仕様 x-hub-signature (SHA-1) 署名も検証できる", () => {
    const secret = "github-secret";
    const body = "hello github";
    const computed = crypto.createHmac("sha1", secret).update(body).digest("hex");
    const header = "sha1=" + computed;

    assert.equal(webhookSig.verifyGithub(body, header, secret), true);
});

test("webhookSig.verifyStripe: stripe-signature (t=...,v1=...) 署名を正しく検証できる", () => {
    const secret = "whsec_test_secret_abc123";
    const body = JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded" });
    const nowSec = Math.floor(Date.now() / 1000);

    const payload = nowSec + "." + body;
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const header = "t=" + nowSec + ",v1=" + sig + ",v0=oldsig";

    // 正常検証
    assert.equal(webhookSig.verifyStripe(body, header, secret, 300), true);

    // ボディ改ざん
    assert.equal(webhookSig.verifyStripe('{"id":"hacked"}', header, secret, 300), false);

    // シークレット違い
    assert.equal(webhookSig.verifyStripe(body, header, "whsec_wrong", 300), false);

    // リプレイ攻撃（タイムスタンプが古い場合）
    const oldTimestamp = nowSec - 600; // 10分前
    const oldPayload = oldTimestamp + "." + body;
    const oldSig = crypto.createHmac("sha256", secret).update(oldPayload).digest("hex");
    const oldHeader = "t=" + oldTimestamp + ",v1=" + oldSig;
    // toleranceSec=300 (5分) で弾かれる
    assert.equal(webhookSig.verifyStripe(body, oldHeader, secret, 300), false);
});

test("webhookSig.verifySlack: x-slack-signature (v0:t:body) 署名を正しく検証できる", () => {
    const secret = "slack-signing-secret-xyz";
    const body = "command=/minto&text=deploy";
    const nowSec = Math.floor(Date.now() / 1000);

    const payload = "v0:" + nowSec + ":" + body;
    const sig = "v0=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // 正常検証
    assert.equal(webhookSig.verifySlack(body, sig, String(nowSec), secret, 300), true);

    // ボディ改ざん
    assert.equal(webhookSig.verifySlack("command=/hacked", sig, String(nowSec), secret, 300), false);

    // 期限切れタイムスタンプ
    const oldTime = nowSec - 500;
    assert.equal(webhookSig.verifySlack(body, sig, String(oldTime), secret, 300), false);
});

test("webhookSig.verifyHmac: 汎用HMAC検証 (sha256, sha512, hex, base64)", () => {
    const secret = "generic-secret";
    const body = "message to be signed";

    // SHA-256 hex
    const hexSig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(webhookSig.verifyHmac(body, hexSig, secret), true);
    assert.equal(webhookSig.verifyHmac(body, "sha256=" + hexSig, secret, { prefix: "sha256=" }), true);

    // SHA-256 base64
    const b64Sig = crypto.createHmac("sha256", secret).update(body).digest("base64");
    assert.equal(webhookSig.verifyHmac(body, b64Sig, secret, { encoding: "base64" }), true);
});

test("webhookSig.guard: 高レベルガード関数による自動検証", () => {
    let statusCode = null;
    let responseBody = null;
    const secret = "whsec_stripe_test";
    const body = '{"type":"checkout.completed"}';
    const nowSec = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(nowSec + "." + body).digest("hex");

    global.$request = () => ({
        body: () => body,
        header: (name) => (name === "stripe-signature" ? `t=${nowSec},v1=${sig}` : null)
    });
    global.$response = () => ({
        status: (code) => { statusCode = code; },
        body: (b) => { responseBody = b; }
    });

    // 成功
    assert.equal(webhookSig.guard("stripe", secret), true);
    assert.equal(statusCode, null);

    // 失敗
    global.$request = () => ({
        body: () => body,
        header: () => "t=1,v1=invalidsig"
    });
    assert.equal(webhookSig.guard("stripe", secret), false);
    assert.equal(statusCode, 400);
    assert.equal(responseBody.error, "Bad Request");
});
