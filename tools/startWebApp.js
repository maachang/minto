// minto をローカルでテストするための環境.
//

// webApp実装＋実行.
(function () {
    'use strict';

    // サーバータイムアウト(30秒).
    const TIMEOUT = 30 * 1000;

    // keep-alive タイムアウト(2.5秒).
    const KEEP_ALIVE_TIMEOUT = 2500;

    // bindPort.
    let bindPort = null;

    // requireキャッシュ解除.
    const _clearRequireCache = function () {
        // 通常requireキャッシュ削除.
        const cache = require.cache;
        for (let k in cache) {
            delete cache[k];
        }
    }

    // queryパラメータを取得.
    // req HTTPリクエストを設定します.
    // 戻り値: queryパラメータが返却されます.
    const _getQueryParams = function (req) {
        const u = req.url;
        const p = u.indexOf("?");
        if (p == -1) {
            return "";
        }
        return u.substring(p + 1);
    }

    // パラメータ解析.
    const _analysisParams = function (n) {
        let list = n.split("&");
        const len = list.length;
        const ret = {};
        for (let i = 0; i < len; i++) {
            n = list[i].split("=");
            if (n.length == 1) {
                ret[n[0]] = '';
            } else {
                ret[n[0]] = decodeURIComponent(n[1]);
            }
        }
        return ret;
    }

    // 接続先ipアドレスを取得.
    // request HTTPリクエストを設定します.
    // 戻り値: 接続先IPアドレスが返却されます.
    const _getIp = function (request) {
        return request.headers['x-forwarded-for']
            ? request.headers['x-forwarded-for']
            : (request.connection && request.connection.remoteAddress)
                ? request.connection.remoteAddress
                : (request.connection.socket && request.connection.socket.remoteAddress)
                    ? request.connection.socket.remoteAddress
                    : (request.socket && request.socket.remoteAddress)
                        ? request.socket.remoteAddress
                        : '0.0.0.0';
    }

    // URLパスを取得.
    // req 対象のrequestを設定します.
    // 戻り値: URLパスが返却されます.
    var _getUrlPath = function (req) {
        var u = req.url;
        var p = u.indexOf("?");
        if (p == -1) {
            return u;
        }
        return u.substring(0, p);
    }

    // HTTPヘッダにNoCacheをセット.
    // headers 対象のHTTPヘッダ(Object型)を設定します.
    // 戻り値: Objectが返却されます.
    const _setNoneCacheHeader = function (headers) {
        // キャッシュ条件が設定されている場合.
        if (headers["last-modified"] != undefined ||
            headers["etag"] != undefined) {
            return;
        }
        // HTTPレスポンスキャッシュ系のコントロールが設定されていない
        // 場合にキャッシュなしを設定する.
        if (headers["cache-control"] == undefined) {
            headers["cache-control"] = "no-cache";
        }
        if (headers["pragma"] == undefined) {
            headers["pragma"] = "no-cache";
        }
        if (headers["expires"] == undefined) {
            headers["expires"] = "-1";
        }
    }

    // クロスヘッダをセット.
    // headers 対象のHTTPヘッダ(Object型)を設定します.
    // 戻り値: Objectが返却されます.
    const _setCrosHeader = function (headers) {
        headers['access-control-allow-origin'] = '*';
        headers['access-control-allow-headers'] = '*';
        headers['access-control-allow-methods'] = 'GET, POST';
    }

    // デフォルトレスポンスヘッダをセット.
    // conf 対象のstartWebConfを設定します.
    // headers 対象のHTTPヘッダ(Object型)を設定します.
    // 戻り値: Objectが返却されます.
    const _setDefaultResponseHeader = function (conf, headers) {
        // キャッシュなし返却.
        _setNoneCacheHeader(headers);

        // cros許可条件を取得.
        let cros = conf["cros"];
        if (cros == undefined || cros == null) {
            cros = "false";
        } else {
            cros = cros.trim().toLowerCase();
        }
        // cros許可.
        if (cros == "true") {
            // cros返却.
            _setCrosHeader(headers);
        }
        return headers;
    }




})();