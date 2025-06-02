// (node専用)minto をローカルでテストするための環境.
//

// webApp実装＋実行.
(function (_g) {
    'use strict';

    // mintoメイン.
    const mintoLambdaIndex = require("../lambda/src/index.js");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

    // jhtml.
    const jhtml = require("./jhtml.js");

    // サーバータイムアウト(30秒).
    const TIMEOUT = 30 * 1000;

    // keep-alive タイムアウト(2.5秒).
    const KEEP_ALIVE_TIMEOUT = 2500;

    // デフォルトサーバーバインドポート.
    const _DEF_BIND_PORT = 3210;

    // Body最大バイト数(1MB).
    const _MAX_BODY_LENGTH = 0x100000;

    // Webサーバ名.
    const _SERVER_NAME = "minto";

    // メインパス.
    let mainPath = null;

    // conf/minto.json.
    let mintoConf = null;

    // bindPort.
    let bindPort = null;

    // このファイルが存在するディレクトリ.
    // __dirname と同じ.
    const _DIR_NAME = (function () {
        // MINTO_HOMEの環境変数を対象とする.
        let ret = process.env["MINTO_HOME"];
        if (ret != undefined) {
            if (!ret.endsWith("/")) {
                ret += "/";
            }
            return ret + "tools/";
        }
        throw new Error("The MINTO_HOME environment variable is not set.");
        // 環境変数が存在しない場合は、requireから取得.
        //return mintoUtil.getRequireResolvePath(require.resolve("./")) + "/";
    })();

    // lambdaライブラリ.
    const _LAMBDA_LIB_PATH = _DIR_NAME + "../lambda/src/lib/"

    // [書き換え]$loadLib処理.
    // name: 対象のJSファイル等を設定します.
    // 戻り値: require結果が返却されます.
    _g.$loadLib = function (name) {
        name = ("" + name).trim();
        if (name[0] == "/") {
            name = name.substring(1)
        }
        // lambda.lib 内容を参照.
        let libPath = _LAMBDA_LIB_PATH + name;
        if (mintoUtil.existsSync(libPath)) {
            return require(libPath);
        }
        // currentディレクトリの lib 配下.
        return require(mainPath + "lib/" + name);
    }

    // lambdaコンフィグ.
    const _LAMBDA_CONF_PATH = _DIR_NAME + "../lambda/src/conf/"

    // [書き換え]$loadConf処理.
    // name: 対象のjsonファイル等を設定します.
    // 戻り値: require結果が返却されます.
    _g.$loadConf = function (name) {
        name = ("" + name).trim();
        if (name[0] == "/") {
            name = name.substring(1)
        }
        // lambda.conf 内容を参照.
        let confPath = _LAMBDA_CONF_PATH + name;
        if (mintoUtil.existsSync(confPath)) {
            return require(confPath);
        }
        // currentディレクトリの conf 配下.
        confPath = mainPath + "conf/" + name;
        if (mintoUtil.existsSync(confPath)) {
            return require(confPath);
        }
        return null;
    }

    // スタートアップ処理.
    // path メインパスを設定します.
    // port bindPortを設定します.
    // conf conf/minto.json の内容を設定します. 
    exports.startup = function (path, port, conf) {
        // 初期化処理.
        _setMainPath(path, conf);
        _initMintoLambdaMain();
        // バインドポートをセット.
        if (port == undefined || port == null) {
            port = _DEF_BIND_PORT;
        }
        bindPort = port;

        // サーバー生成.
        var server = require("http")
            .createServer(function (req, res) {
                // 全requireキャッシュのクリア
                // (ローカルはテスト実行なので毎回削除).
                _clearRequireCache();
                // httpRequestを受信処理.
                _runMintoLambda(req, res);
            }
            );

        // タイムアウトセット.
        server.setTimeout(TIMEOUT);

        // [HTTP]キープアライブタイムアウトをセット.
        server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;

        // maxHeadersCountはゼロにセット.
        server.maxHeadersCount = 0;

        // http.socketオプションを設定.
        server.setMaxListeners(0);
        server.on("connection", function (socket) {
            // Nagle アルゴリズムを使用する.
            socket.setNoDelay(true);
            // tcp keepAliveを不許可.
            socket.setKeepAlive(false, 0);
        });

        // 指定ポートで待つ.
        // ※ "0.0.0.0" を入れないと `tcp6` となり
        //    http://localhost:{bindPort}/ で
        //    アクセスできないので注意.
        server.listen(bindPort, "0.0.0.0");

        // 起動結果をログ出力.
        console.debug("## listen: " + bindPort +
            " pid:" + process.pid);
    }

    // メインパスを設定.
    const _setMainPath = function (path, conf) {
        path = path.trim();
        if (!path.endsWith("/")) {
            path += "/"
        }
        mainPath = path;
        if (conf == undefined) {
            conf = {};
        }
        mintoConf = conf;
    }

    // lambda 実行の mintoLambdaIndex を初期化.
    const _initMintoLambdaMain = function () {
        // 基本パスを設定.
        mintoLambdaIndex.setBasePath(mainPath);
        // jhtmlを直接変換する場合設定.
        mintoLambdaIndex.setJHTMLConvFunc(jhtml.convert);
    }

    // requireキャッシュ解除.
    const _clearRequireCache = function () {
        // 通常requireキャッシュ削除.
        const cache = require.cache;
        // llrtの場合cacheは存在しない.
        if (cache != undefined) {
            for (let k in cache) {
                delete cache[k];
            }
        }
        // lambda.index のキャッシュクリア.
        mintoLambdaIndex.clearCacle();
    }

    // (http)mintoLambda実行処理.
    // req 対象のリクエストオブジェクトが設定されます.
    // res 対象のレスポンスオブジェクトが設定されます.
    const _runMintoLambda = function (req, res) {
        // イベント11超えでメモリーリーク警告が出るので
        // これを排除.
        req.setMaxListeners(0);
        res.setMaxListeners(0);
        const method = req.method.toUpperCase()
        // requestされたpostデータのダウンロード.
        if (method == "POST") {
            // コンテンツ長が設定されている場合.
            if (req.headers["content-length"]) {
                let off = 0;
                let body = Buffer.allocUnsafe(
                    req.headers["content-length"] | 0);
                // データ取得.
                const dataCall = function (bin) {
                    bin.copy(body, off);
                    off += bin.length;
                };
                // データ取得終了.
                const endCall = function () {
                    cleanup();
                    // mintoMainを実行.
                    _runLambdaIndex(req, res, body);
                }
                // エラー終了.
                const errCall = function (e) {
                    cleanup();
                    console.warn(e);
                }
                // クリーンアップ.
                const cleanup = function () {
                    req.removeListener('data', dataCall);
                    req.removeListener('end', endCall);
                    req.removeListener('error', errCall);
                }
                // リクエストイベントセット.
                req.on('data', dataCall);
                req.once('end', endCall);
                req.once('error', errCall);
            } else {
                // コンテンツ長が設定されていない場合.
                let list = [];
                let binLen = 0;
                // データ取得.
                const dataCall = function (bin) {
                    list.push(bin);
                    binLen += bin.length;
                };
                // データ取得終了.
                const endCall = function () {
                    cleanup();
                    let n = null;
                    let off = 0;
                    let body = Buffer.allocUnsafe(binLen);
                    binLen = null;
                    const len = buf.length;
                    // 取得内容を統合.
                    for (let i = 0; i < len; i++) {
                        n = list[i];
                        n.copy(body, off);
                        list[i] = null;
                        off += n.length;
                    }
                    list = null;
                    // mintoMainを実行.
                    _runLambdaIndex(req, res, body);
                }
                // エラー終了.
                const errCall = function (e) {
                    cleanup();
                    console.warn(e);
                }
                // クリーンアップ.
                const cleanup = function () {
                    req.removeListener('data', dataCall);
                    req.removeListener('end', endCall);
                    req.removeListener('error', errCall);
                }
                // リクエストイベントセット.
                req.on('data', dataCall);
                req.once('end', endCall);
                req.once('error', errCall);
            }
            // GET処理.
        } else {
            // mintoMainを実行.
            _runLambdaIndex(req, res, null);
        }
    }

    // lambdaIndexを実行.
    // req Httpリクエストを設定します.
    // res Httpレスポンスを設定します.
    // body HttpリクエストBodyが存在する場合設定します.
    const _runLambdaIndex = async function (req, res, body) {
        try {
            // mintoMainLambda実行処理.
            const result = await mintoLambdaIndex.handler(
                _getEvent(req, body));
            // mintoMainLambdaから返却された内容をresponse.
            _resultMinto(res, result);
        } catch (err) {
            try {
                // エラー送信.
                _sendError(res, 500, {}, err);
            } catch (e) {
                console.warn(e);
            }
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
        headers['access-control-allow-origin'] = "*";
        headers['access-control-allow-headers'] = "*";
        headers['access-control-allow-methods'] = "GET, POST";
    }

    // デフォルトレスポンスヘッダをセット.
    // headers 対象のHTTPヘッダ(Object型)を設定します.
    // 戻り値: Objectが返却されます.
    const _setDefaultResponseHeader = function (headers) {
        // キャッシュなし返却.
        _setNoneCacheHeader(headers);

        // cros許可条件を取得.
        let cros = mintoConf["cros"];
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

    // cookie情報を設定.
    const _setEventCookie = function (event, cookies) {
        if (cookies == undefined) {
            return;
        }
        const list = cookies.split(";");
        const len = list.length;
        for (let i = 0; i < len; i++) {
            event.cookies[i] = list[i].trim();
        }
    }

    // LFUのイベントを作成.
    // req Httpリクエストオブジェクトを設定します.
    // 戻り値: Lfuイベントが返却されます.
    const _getEvent = function (req, body) {
        const path = _getUrlPath(req);
        const ip = _getIp(req);
        const now = new Date();
        // LambdaFunctionUrlsに渡す
        // 基本イベントをセット(version 2.0).
        const event = {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": path,
            "rawQueryString": "",
            "isBase64Encoded": false,
            "headers": {
                "x-amzn-trace-id": "$id",
                "x-forwarded-proto": "http",
                "x-forwarded-port": "" + bindPort,
                "x-forwarded-for": ip,
                "accept": "*/*"
            },
            "cookies": [
            ],
            "queryStringParameters": {},
            "requestContext": {
                "accountId": "anonymous",
                "apiId": "$id",
                "domainName": "$domainName",
                "domainPrefix": "$domainPrefix",
                "http": {
                    "method": req.method.toUpperCase(),
                    "path": path,
                    "protocol": req.protocol,
                    "sourceIp": ip,
                    "userAgent": req.headers["user-agent"]
                },
                "requestId": "" + now.getTime(),
                "routeKey": "$default",
                "stage": "$default",
                "time": now.toISOString(),
                "timeEpoch": now.getTime()
            }
        };
        // httpヘッダをセット.
        let headers = req.headers;
        // cookieヘッダを取得.
        let cookie = headers.cookie;
        // cookieヘッダを削除.
        delete headers.cookie;
        for (let k in headers) {
            event.headers[k.toLowerCase()] = headers[k];
        }
        // cookieヘッダをEventにセット.
        _setEventCookie(event, cookie);
        cookie = null;
        // getパラメータを取得.
        event.rawQueryString = _getQueryParams(req);
        if (event.rawQueryString.length > 0) {
            // getパラメータを解析.
            event.queryStringParameters =
                _analysisParams(event.rawQueryString);
        }
        // bodyが存在する場合.
        if (body != undefined && body != null) {
            // bodyをセット(base64).
            event.body = body.toString("base64");
            event.isBase64Encoded = true;
        }
        return event;
    }

    // minto(lambda index.js)で返却されたresult内容を送信.
    // res Httpレスポンスを設定します.
    // result index.jsで返却されたresultを設定します.
    const _resultMinto = function (res, result) {
        // result = {
        //   statusCode: number,
        //   statusMessage: string,
        //   headers: Object,
        //   cookies: List,
        //   isBase64Encoded: boolean,
        //   body: buffer or string
        // }

        // base64で格納されている場合.
        if (result.isBase64Encoded == true) {
            // base64をデコードする.
            result.body = Buffer.from(
                result.body, "base64");
            result.isBase64Encoded = false;
        } else if (typeof (result.body) == "string") {
            // 文字列をバイナリ変換.
            result.body = Buffer.from(result.body);
        }
        // bodyバイナリ長が 1MB を超えた場合.
        if (result.body.length >= _MAX_BODY_LENGTH) {
            // Body制限エラーを返却.
            _sendResponse(res, 500, "The response body exceeds 1MB.",
                { "content-type": "text/plain" }, {},
                "The response body exceeds 1MB.");
            return;
        }
        // 送信処理.
        _sendResponse(res, result.statusCode,
            result.statusMessage, result.headers,
            result.cookies, result.body);
    }

    // レスポンス返却.
    // res 対象のHTTPレスポンスオブジェクトが設定されます.
    // status Httpステータスが設定されます.
    // message Httpステータスメッセージが設定されます.
    //         undefined or null の場合は設定されていません.
    // headers Httpヘッダが設定されます.
    // cookies HttpCookieが設定されます.
    // body 対象のBodyが設定されます.
    const _sendResponse = function (
        res, status, message, headers, cookies, body) {
        // content-lengthが存在しない場合.
        // chunkeed送信でない場合.
        if (headers["content-length"] == undefined &&
            headers["transfer-encoding"] != "chunked") {
            headers["content-length"] = Buffer.byteLength(body);
        }
        // 必要な内容をセット.
        headers["server"] = _SERVER_NAME;
        headers["date"] = new Date().toISOString();
        // cookieが存在する場合.
        if (Array.isArray(cookies) && cookies.length > 0) {
            // set-cookieをセット.
            const len = cookies.length;
            for (let i = 0; i < len; i++) {
                headers["set-cookie"] = cookies[i];
            }
        }
        // 書き込み処理.
        if (typeof (message) == "string") {
            res.writeHead(status, message,
                _setDefaultResponseHeader(headers));
        } else {
            res.writeHead(status,
                _setDefaultResponseHeader(headers));
        }
        res.end(body);
    }

    // エラー送信.
    // res 対象のHTTPレスポンスオブジェクトが設定されます.
    // status Httpステータスが設定されます.
    // headers Httpヘッダが設定されます.
    // err 例外オブジェクトを設定します.
    const _sendError = function (res, status, headers, err) {
        try {
            if (status >= 500) {
                console.error("sendError: ", err);
            }
            // text返却.
            headers["content-type"] = "text/plain";
            // 送信処理.
            _sendResponse(res, status, undefined,
                headers, undefined, "error " + status);
        } catch (e) {
            // 例外発生はwarn.
            console.warn(
                "error send internal error:", e);
            // レスポンスソケットクローズ.
            try {
                res.socket.destroy();
            } catch (ee) { }
        }
    }

})(global);
