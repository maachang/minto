// modules/auth/gasAuth.js のテスト.
// $require("crypto")/$loadLib("gasAuthSig.js")/rand/HttpError/$request/$response
// 依存のため、テスト用にグローバルをスタブしてから読み込む.
global.$require = function (name) {
    return require(name);
};
global.$loadLib = function (name) {
    if (name === "gasAuthSig.js") {
        return require("../../modules/auth/gasAuthSig.js");
    }
    if (name === "convb.js") {
        return require("../../modules/auth/convb.js");
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.rand = {
    next: function () {
        return Math.floor(Math.random() * 0x100000000);
    }
};
global.HttpError = class extends Error {
    constructor(args) {
        args = args || {};
        super(args.message);
        this.status = args.status;
    }
};

let _request = null;
global.$request = function () {
    return _request;
};
global.$response = function () {
    return { redirect: function () {} };
};

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const ENV_KEY = "ALLOW_GAS_AUTH_KEY_CODE";

beforeEach(() => {
    process.env[ENV_KEY] = "test-auth-key-code";
    process.env["GAS_AUTH_URL"] = "https://example.com/gas";
    _request = {
        header: function () { return "example.com"; },
        params: function () { return {}; },
        path: function () { return "/"; }
    };
    // モジュールキャッシュをクリアして環境変数変更を反映させる.
    delete require.cache[require.resolve("../../modules/auth/gasAuth.js")];
});

test("gasAuth: executeOAuthURL はGAS_AUTH_URLへtargetとtokenを付与したURLを生成する", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    _request.params = function () { return {}; };
    const url = gasAuth.executeOAuthURL(_request, "/resultOAuth");
    assert.ok(url.startsWith("https://example.com/gas?"));
    assert.ok(url.indexOf("target=oAuth") !== -1);
    assert.ok(url.indexOf("request-token-key=") !== -1);
    assert.ok(url.indexOf("request-token=") !== -1);
    assert.ok(url.indexOf("callbackURL=") !== -1);
});

test("gasAuth: executeOAuthURL はENV_GAS_ALLOW_AUTH_KEY_CODE未設定だと例外を投げる", () => {
    delete process.env[ENV_KEY];
    const gasAuth = require("../../modules/auth/gasAuth.js");
    assert.throws(() => {
        gasAuth.executeOAuthURL(_request, "/resultOAuth");
    });
});

// getOAuthMail はisRedirectToken内で完結する検証ロジックのため、GAS側の
// createRedirectToken(gas/gasAuth.js)相当の処理をここで再現し、
// 正規のコールバックパラメータを組み立てるヘルパー.
const REDIRECT_TOKEN_DF = {
    "0": "_Q", "1": "O", "2": "p8", "3": "~c", "4": "jE", "5z": "8_9", "6": "u", "7": "3G",
    "8": "n", "9": "E", "a": "~K", "b": "i", "c": "W6", "d": "d", "e": "=d", "f": "3E"
};
const TOKEN_DELIMIRATER = "$_$/\n";
const crypto = require("crypto");
const makeRedirectToken = function (authKeyCode, requestTokenKey, type, mail) {
    const len = requestTokenKey.length;
    const signature =
        "~=$_" +
        requestTokenKey.substring(len >> 1) +
        TOKEN_DELIMIRATER +
        type + "=_~!~" +
        requestTokenKey.substring(0, len >> 1) +
        TOKEN_DELIMIRATER +
        mail;
    const token = crypto.createHmac("sha256", authKeyCode)
        .update(signature).digest("hex");
    let ret = "";
    for (let i = 0; i < token.length; i++) {
        ret += REDIRECT_TOKEN_DF[token[i]];
    }
    return ret;
};
// createTokenKey相当(gasAuth.js内部と同じフォーマット)のtokenKeyを生成する.
const makeTokenKey = function (expireMs) {
    const sig = require("../../modules/auth/gasAuthSig.js");
    const rawRand = Buffer.from("0123456789abcdef").toString("base64");
    return sig.cutEndBase64Eq(
        Buffer.from(rawRand + "_" + expireMs.toString(16)).toString("base64")
    );
};

test("gasAuth: getOAuthMail は正しいredirectTokenの場合メールアドレスを返す", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    const tokenKey = makeTokenKey(Date.now() + 60000);
    const mail = "user@example.com";
    const redirectToken = makeRedirectToken(
        process.env[ENV_KEY], tokenKey, "oAuth", mail);
    _request.params = function () {
        return { mail: mail, redirectToken: redirectToken, type: "oAuth", tokenKey: tokenKey };
    };
    assert.equal(gasAuth.getOAuthMail(_request), mail);
});

test("gasAuth: getOAuthMail はmailを差し替えると検証失敗する(403)", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    const tokenKey = makeTokenKey(Date.now() + 60000);
    const redirectToken = makeRedirectToken(
        process.env[ENV_KEY], tokenKey, "oAuth", "original@example.com");
    _request.params = function () {
        return {
            mail: "attacker@example.com",
            redirectToken: redirectToken,
            type: "oAuth",
            tokenKey: tokenKey
        };
    };
    assert.throws(() => {
        gasAuth.getOAuthMail(_request);
    }, (e) => e.status === 403);
});

test("gasAuth: getOAuthMail は期限切れのtokenKeyの場合検証失敗する(403)", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    const mail = "user@example.com";
    const tokenKey = makeTokenKey(Date.now() - 60000);
    const redirectToken = makeRedirectToken(
        process.env[ENV_KEY], tokenKey, "oAuth", mail);
    _request.params = function () {
        return { mail: mail, redirectToken: redirectToken, type: "oAuth", tokenKey: tokenKey };
    };
    assert.throws(() => {
        gasAuth.getOAuthMail(_request);
    }, (e) => e.status === 403);
});

test("gasAuth: getOAuthMail はGAS側でerrorパラメータが返った場合401を投げる", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    _request.params = function () {
        return { error: "access_denied" };
    };
    assert.throws(() => {
        gasAuth.getOAuthMail(_request);
    }, (e) => e.status === 401);
});

test("gasAuth: getOAuthMail はmailが無い場合401を投げる", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    _request.params = function () {
        return {};
    };
    assert.throws(() => {
        gasAuth.getOAuthMail(_request);
    }, (e) => e.status === 401);
});

test("gasAuth: encodeRedirectUrlParams はパラメータをURLエンコードし直す", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    const url = "https://example.com/path?a=1&b=hello world";
    const encoded = gasAuth.encodeRedirectUrlParams(url);
    assert.ok(encoded.indexOf("hello%20world") !== -1 || encoded.indexOf("hello+world") !== -1);
    assert.ok(encoded.startsWith("/path?"));
});

test("gasAuth: encodeRedirectUrlParams はパラメータが無い場合そのまま返す", () => {
    const gasAuth = require("../../modules/auth/gasAuth.js");
    const url = "https://example.com/path";
    assert.equal(gasAuth.encodeRedirectUrlParams(url), url);
});
