///////////////////////////////////////////////
// APIキー / Bearerトークン認証ガードモジュール.
//
// 外部システム連携、Webhook送信元認証、公開API向けに、
// Authorizationヘッダー(Bearer)またはX-Api-Keyヘッダーから
// トークンを抽出し、定数時間比較で安全に検証する.
//
// llrtおよびNode.js完全互換(外部npmパッケージ不使用).
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = typeof $require === "function" ? $require("crypto") : require("crypto");

    // タイミング攻撃対策の安全な文字列比較.
    // 長さの違いによるタイミングリークを防ぐためSHA-256ハッシュを通してから比較する.
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

    // リクエストからAPIキー/トークンを抽出.
    // req: $request() オブジェクト(省略時はグローバル $request() を参照)
    // options: {
    //   headers: ["authorization", "x-api-key"], // 検索するヘッダー(優先順)
    //   allowQuery: false,                       // クエリパラメータを許可するか
    //   queryParam: "apiKey"                     // クエリパラメータ名
    // }
    const extractToken = function (req, options) {
        if (!req && typeof $request === "function") {
            req = $request();
        }
        if (!req) {
            return null;
        }
        options = options || {};
        const headerNames = options.headers || ["authorization", "x-api-key"];

        for (let i = 0; i < headerNames.length; i++) {
            const hName = headerNames[i].toLowerCase();
            const hVal = req.header ? req.header(hName) : (req.headers && req.headers[hName]);
            if (hVal && typeof hVal === "string") {
                let token = hVal.trim();
                if (hName === "authorization") {
                    if (token.toLowerCase().startsWith("bearer ")) {
                        token = token.substring(7).trim();
                    }
                }
                if (token.length > 0) {
                    return token;
                }
            }
        }

        // クエリパラメータからの抽出(許可されている場合)
        if (options.allowQuery) {
            const qName = options.queryParam || "apiKey";
            const qVal = req.query ? req.query(qName) : null;
            if (qVal && typeof qVal === "string" && qVal.trim().length > 0) {
                return qVal.trim();
            }
        }

        return null;
    };

    // トークンを検証.
    // token: 検証対象の文字列
    // validKeys:
    //   - string: 単一のキー
    //   - Array: キーの配列 ["key1", "key2"]
    //   - Object: キーとメタデータのマップ { "key1": { role: "admin" }, ... }
    //   - Function: カスタム検証関数 function(token) => meta or boolean
    // 戻り値: 一致した場合は { valid: true, key: string, meta: any }, 不一致なら null
    const verify = function (token, validKeys) {
        if (!token || typeof token !== "string") {
            return null;
        }

        // 検証関数が渡された場合
        if (typeof validKeys === "function") {
            const res = validKeys(token);
            if (res) {
                return {
                    valid: true,
                    key: token,
                    meta: typeof res === "object" ? res : null
                };
            }
            return null;
        }

        // 単一文字列の場合
        if (typeof validKeys === "string") {
            if (_timingSafeCompare(token, validKeys)) {
                return { valid: true, key: token, meta: null };
            }
            return null;
        }

        // 配列の場合
        if (Array.isArray(validKeys)) {
            let matched = false;
            for (let i = 0; i < validKeys.length; i++) {
                if (typeof validKeys[i] === "string" && _timingSafeCompare(token, validKeys[i])) {
                    matched = true;
                    // タイミング攻撃防止のためループを即breakせず最後まで回すことも考慮できるが、
                    // _timingSafeCompare自体が定数時間比較のためここで返却して安全
                    return { valid: true, key: token, meta: null };
                }
            }
            return null;
        }

        // Object(マップ)の場合
        if (validKeys && typeof validKeys === "object") {
            for (const k in validKeys) {
                if (Object.prototype.hasOwnProperty.call(validKeys, k)) {
                    if (_timingSafeCompare(token, k)) {
                        return {
                            valid: true,
                            key: token,
                            meta: validKeys[k]
                        };
                    }
                }
            }
            return null;
        }

        return null;
    };

    // APIキーガード(エンドポイントで呼び出し).
    // options: {
    //   keys: 有効キー(string | Array | Object | Function)
    //         省略時は process.env.API_KEY または process.env.API_KEYS(カンマ区切り)
    //   autoResponse: true(デフォルト)なら失敗時に自動で401レスポンスを設定
    //   errorMessage: "Unauthorized"
    // }
    // 戻り値: 認証成功時は { valid: true, key, meta }, 失敗時は false(autoResponse有効時)または null
    const guard = function (options) {
        options = options || {};
        let keys = options.keys;

        if (!keys) {
            const envKey = process.env.API_KEY;
            const envKeys = process.env.API_KEYS;
            if (envKeys) {
                keys = envKeys.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            } else if (envKey) {
                keys = envKey;
            }
        }

        if (!keys) {
            console.error("[API_KEY] No valid keys configured for API key guard.");
            if (options.autoResponse !== false && typeof $response === "function") {
                const res = $response();
                res.status(500, "Internal Server Error");
                res.body({ error: "Server Configuration Error", message: "API key guard is not properly configured" });
                return false;
            }
            return null;
        }

        const token = extractToken(options.request, options);
        const result = verify(token, keys);

        if (result && result.valid) {
            return result;
        }

        // 認証失敗時の自動レスポンス
        if (options.autoResponse !== false && typeof $response === "function") {
            const res = $response();
            res.status(401, "Unauthorized");
            res.header("www-authenticate", 'Bearer error="invalid_token"');
            res.body({
                error: "Unauthorized",
                message: options.errorMessage || "Invalid or missing API key"
            });
            return false;
        }

        return null;
    };

    exports.extractToken = extractToken;
    exports.verify = verify;
    exports.guard = guard;
    exports._timingSafeCompare = _timingSafeCompare;
})();
