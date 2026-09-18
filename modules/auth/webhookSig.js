///////////////////////////////////////////////
// Webhook署名検証ヘルパーモジュール.
//
// GitHub, Stripe, Slack 等の主要外部サービスや
// 汎用HMAC-SHA256署名をセキュアに検証する.
// タイミング攻撃対策、リプレイ攻撃防止(タイムスタンプ許容範囲チェック)内蔵.
//
// llrtおよびNode.js完全互換(外部npmパッケージ不使用).
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = typeof $require === "function" ? $require("crypto") : require("crypto");

    // タイミング攻撃対策の安全な文字列比較.
    const _timingSafeCompare = function (a, b) {
        if (typeof a !== "string" || typeof b !== "string") {
            return false;
        }
        const ha = crypto.createHash("sha256").update(a).digest();
        const hb = crypto.createHash("sha256").update(b).digest();
        let diff = a.length ^ b.length;
        for (let i = 0; i < ha.length; i++) {
            diff |= ha[i] ^ hb[i];
        }
        return diff === 0;
    };

    // Bufferまたは文字列からUTF-8文字列またはBuffer表現を正規化.
    const _toBuffer = function (data) {
        if (data instanceof Buffer) {
            return data;
        }
        if (typeof data === "string") {
            return Buffer.from(data, "utf8");
        }
        return Buffer.from("" + (data || ""), "utf8");
    };

    // 汎用HMAC署名検証.
    // rawBody: リクエストボディ(Bufferまたはstring)
    // signature: 検証する署名文字列
    // secret: 共有シークレットキー
    // options: {
    //   algorithm: "sha256" (デフォルト),
    //   encoding: "hex" (デフォルト) | "base64",
    //   prefix: "" (例: "sha256=")
    // }
    const verifyHmac = function (rawBody, signature, secret, options) {
        if (!rawBody || !signature || !secret) {
            return false;
        }
        options = options || {};
        const algo = options.algorithm || "sha256";
        const encoding = options.encoding || "hex";
        let expectedSig = signature.trim();

        if (options.prefix && expectedSig.startsWith(options.prefix)) {
            expectedSig = expectedSig.substring(options.prefix.length);
        }

        const bodyBuf = _toBuffer(rawBody);
        const computed = crypto.createHmac(algo, secret).update(bodyBuf).digest(encoding);

        return _timingSafeCompare(computed, expectedSig);
    };

    // GitHub Webhook署名検証.
    // rawBody: リクエストボディ(Bufferまたはstring)
    // signatureHeader: "x-hub-signature-256" ヘッダー値 ("sha256=...")
    // secret: GitHub Webhook Secret
    const verifyGithub = function (rawBody, signatureHeader, secret) {
        if (!signatureHeader || typeof signatureHeader !== "string") {
            return false;
        }
        const sig = signatureHeader.trim();
        if (sig.startsWith("sha256=")) {
            return verifyHmac(rawBody, sig.substring(7), secret, { algorithm: "sha256" });
        }
        if (sig.startsWith("sha1=")) {
            return verifyHmac(rawBody, sig.substring(5), secret, { algorithm: "sha1" });
        }
        return false;
    };

    // Stripe Webhook署名検証.
    // rawBody: リクエストボディ(Bufferまたはstring)
    // signatureHeader: "stripe-signature" ヘッダー値 ("t=...,v1=...")
    // secret: Stripe Webhook Secret (whsec_...)
    // toleranceSec: 許容するタイムスタンプ誤差(秒, デフォルト300秒=5分)
    const verifyStripe = function (rawBody, signatureHeader, secret, toleranceSec) {
        if (!signatureHeader || typeof signatureHeader !== "string" || !secret) {
            return false;
        }
        if (toleranceSec === undefined || toleranceSec === null) {
            toleranceSec = 300;
        }

        // ヘッダーパース: t=...,v1=...,v0=...
        const parts = signatureHeader.split(",");
        let timestamp = null;
        const signatures = [];

        for (let i = 0; i < parts.length; i++) {
            const kv = parts[i].trim().split("=");
            if (kv.length === 2) {
                const k = kv[0].trim();
                const v = kv[1].trim();
                if (k === "t") {
                    timestamp = parseInt(v, 10);
                } else if (k === "v1") {
                    signatures.push(v);
                }
            }
        }

        if (!timestamp || isNaN(timestamp) || signatures.length === 0) {
            return false;
        }

        // リプレイ攻撃防止: タイムスタンプ許容範囲チェック
        if (toleranceSec > 0) {
            const nowSec = Math.floor(Date.now() / 1000);
            if (Math.abs(nowSec - timestamp) > toleranceSec) {
                return false;
            }
        }

        // 署名検証: payload = timestamp + "." + rawBody
        const bodyBuf = _toBuffer(rawBody);
        const prefixBuf = Buffer.from(timestamp + ".", "utf8");
        const payloadBuf = Buffer.concat([prefixBuf, bodyBuf]);
        const computed = crypto.createHmac("sha256", secret).update(payloadBuf).digest("hex");

        for (let i = 0; i < signatures.length; i++) {
            if (_timingSafeCompare(computed, signatures[i])) {
                return true;
            }
        }

        return false;
    };

    // Slack Webhook/イベント署名検証.
    // rawBody: リクエストボディ(Bufferまたはstring)
    // signatureHeader: "x-slack-signature" ヘッダー値 ("v0=...")
    // timestampHeader: "x-slack-request-timestamp" ヘッダー値 (UNIX秒)
    // secret: Slack Signing Secret
    // toleranceSec: 許容するタイムスタンプ誤差(秒, デフォルト300秒=5分)
    const verifySlack = function (rawBody, signatureHeader, timestampHeader, secret, toleranceSec) {
        if (!signatureHeader || typeof signatureHeader !== "string" || !timestampHeader || !secret) {
            return false;
        }
        if (toleranceSec === undefined || toleranceSec === null) {
            toleranceSec = 300;
        }

        const timestamp = parseInt(timestampHeader, 10);
        if (isNaN(timestamp)) {
            return false;
        }

        // リプレイ攻撃防止: タイムスタンプ許容範囲チェック
        if (toleranceSec > 0) {
            const nowSec = Math.floor(Date.now() / 1000);
            if (Math.abs(nowSec - timestamp) > toleranceSec) {
                return false;
            }
        }

        // 署名検証: payload = "v0:" + timestamp + ":" + rawBody
        const bodyBuf = _toBuffer(rawBody);
        const prefixBuf = Buffer.from("v0:" + timestamp + ":", "utf8");
        const payloadBuf = Buffer.concat([prefixBuf, bodyBuf]);
        const computed = "v0=" + crypto.createHmac("sha256", secret).update(payloadBuf).digest("hex");

        return _timingSafeCompare(computed, signatureHeader.trim());
    };

    // 高レベルガード(現在の $request() を自動判定して検証).
    // provider: "github" | "stripe" | "slack"
    // secret: 各サービスのシークレット(省略時は環境変数 GITHUB_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET, SLACK_SIGNING_SECRET)
    // options: { autoResponse: true(デフォルト), toleranceSec: 300 }
    const guard = function (provider, secret, options) {
        options = options || {};
        if (typeof $request !== "function") {
            return false;
        }
        const req = $request();
        const rawBody = req.body ? req.body() : "";
        provider = ("" + provider).toLowerCase();

        let ok = false;

        if (provider === "github") {
            secret = secret || process.env.GITHUB_WEBHOOK_SECRET;
            const sig = req.header ? req.header("x-hub-signature-256") || req.header("x-hub-signature") : null;
            ok = verifyGithub(rawBody, sig, secret);
        } else if (provider === "stripe") {
            secret = secret || process.env.STRIPE_WEBHOOK_SECRET;
            const sig = req.header ? req.header("stripe-signature") : null;
            ok = verifyStripe(rawBody, sig, secret, options.toleranceSec);
        } else if (provider === "slack") {
            secret = secret || process.env.SLACK_SIGNING_SECRET;
            const sig = req.header ? req.header("x-slack-signature") : null;
            const ts = req.header ? req.header("x-slack-request-timestamp") : null;
            ok = verifySlack(rawBody, sig, ts, secret, options.toleranceSec);
        } else {
            console.error("[WEBHOOK] Unsupported webhook provider: " + provider);
            ok = false;
        }

        if (!ok && options.autoResponse !== false && typeof $response === "function") {
            const res = $response();
            res.status(400, "Bad Request");
            res.body({ error: "Bad Request", message: "Invalid webhook signature" });
            return false;
        }

        return ok;
    };

    exports.verifyHmac = verifyHmac;
    exports.verifyGithub = verifyGithub;
    exports.verifyStripe = verifyStripe;
    exports.verifySlack = verifySlack;
    exports.guard = guard;
    exports._timingSafeCompare = _timingSafeCompare;
})();
