//////////////////////////////////////////////////////////
// lambda main.
//////////////////////////////////////////////////////////
(function (_g) {
    'use strict';

    // 初期化条件.
    let _event = null;
    let _c_request = null;
    let _c_response = null;
    let _c_mime = null;
    let _c_etag = null;

    // 実行対象拡張子(js).
    const _RUN_JS = ".mt.js";
    // 実行対象拡張子(jhtml-js).
    const _RUN_JHTML = ".jhtml.js";
    // jhtml(変換前)拡張子.
    const _JHTML_SRC_EXTENSION = ".mt.html";

    // mime追加定義.
    const _MIME_CONF = "mime.json";

    // etags.conf.
    const _ETAGS_CONF_FILE = "etags.json";

    // mtpkでコンテンツがgzip化されてる拡張子.
    const _PUBLIC_CONTENTS_GZ = ".gz";

    // lambda main.
    exports.handler = async function (event) {
        // イベント11超えでメモリーリーク対応.警告が出るのでこれを排除.
        require("events").EventEmitter.defaultMaxListeners = 0;
        // 初期化処理.
        _event = event;
        _c_request = null;
        _c_response = null;
        // ファイル拡張子を取得.
        const ext = _extends(event.rawPath);
        // 指定実行対象の末尾が[/filter]パスの場合.
        // .mt.js や .jhtml.js も直接指定はエラー.
        if (isFilterPath(event.rawPath) || isMintoJs(event.rawPath)) {
            // 直接パス実行出来ない: 403エラー.
            return _errorStaticResult(403, ext);
        }
        // filter実行.
        let resultFilter = true;
        // フィルターパスが存在する場合.
        if (_existsSync(_FILTER_PATH())) {
            // フィルタ実行.
            resultFilter = await _runFilter(ext);
        }
        // filter実行を通過した場合 or filterなし.
        if (resultFilter == true) {
            // 静的ファイルの場合.
            if (ext != "jhtml" && ext != "") {
                // 静的ファイルの返却.
                return await _responseStaticFile(
                    event.rawPath, ext);
            }
            // 動的ファイル処理.
            // 動的ファイルの実行.
            return await _responseRunJs(
                event.rawPath, ext);
        }
        // filter返却.
        return resultFilter;
    }

    // [default]Baseパス名.
    const _BASE_PATH = require("path").resolve() + "/";
    let _basePath = _BASE_PATH;

    // baseパスを設定.
    // basePath 対象のbaseパスを設定します.
    exports.setBasePath = function (basePath) {
        _basePath = _basePath.trim();
        if (basePath.endsWith("/")) {
            _basePath = basePath;
        } else {
            _basePath = basePath + "/";
        }
    }

    // publicパス名.
    const _PUBLIC_PATH = function () {
        return _basePath + "public/";
    }
    // libraryパス名.
    const _LIBRARY_PATH = function () {
        return _basePath + "lib/";
    }
    // confパス名.
    const _CONF_PATH = function () {
        return _basePath + "conf/";
    }
    // filter名と実行パス.
    const _FILTER_NAME = "filter";
    const _FILTER_FILE = _FILTER_NAME + _RUN_JS;
    const _FILTER_PATH = function () {
        return _PUBLIC_PATH() + _FILTER_FILE;
    }

    // jhtml変換実行Function.
    // jhtmlをこのindex.js 内で処理する場合に変換処理
    //  > jhtml.convert
    // を設定します.
    let _jhtmlConvFunc = null;
    exports.setJHTMLConvFunc = function (func) {
        if (typeof (func) == "function") {
            _jhtmlConvFunc = func;
        }
    }

    // キャッシュ関連情報をクリア(local実行専用).
    exports.clearCacle = function () {
        _event = null;
        _c_request = null;
        _c_response = null;
        _c_mime = null;
        _c_etag = null;
    }

    // ライブラリをロード処理.
    // name: 対象のJSファイル等を設定します.
    // 戻り値: require結果が返却されます.
    _g.$loadLib = function (name) {
        name = ("" + name).trim();
        if (name[0] == "/") {
            name = name.substring(1)
        }
        // "/lib" 以下のファイルを require.
        return require(_LIBRARY_PATH() + name)
    }

    // コンフィグJSONをロード処理.
    // name: 対象のjsonファイル等を設定します.
    // 戻り値: require結果が返却されます.
    _g.$loadConf = function (name) {
        name = ("" + name).trim();
        if (name[0] == "/") {
            name = name.substring(1)
        }
        if (_existsSync(_CONF_PATH() + name)) {
            // "/conf" 以下のファイルを require.
            return require(_CONF_PATH() + name)
        }
        return null;
    }

    // requireの代替え対応.
    // 基本 mt.jsや jhtml.js の場合、require が利用できない.
    // そのための代替え手段として $require を利用する.
    // name: requireで設定する文字列を設定します.
    // 戻り値: require結果が返却されます.
    _g.$require = function (name) {
        return require(name);
    }

    // requestを取得.
    // 戻り値: request情報が返却されます.
    _g.$request = function () {
        if (_c_request == null) {
            _createRequest(_event);
        }
        return _c_request;
    }

    // responseを取得.
    // 戻り値: response情報が返却されます.
    _g.$response = function () {
        if (_c_response == null) {
            _createResponse();
        }
        return _c_response;
    }

    // 指定拡張子からmimeTypeを取得.
    // ext ファイルの拡張子を設定します.
    // all true の場合 mimeの定義全体を取得します.
    // 戻り値: mimeTypeおよびmime定義が返却されます.
    //         all == true で存在しない場合は null 返却.
    _g.$mime = function (ext, all) {
        const ret = _getMime(ext);
        // mime定義全体を取得の場合.
        if (all == true) {
            if (ret == undefined) {
                return null;
            }
            return ret;
        }
        // mimeTypeのみ取得の場合.
        if (ret == undefined) {
            return _OCTET_STREAM;
        }
        return ret.type;
    }

    // local file i/o.
    const fs = require("fs");

    // mime(最低限).
    const _MIME = {
        /** プレーンテキスト. **/
        txt: { type: "text/plain", gz: true }
        /** HTML. **/
        , htm: { type: "text/html", gz: true }
        /** HTML. **/
        , html: { type: "text/html", gz: true }
        /** XHTML. **/
        , xhtml: { type: "application/xhtml+xml", gz: true }
        /** XML. **/
        , xml: { type: "text/xml", gz: true }
        /** JSON. */
        , json: { type: "application/json", gz: true }
        /** stylesheet. */
        , css: { type: "text/css", gz: true }
        /** javascript. */
        , js: { type: "text/javascript", gz: true }
        /** gif. */
        , gif: { type: "image/gif", gz: false }
        /** jpeg. */
        , jpg: { type: "image/jpeg", gz: false }
        /** jpeg. */
        , jpeg: { type: "image/jpeg", gz: false }
        /** png. */
        , png: { type: "image/png", gz: false }
        /** ico. */
        , ico: { type: "image/vnd.microsoft.icon", gz: false }
    }

    // [mimeType]octet-stream.
    const _OCTET_STREAM = "application/octet-stream";

    // 対象拡張子のMimeTypeを取得.
    const _getMime = function (ext) {
        let mime = _MIME[ext];
        if (mime == undefined) {
            if (_c_mime == null) {
                _c_mime = _g.$loadConf(_MIME_CONF);
                if (_c_mime == null) {
                    _c_mime = {};
                }
            }
            return _c_mime[ext];
        }
        return mime;
    }

    // フィルターパス(/public/filter)が設定されている場合.
    const isFilterPath = function (path) {
        if (path.endsWith("/" + _FILTER_NAME)) {
            return true;
        }
        return false;
    }

    // minto系実行プログラムが設定されている場合.
    const isMintoJs = function (path) {
        if (path.endsWith(_RUN_JS) ||
            path.endsWith(_RUN_JHTML) ||
            path.endsWith(_JHTML_SRC_EXTENSION)) {
            return true;
        }
        return false;
    }

    // filter実行ファイル(リクエスト単位で必ず実行される動的js).
    // ext 対象パスの拡張子を設定します.
    // 戻り値: true の場合処理を続行します.
    const _runFilter = async function (ext) {
        try {
            // 実行jsを取得.
            let runJs = _loadJs(_FILTER_PATH());
            // 実行jsを実行.
            let ret = await runJs.handler();
            runJs = undefined;
            // フィルター正常終了の場合.
            if (ret == true) {
                return true;
            }
            // $responseが利用されている場合.
            if (_c_response != null) {
                // $response内容を取得.
                return _resultFilter(_c_response._$get(), ext);
            }
            // filter実行エラー返却.
            return _resultFilter(null, ext);
        } catch (e) {
            // エラーログ出力.
            console.error("[error]runFilter: ", e);
            return _errorRunJs(e, "");
        }
    }

    // filter実行結果を生成.
    const _resultFilter = function (res, ext) {
        if (res == undefined || res == null) {
            // filter実行で処理中断の場合は
            // 通常403返却を行なう.
            return _errorStaticResult(403, ext);
        }
        // 指定条件が存在する場合のエラー返却.
        return _returnRunJsResponse(res, ext);
    }

    // 指定リクエストのetagが etags.json と一致するかチェック.
    const _httpRequestEtag = function (outEtag, path) {
        // キャッシュ条件が生成されていない場合.
        if (_c_etag == null) {
            // 対象パスのetag情報のファイルを取得.
            const etagConf = $loadConf(_ETAGS_CONF_FILE);
            if (etagConf == null) {
                // 空生成.
                _c_etag = {};
                // 存在しない場合.
                return false;
            }
            _c_etag = etagConf;
        }
        // パスの整形.
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        // 対象パスの定義etagを取得.
        const srcEtag = _c_etag[path];
        if (srcEtag == undefined) {
            // 存在しない場合.
            return false;
        }
        // conf定義のetagをセット.
        outEtag[0] = srcEtag;

        // requestのetagキャッシュ確認と比較.
        // 一致しない場合はキャッシュ扱いしない.
        return srcEtag == _event.headers["if-none-match"];
    }

    // 静的なローカルファイルをレスポンス返却.
    const _responseStaticFile = async function (path, ext) {
        try {
            // パスを取得.
            if (path[0] == "/") {
                path = path.substring(1)
            }
            let targetFile = _PUBLIC_PATH() + path;

            // 終端が / でファイル名が設定されていない場合.
            if (targetFile.endsWith("/")) {
                // index.html or index.htm として処理する.
                // index.html.gz も同時にチェックする.
                if (_existsSync(targetFile + "index.html") ||
                    _existsSync(targetFile + "index.html" + _PUBLIC_CONTENTS_GZ)) {
                    targetFile += "index.html";
                    path = "index.html";
                } else {
                    targetFile += "index.htm";
                    path = "index.htm";
                }
                ext = "html";
            }

            // etag内容の精査.
            const headers = {};
            const srcEtag = [null];
            const etagCache = _httpRequestEtag(srcEtag, path);
            // etagレスポンスが必要な場合.
            if (srcEtag[0] != null) {
                // etagが存在する場合はresponseヘッダにセット.
                headers["etag"] = srcEtag[0];
            }
            // expire=-1を必ず設定.
            headers["expires"] = "-1";

            // mimeを取得.
            let gz = false;
            let mime = _getMime(ext);
            if (mime == undefined) {
                mime = _OCTET_STREAM;
            } else {
                gz = mime.gz;
                mime = mime.type;
            }
            // mimeをセット.
            headers["content-type"] = mime;
            // etagキャッシュが一致する場合.
            if (etagCache == true) {
                // キャッシュ扱いで返却する.
                return {
                    statusCode: 304
                    , headers: headers
                    , isBase64Encoded: false
                    , body: ""
                };
            }
            // gzip圧縮済みの静的コンテンツが存在する場合.
            if (_existsSync(targetFile + _PUBLIC_CONTENTS_GZ)) {
                // gzipのfileを取得.
                let body = fs.readFileSync(targetFile + _PUBLIC_CONTENTS_GZ);
                headers["content-encoding"] = "gzip";
                // 返却処理.
                return {
                    statusCode: 200
                    , statusMessage: "ok"
                    , headers: headers
                    , isBase64Encoded: true
                    , body: body.toString("base64")
                };
            }
            // 対象のファイルが存在しない場合.
            if (!_existsSync(targetFile)) {
                console.warn("[warning] not static file: " + targetFile);
                return _errorStaticResult(404, ext);
            }
            // fileを取得.
            let body = fs.readFileSync(targetFile);
            // 圧縮処理.
            if (gz) {
                // gzip処理.
                body = await _convGZIP(body);
                headers["content-encoding"] = "gzip";
            }
            // 返却処理.
            return {
                statusCode: 200
                , statusMessage: "ok"
                , headers: headers
                , isBase64Encoded: true
                , body: body.toString("base64")
            };
        } catch (e) {
            console.error("[error]staticFile: " + path, e);
            return _errorStaticResult(500, ext);
        }
    }

    // gzip圧縮(promise = async).
    const _convGZIP = function (body) {
        return new Promise((resolve, reject) => {
            require('zlib').gzip(body, function (err, result) {
                if (err != undefined) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });
    }

    // (静的ファイル)エラー返却.
    const _errorStaticResult = function (status, ext) {
        let mime = _getMime(ext);
        let headers = null;
        let body = ""
        if (mime == undefined) {
            headers = { "content-type": "text" };
            body = "error: " + status;
        } else {
            headers = { "content-type": mime.type };
            body = "";
        }
        return {
            statusCode: status | 0
            , headers: headers
            , isBase64Encoded: false
            , body: body
        }
    }

    // 動的jsを実行.
    const _responseRunJs = async function (path, ext) {
        if (path[0] == "/") {
            path = path.substring(1).trim();
        }
        // publicディレクトリ.
        path = _PUBLIC_PATH() + path;
        try {
            let convFunc = null;
            if (ext == "jhtml") {
                // jhtml->js変換用のfunctionが設定されている場合.
                if (_jhtmlConvFunc != null) {
                    // jhtmlソースパス変換.
                    path = path.substring(0, path.length - (ext.length + 1)) + _JHTML_SRC_EXTENSION;
                    convFunc = _jhtmlConvFunc; // jhtml変換function.
                } else {
                    // jhtml->js 変換済みの場合はjhtml実行パス変換.
                    path = path.substring(0, path.length - (ext.length + 1)) + _RUN_JHTML;
                }
            } else {
                // js実行.
                path += _RUN_JS;
            }
            // 対象のファイルが存在しない場合.
            if (!_existsSync(path)) {
                console.warn("[warning] not RunJs file: " + path);
                return _errorStaticResult(404, (ext == "jhtml") ? "html" : "js");
            }
            // 実行jsを取得.
            let runJs = _loadJs(path, convFunc);
            // 実行jsを実行.
            let body = await runJs.handler();
            runJs = undefined;
            let response = null;
            // $responseが利用されている場合.
            if (_c_response != null) {
                // $response内容を取得.
                response = _c_response._$get();
            } else {
                // $responseが利用されていない場合.
                // 空の正常結果を対象とする.
                response = {
                    status: 200,
                    message: "ok",
                    headers: {},
                    cookies: {},
                    body: ""
                }
            }
            // 実行jsから body が直接設定されている場合.
            if (body != undefined && body != null) {
                // 返却情報のBodyをセット.
                response["body"] = body;
            }
            // レスポンスヘッダにキャッシュなしをセット.
            const resHeader = response.headers;
            if (resHeader["last-modified"] != undefined) {
                // キャッシュ返却は削除.
                delete resHeader["last-modified"];
            }
            if (resHeader["etag"] != undefined) {
                // キャッシュ返却は削除.
                delete resHeader["etag"];
            }
            // キャッシュなし設定.
            resHeader["cache-control"] = "no-cache"
            resHeader["pragma"] = "no-cache"
            resHeader["expires"] = "-1"
            // 戻り条件をセット.
            return _returnRunJsResponse(response, ext);
        } catch (e) {
            // エラーログ出力.
            console.error("[error]runJs: " + path, e);
            return _errorRunJs(e, ext);
        }
    }

    // jsやjhtmlなどの実行戻り条件をセット.
    const _returnRunJsResponse = function (response, ext) {
        let base64 = false;
        let contentType = response.headers["content-type"];
        let body = response.body;
        const tof = typeof (body);
        // 文字列.
        if (tof == "string") {
            // コンテンツタイプが設定されていない場合.
            if (contentType == undefined) {
                if (ext == "jhtml") {
                    response.headers["content-type"] = "text/html";
                } else {
                    response.headers["content-type"] = "application/json";
                }
            }
        } else if (body instanceof Buffer) {
            // バイナリ返却(Buffer).
            body = body.toString("base64");
            base64 = true;
            // コンテンツタイプが設定されていない場合.
            if (contentType == undefined) {
                response.headers["content-type"] = _OCTET_STREAM;
            }
        } else if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
            // バイナリ返却(typedArray or ArrayBuffer).
            body = Buffer.from(body).toString('base64')
            base64 = true;
            // コンテンツタイプが設定されていない場合.
            if (contentType == undefined) {
                response.headers["content-type"] = _OCTET_STREAM;
            }
        } else if (tof == "object") {
            // json返却.
            body = JSON.stringify(body);
            // コンテンツタイプが設定されていない場合.
            if (contentType == undefined) {
                response.headers["content-type"] = "application/json";
            }
            // それ以外の場合.
        } else {
            // 空文字をセット.
            body = "";
        }
        // cookie変換.
        let cookies = [];
        if (response.cookies != undefined && response.cookies != null) {
            // cookiesが１つでも存在する場合処理を行なう.
            for (let k in response.cookies) {
                cookies = _responseCookies(response.cookies)
                break;
            }
        }
        // status message が設定されていない場合.
        if (response.message == undefined || response.message == null ||
            response.message == "") {
            // status message なしで返却.
            return {
                statusCode: response.status
                , headers: response.headers
                , cookies: cookies
                , isBase64Encoded: base64
                , body: body
            };
        }
        // response返却処理.
        return {
            statusCode: response.status
            , statusMessage: response.message
            , headers: response.headers
            , cookies: cookies
            , isBase64Encoded: base64
            , body: body
        };
    }

    // runJS結果のエラー処理.
    const _errorRunJs = function (e, ext) {
        // エラー返却.
        const headers = {}
        let body = null;
        let status = 500;
        let message = "Internal Server Error";
        if (e instanceof HttpError) {
            // HttpErrorオブジェクトの場合.
            status = e.getStatus();
            message = e.getMessage();
        }
        // エラーレスポンス返却.
        if (ext == "jhtml") {
            headers["content-type"] = "text/html";
            body = "" + message;
        } else {
            headers["content-type"] = "application/json";
            body = "{status: " + status + ", message: '" + message + "'}";
        }
        return {
            statusCode: status
            , statusMessage: message
            , headers: headers
            , isBase64Encoded: false
            , body: body
        };
    }

    // サーバーサイドで実行処理.
    const _loadJs = function (path, convFunc) {
        try {
            // ファイルを読み込む.
            let jsBody = fs.readFileSync(path).toString();
            // convFuncが設定されている場合.
            if (convFunc != undefined && convFunc != null) {
                // 変換処理.
                jsBody = convFunc(jsBody);
            }
            const exp = {};
            Function("exports", "module", jsBody)(
                exp, { exports: exp }
            );
            return exp;
        } catch (e) {
            console.error("## [ERROR]_loadJs path: " + path);
            throw e;
        }
    }

    // formパラメータ解析.
    const _analysisFormParams = function (n) {
        const list = n.split("&");
        const len = list.length;
        const ret = {};
        for (var i = 0; i < len; i++) {
            n = list[i].split("=");
            n[0] = decodeURIComponent(n[0]);
            if (n.length == 1) {
                ret[n[0]] = "";
            } else {
                ret[n[0]] = decodeURIComponent(n[1]);
            }
        }
        return ret;
    }

    // 拡張子を取得.
    const _extends = function (path) {
        // 最後が / の場合は拡張子なし.
        if (path.endsWith("/")) {
            return undefined;
        }
        // 最後にある / の位置を取得.
        let p = path.lastIndexOf("/");
        const ex = path.substring(p);
        p = ex.lastIndexOf(".");
        if (p == -1) {
            return "";
        }
        return ex.substring(p + 1)
            .trim().toLowerCase();
    }

    // existsSyncをstatSyncで代用(existsSync=Deprecated)
    const _existsSync = function (name) {
        try {
            fs.statSync(name);
            return true;
        } catch (e) {
            return false;
        }
    }

    // 登録されたCookie情報をレスポンス用headerに設定.
    // 戻り値: cookieリストが返却されます.
    const _responseCookies = function (cookieList) {
        const ret = [];
        let em, value, len, sameSite;
        len = 0; sameSite = false;
        for (let k in cookieList) {
            em = cookieList[k];
            // 最初の条件は key=value条件.
            value = encodeURIComponent(k) +
                "=" + encodeURIComponent(em.value);
            for (let n in em) {
                // valueのkey名は設定済みなので飛ばす.
                if (n == "value") {
                    continue;
                } else if (n == "samesite") {
                    sameSite = true;
                    // 単一設定[Secureなど].
                } else if (em[n] == true) {
                    value += "; " + encodeURIComponent(n);
                    // key=value.
                } else {
                    value += "; " + encodeURIComponent(n) +
                        "=" + encodeURIComponent(em[n]);
                }
            }
            // samesiteが設定されていない場合.
            // samesite=laxを設定.
            if (!sameSite) {
                value += "; samesite=lax";
            }
            ret[ret.length] = value;
            len++;
        }
        return ret;
    }

    // デフォルトのインデックスパス.
    const _DEF_INDEX_FILE = "index";

    // 関数URLのリクエストを取得.
    // event: lambdaのeventパラメータを設定します.
    // 戻り値: リクエスト情報が返却されます.
    const _createRequest = function (event) {
        const o = {};
        // URLパスを取得.
        let _path = null;
        o.path = function () {
            // cache.
            if (_path != null) {
                return _path;
            }
            const path = event.rawPath;
            if (path.endsWith("/")) {
                _path = path + _DEF_INDEX_FILE;
            } else {
                _path = path;
            }
            return _path;
        };
        // パスの拡張子を取得.
        let _extends = null;
        o.extends = function () {
            // cache.
            if (_extends != null) {
                return _extends;
            }
            _extends = _extends(o.path());
            return _extends;
        }
        // HTTPメソッドを取得.
        let _method = null;
        o.method = function () {
            if (_method != null) {
                return _method;
            }
            _method = event.requestContext.http.method.toUpperCase();
            return _method;
        }
        // httpヘッダ.
        let _headers = null;
        o.headers = function () {
            if (_headers != null) {
                return _headers;
            }
            const ret = {};
            const h = event.headers;
            if (h != undefined && h != null) {
                for (let k in h) {
                    ret[k] = h[k]; // lambdaでは keyは全て小文字変換されてる.
                }
            }
            _headers = ret;
            return ret;
        }
        // 指定keyのheaderを取得.
        o.header = function (key) {
            const kv = o.headers();
            if (kv == undefined) {
                return null;
            }
            const ret = kv[key];
            if (ret == undefined) {
                return null;
            }
            return ret;
        }
        // httpヘッダ(cookies).
        let _cookies = null;
        o.cookies = function () {
            if (_cookies != null) {
                return _cookies;
            }
            const ret = {};
            const c = event.cookies;
            if (c != undefined && c != null) {
                let p, value;
                const len = c.length;
                for (let i = 0; i < len; i++) {
                    value = decodeURIComponent(c[i])
                    p = value.indexOf("=");
                    if (p == -1) {
                        ret[value] = true;
                    } else {
                        ret[value.substring(0, p)] = value.substring(p + 1);
                    }
                }
            }
            _cookies = ret;
            return ret;
        }
        // 指定keyのcookieを取得.
        o.cookie = function (key) {
            const kv = o.cookies();
            if (kv == undefined) {
                return null;
            }
            const ret = kv[key];
            if (ret == undefined) {
                return null;
            }
            return ret;
        }
        // protocol.
        o.protocol = function () {
            return event.requestContext.http.protocol;
        }
        // URLParams.
        o.urlParams = function () {
            const ret = event.queryStringParameters;
            if (ret == undefined || ret == null) {
                return {};
            }
            return ret;
        }
        // パラメータを取得.
        let _params = null;
        o.params = function () {
            if (_params != null) {
                return _params;
            }
            if (o.method() == "GET") {
                // urlParams.
                _params = o.urlParams();
                return _params;
            }
            let body, isBinary;
            if (event.isBase64Encoded == true) {
                // [body]base64=binaryの場合.
                body = Buffer.from(event.body, 'base64');
                isBinary = true;
            } else {
                // [body]stringの場合.
                body = event.body;
                isBinary = false;
            }
            const contentType = o.headers()["content-type"];
            if (contentType == "application/json") {
                // json.
                if (isBinary) {
                    body = body.toString();
                    isBinary = false;
                }
                _params = JSON.parse(body);
            } else if (contentType == "application/x-www-form-urlencoded") {
                // form-data.
                if (isBinary) {
                    body = body.toString();
                    isBinary = false;
                }
                _params = _analysisFormParams(body);
            } else if (!isBinary) {
                // string(formData).
                _params = _analysisFormParams(body);
            } else {
                // binary.
                _params = {};
            }
            return _params;
        }
        // body情報を取得.
        o.body = function () {
            if (o.method() == "GET") {
                return null;
            }
            if (event.isBase64Encoded == true) {
                // [body]base64=binaryの場合.
                return Buffer.from(event.body, 'base64');
            }
            // [body]stringの場合-> binary.
            return Buffer.from(event.body);
        }
        _c_request = o;
        return o;
    }

    // レスポンス生成.
    const _createResponse = function () {
        const o = {}
        // ステータス設定.
        let _state = 200;
        let _state_msg = "";
        o.status = function (status, message) {
            if (message == null || messaeg == undefined) {
                message = null;
            }
            _state = status;
            _state_msg = message;
        }
        // header情報を設定.
        const _headers = {}
        o.header = function (key, value) {
            _headers[("" + key).trim().toLowerCase()] = value;
        }
        // ヘッダ取得や削除関連.
        o.headers = {
            get: function (key) {
                return _headers[("" + key).trim().toLowerCase()];
            },
            keys: function () {
                const ret = [];
                for (let k in _headers) {
                    ret.push(k);
                }
                return ret;
            },
            remove: function (key) {
                key = ("" + key).trim().toLowerCase();
                if (_headers[key] != undefined) {
                    delete _headers[key];
                }
            }
        }
        // cookie情報.
        // key 対象のキー名を設定します.
        // value 対象のvalueを設定します.
        //         value="value; Max-Age=2592000; Secure;"
        //         ※必ず先頭文字は "value;" 必須.
        //         や
        //         value={value: value, "Max-Age": 2592000, Secure: true}
        //       のような感じで設定します.
        const _cookies = {}
        o.cookie = function (key, value) {
            const vparams = {};
            if (typeof (value) == "string") {
                // 文字列から {} に変換.
                let n;
                const list = value.split(";");
                const len = list.length;
                for (let i = 0; i < len; i++) {
                    n = list[i].trim();
                    if (i == 0) {
                        vparams.value = n;
                    } else {
                        const p = n.indexOf("=");
                        if (p == -1) {
                            vparams[n] = true;
                        } else {
                            vparams[n.substring(0, p)] = n.substring(p + 1);
                        }
                    }
                }
            } else {
                // objectの変換.
                for (let k in value) {
                    // Date => String変換.
                    if (value[k] instanceof Date) {
                        vparams[k] = value[k].toUTCString();
                    } else {
                        vparams[k] = value[k];
                    }
                }
            }
            _cookies[("" + key).trim().toLowerCase()] = vparams;
        }
        // bodyを設定.
        let _body = undefined;
        o.body = function (body) {
            _body = body;
        }
        // contentType.
        o.contentType = function (mime, charset) {
            if (typeof (charset) == "string" && charset.length > 0) {
                mime += "; charset=" + charset;
            }
            _headers["content-type"] = mime;
        }
        // リダイレクト.
        o.redirect = function (url, params, status) {
            if (status == undefined) {
                status = 301;
            } else {
                const srcStatus = status;
                if (isNaN(status = parseInt(status))) {
                    throw new Error("The set HTTP status " +
                        srcStatus + " is not a number.");
                }
            }
            if (typeof (url) != "string") {
                throw new Error("No redirect URL specified");
            }
            if (params != undefined) {
                // パラメータが存在する場合セット.
                if (typeof (params) != "string") {
                    let cnt = 0
                    let pms = "";
                    for (let k in params) {
                        if (cnt != 0) {
                            pms += "&";
                        }
                        pms += decodeURIComponent(k) + "=" +
                            decodeURIComponent(params[k]);
                        cnt++;
                    }
                    params = pms;
                }
                // パラメータを追加.
                if (url.indexOf("?") != -1) {
                    url += "&";
                } else {
                    url += "?";
                }
                url += params;
            }
            _headers["location"] = url;
            o.status(status);
            o.body("");
        }
        // レスポンスパラメータを取得.
        o._$get = function () {
            return {
                status: _state,
                message: _state_msg,
                headers: _headers,
                cookies: _cookies,
                body: _body
            }
        }
        _c_response = o;
        return _c_response;
    }

    // Http系のエラー返却.
    const HttpError = class extends Error {
        #status;
        #message;
        #error;
        // コンストラクタ.
        constructor(args) {
            if (args == undefined || args == null) {
                args = {};
            }
            if (args.status == undefined) {
                args.status = 500;
            }
            if (args.message == undefined) {
                if (args.status == 500) {
                    args.message = "Internal Server Error";
                }
            }
            if (args.error == undefined) {
                args.error = undefined;
            }
            this.#status = args.status;
            this.#message = args.message;
            this.#error = args.error;
            // Errorオブジェクト設定.
            Object.defineProperty(this, 'name', {
                configurable: true,
                enumerable: false,
                value: this.constructor.name,
                writable: true,
            });
            if (Error.captureStackTrace) {
                Error.captureStackTrace(this, HttpError);
            }
        }
        // ステータスを取得.
        // 戻り値: httpステータスが返却されます.
        getStatus() {
            return this.#status;
        }
        // メッセージを取得.
        // 戻り値: メッセージが返却されます.
        getMessage() {
            return this.#message;
        }
        // 親エラーオブジェクトを取得.
        // 戻り値: 親エラーオブジェクトが返却されます.
        getError() {
            return this.#error;
        }
    }
    _g.HttpError = HttpError;

})(global);
