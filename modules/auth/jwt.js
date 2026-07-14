///////////////////////////////////////////////
// JWT(JSON Web Token) 署名/検証ユーティリティ(HS256のみ).
//
// llrtでは node.js標準の crypto.createSign/createVerify や
// publicEncrypt/privateDecrypt がサポートされていない(RS256等の
// 公開鍵方式は非対応)ため、共通鍵によるHMAC-SHA256(HS256)のみを
// サポートする. modules/auth/password.js と同様 crypto.createHmac
// のみを使って自前実装している.
//
// 検証するクレームは exp(有効期限) のみ. iss/aud等の検証は
// 呼び出し側で payload を見て個別に行うこと.
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = $require("crypto");

    // 署名アルゴリズム(HMAC).
    const _HASH_ALGO = "sha256";

    // JWTヘッダー(固定).
    const _HEADER_JSON = JSON.stringify({ alg: "HS256", typ: "JWT" });

    // Base64URLエンコード(パディング無し、+/ を -_ に置換).
    // buf Bufferまたは文字列を設定します.
    // 戻り値: base64url文字列が返却されます.
    const _base64urlEncode = function (buf) {
        if (typeof buf === "string") {
            buf = Buffer.from(buf, "utf-8");
        }
        return buf.toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    };

    // Base64URLデコード.
    // str base64url文字列を設定します.
    // 戻り値: デコード結果のBufferが返却されます.
    const _base64urlDecode = function (str) {
        str = str.replace(/-/g, "+").replace(/_/g, "/");
        const pad = str.length % 4;
        if (pad === 2) {
            str += "==";
        } else if (pad === 3) {
            str += "=";
        } else if (pad !== 0) {
            throw new Error("Invalid base64url string.");
        }
        return Buffer.from(str, "base64");
    };

    // タイミング攻撃を避けるための定数時間文字列比較.
    // a 比較対象の文字列を設定します.
    // b 比較対象の文字列を設定します.
    // 戻り値: 一致する場合true.
    const _timingSafeEqual = function (a, b) {
        if (typeof a != "string" || typeof b != "string" ||
            a.length != b.length) {
            return false;
        }
        let diff = 0;
        const len = a.length;
        for (let i = 0; i < len; i++) {
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
    };

    // header.payload に対するHMAC-SHA256署名(base64url)を生成.
    const _sign = function (headerPayload, secret) {
        return _base64urlEncode(
            crypto.createHmac(_HASH_ALGO, secret).update(headerPayload).digest()
        );
    };

    // JWTトークンを生成.
    // payload トークンに含めるクレーム(JSオブジェクト)を設定します.
    //         exp/iatはこの関数側で自動付与するため、呼び出し側では
    //         設定しないこと(設定した場合はexpiresInの計算結果で上書きされる).
    // secret 署名用の共通鍵(文字列)を設定します.
    // options 任意のオプションを設定します.
    //         expiresIn: 有効期限(秒)を設定します(必須。呼び出し側で
    //                    用途に応じた値を明示的に指定すること).
    // 戻り値: JWTトークン文字列が返却されます.
    exports.sign = function (payload, secret, options) {
        if (options == undefined || options.expiresIn == undefined) {
            throw new Error("options.expiresIn is required.");
        }
        const expiresIn = parseInt(options.expiresIn);
        if (isNaN(expiresIn) || expiresIn <= 0) {
            throw new Error("options.expiresIn must be a positive number(seconds).");
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const body = Object.assign({}, payload, {
            iat: nowSec,
            exp: nowSec + expiresIn
        });
        const headerPayload = _base64urlEncode(_HEADER_JSON) +
            "." + _base64urlEncode(JSON.stringify(body));
        return headerPayload + "." + _sign(headerPayload, secret);
    };

    // JWTトークンを検証.
    // token 検証対象のトークン文字列を設定します.
    // secret 署名検証用の共通鍵(文字列)を設定します(sign時と同じ値).
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    // 戻り値: 検証成功時はpayload(JSオブジェクト)が返却されます.
    //         署名不一致・exp切れ・フォーマット不正の場合はnull
    //         (options.noError == false の場合は例外throw).
    exports.verify = function (token, secret, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            if (typeof token != "string") {
                throw new Error("token must be a string.");
            }
            const parts = token.split(".");
            if (parts.length != 3) {
                throw new Error("Invalid JWT format.");
            }
            const headerPayload = parts[0] + "." + parts[1];
            const expectSign = _sign(headerPayload, secret);
            if (!_timingSafeEqual(expectSign, parts[2])) {
                throw new Error("JWT signature mismatch.");
            }
            const payload = JSON.parse(_base64urlDecode(parts[1]).toString("utf-8"));
            if (payload.exp != undefined) {
                const nowSec = Math.floor(Date.now() / 1000);
                if (nowSec >= payload.exp) {
                    throw new Error("JWT expired.");
                }
            }
            return payload;
        } catch (e) {
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    };
})();
