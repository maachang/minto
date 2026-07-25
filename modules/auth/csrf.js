///////////////////////////////////////////////
// CSRF対策共通ヘルパー.
//
// public/*.mt.js から呼び出して利用する.
// session.js が発行するセッションID(Cookie)にHMAC-SHA256で
// トークンを紐づける、ステートレス方式(トークン自体をS3等に
// 別途保存しない)。ヘッダー方式(X-CSRF-Token)での検証を想定する.
//
// AIメモ:
// - トークンは「セッションID」を秘密鍵(環境変数CSRF_SECRET)で
//   HMAC-SHA256署名した値。session.js側にトークン保存用の変更を
//   加える必要が無く、generateToken()/verify()どちらも都度
//   セッションIDから再計算するだけで完結する.
// - セッションが存在しない(未ログイン)状態でのCSRF検証は意味が
//   無いため、generateToken()はセッション無しの場合null、
//   verify()はセッション無しの場合は必ずfalseを返す.
// - llrtのcrypto.createHmacのみを使用(password.jsと同様の理由。
//   pbkdf2/scrypt等は未サポートのため。詳細はpassword.js参照)。
//   タイミング攻撃対策の定数時間比較もpassword.jsに倣い、
//   crypto.timingSafeEqualではなく自前のXOR比較を用いる.
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = $require("crypto");

    // [環境変数]CSRFトークン署名用シークレット.
    const _SECRET_ENV = "CSRF_SECRET";
    const _getSecret = function () {
        const ret = process.env[_SECRET_ENV];
        if (ret == undefined || ret == null || ret === "") {
            // デフォルトシークレット(本番運用では必ず環境変数を設定すること).
            return "minto-default-csrf-secret";
        }
        return ret;
    };

    // [環境変数]CSRF検証用リクエストヘッダー名.
    const _HEADER_NAME_ENV = "CSRF_HEADER_NAME";
    const _getHeaderName = function () {
        const ret = process.env[_HEADER_NAME_ENV];
        if (ret == undefined || ret == null || ret === "") {
            return "x-csrf-token";
        }
        return ret;
    };

    // [環境変数]セッションCookie名(session.jsと同じ解決ロジック).
    const _COOKIE_SESSION_NAME_ENV = "MINTO_COOKIE_SESSION_NAME";
    const _getSid = function () {
        const req = $request();
        const name = process.env[_COOKIE_SESSION_NAME_ENV] || "minto_sid";
        return req.cookie(name);
    };

    // セッションIDからHMAC-SHA256でトークン(hex文字列)を算出.
    const _computeToken = function (sid) {
        return crypto.createHmac("sha256", _getSecret())
            .update(sid).digest("hex");
    };

    // タイミング攻撃を避けるための定数時間文字列比較.
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

    // 現在のセッションに紐づくCSRFトークンを算出します.
    // 戻り値: トークン文字列(hex)。未ログイン(セッション無し)の
    //         場合はnull.
    exports.generateToken = function () {
        const sid = _getSid();
        if (sid == null || sid === "") {
            return null;
        }
        return _computeToken(sid);
    };

    // リクエストヘッダー(デフォルト X-CSRF-Token)のトークンを
    // 検証します.
    // 戻り値: 検証成功時true。未ログイン・ヘッダー無し・不一致の
    //         いずれもfalse.
    exports.verify = function () {
        const sid = _getSid();
        if (sid == null || sid === "") {
            return false;
        }
        const req = $request();
        const token = req.header(_getHeaderName());
        if (token == null || token === "") {
            return false;
        }
        const expected = _computeToken(sid);
        return _timingSafeEqual(token, expected);
    };
})();
