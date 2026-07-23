// ************************************************************
// modules/auth/mfaKey.js
// modules/auth/mfa.js に渡すkey1/key2をuser/passwordから算出するヘルパー.
// public/auth/mfa/viewMfa.mt.html・authMfaVerify.mt.jsから
// $loadLib("mfaKey.js")で読み込んで利用する。
//
// AIメモ: ローカル実行(tools/webapps.js)の$loadLibはmodules/配下も
// 自動フォールバック検索するためlib/へのスタブ無しでそのまま動くが、
// 実際のLambdaデプロイ(mtpk)ではzipにmodules/という階層は含まれず、
// `mtpk -t auth`(または`-t all`)を実行して modules/auth/ 配下を
// zip内のlib/直下へコピーする必要がある(bin/README.mdの
// 「1. modules デプロイ」参照)。デプロイ時に`-t auth`を忘れると
// このモジュールが本番環境で読み込めなくなるので注意.
// ************************************************************
(function () {
    'use strict';

    const crypto = $require("crypto");

    const sha256 = function (value) {
        return crypto.createHash("sha256").update(value).digest("hex");
    };
    const hmacSHA256 = function (key, message) {
        return crypto.createHmac("sha256", key).update(message).digest("hex");
    };

    // user/passwordからmfa.js用のkey1/key2を算出する.
    // key1: hmacSHA256(user, sha256(password))
    // key2: hmacSHA256(sha256(password), host)
    // user 対象のユーザー名を設定します.
    // password 対象のパスワード(平文)を設定します.
    // host 対象のホスト名(request.header("host"))を設定します.
    // 戻り値: {key1, key2}
    exports.compute = function (user, password, host) {
        const passHash = sha256(password);
        return {
            key1: hmacSHA256(user, passHash),
            key2: hmacSHA256(passHash, host)
        };
    };

    // host名に対するprotocolを取得する.
    // AIメモ: modules/auth/gasAuth.jsの同名ロジック(非export)と同じ実装。
    // 現状2箇所に重複しているが、小さなユーティリティのため許容している.
    // host 対象のホスト名を設定します.
    // 戻り値: protocolが返却されます.
    exports.getHttpProtocol = function (host) {
        host = host.trim().toLowerCase();
        if (!(host == "127.0.0.1" || host.startsWith("127.0.0.1:") ||
            host == "localhost" || host.startsWith("localhost:"))) {
            let c;
            const len = host.length;
            for (let i = 0; i < len; i++) {
                c = host.charAt(i);
                if (!((c >= '0' && c <= '9') || c == '.' || c == ':')) {
                    return "https://";
                }
            }
        }
        return "http://";
    };
})();
