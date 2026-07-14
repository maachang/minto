///////////////////////////////////////////////
// CORS共通ヘルパー.
//
// public/filter.mt.js から呼び出して利用する.
//
// 注意: mintoのfilter仕様上、true返却時は対象の
// 動的コンテンツ(mt.js等)の処理が続行される.
// そのためOPTIONSプリフライトの場合でも、本モジュール
// だけでは実際のハンドラ処理の実行を止められない.
// 必要な場合は呼び出し側(filter.mt.js)で
// req.method() === "OPTIONS" の分岐を追加すること.
///////////////////////////////////////////////
(function () {
    'use strict';

    // デフォルト許可メソッド.
    const _DEFAULT_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

    // デフォルト許可ヘッダー.
    const _DEFAULT_HEADERS = "Content-Type, Authorization";

    // CORSヘッダーを$response()に設定します.
    // options.origins 許可オリジンを設定します(必須).
    //                  "*" または 許可オリジンの配列(string[]).
    // options.methods 許可メソッドを設定します(省略時デフォルト).
    // options.headers 許可ヘッダーを設定します(省略時デフォルト).
    // options.credentials true を設定した場合
    //         Access-Control-Allow-Credentials: true を設定します.
    // 戻り値: リクエストのOriginが許可された場合true.
    //         Originヘッダーが無い場合(同一オリジン等)もtrue.
    //         許可されていないOriginの場合はfalse.
    exports.apply = function (options) {
        options = options || {};
        const req = $request();
        const res = $response();
        const origin = req.header("origin");

        // Originヘッダーが無い場合は対象外(素通り).
        if (origin == null || origin === "") {
            return true;
        }

        const allow = options.origins;
        let allowOrigin = null;
        if (allow === "*") {
            allowOrigin = "*";
        } else if (Array.isArray(allow)) {
            const len = allow.length;
            for (let i = 0; i < len; i++) {
                if (allow[i] === origin) {
                    allowOrigin = origin;
                    break;
                }
            }
        }

        // 許可されていないOriginの場合.
        if (allowOrigin == null) {
            return false;
        }

        res.header("access-control-allow-origin", allowOrigin);
        res.header("access-control-allow-methods",
            options.methods || _DEFAULT_METHODS);
        res.header("access-control-allow-headers",
            options.headers || _DEFAULT_HEADERS);
        if (options.credentials === true) {
            res.header("access-control-allow-credentials", "true");
        }
        return true;
    };
})();
