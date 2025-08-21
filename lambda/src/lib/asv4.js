///////////////////////////////////////////////////////////
// AWS Signature(version4).
// AWS のサービスに rest Apiでアクセスするための
// シグニチャーを計算する.
///////////////////////////////////////////////////////////
(function () {
    'use strict'

    // crypto.
    const crypto = require('crypto');

    // CredentialScope のアルゴリズム名.
    const ALGORITHM = "AWS4-HMAC-SHA256";

    // CredentialScope のエンドスコープ.
    const END_SCOPE = "aws4_request";

    // スキーム.
    const SCHEME = "AWS4";

    // 空のPayloadSha256.
    const EMPTY_PAYLOAD_SHA256 =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    // デフォルトのクレデンシャル.
    let DEFAULT_CREDENTIAL = null;

    // デフォルトのクレデンシャルを取得.
    // 戻り値: {accessKey: string, secretAccessKey: string,
    //           sessionToken: string}
    //         - accessKey アクセスキーが返却されます.
    //         - secretAccessKey シークレットアクセスキーが返却されます.
    //         - sessionToken セッショントークンが返却されます.
    //                        状況によっては空の場合があります.
    const getCredential = function () {
        // タイムアウトの場合.
        if (DEFAULT_CREDENTIAL == null) {
            DEFAULT_CREDENTIAL = {
                accessKey: process.env["AWS_ACCESS_KEY_ID"]
                , secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"]
                , sessionToken: process.env["AWS_SESSION_TOKEN"]
            };
        }
        return DEFAULT_CREDENTIAL;
    }


    // yyyyMMdd'T'HHmmss'Z'の文字列を作成.
    // date 対象の日付オブジェクトを設定します.
    // 戻り値: yyyyMMdd'T'HHmmss'Z'が返却されます.
    const createDateTimeText = function (date) {
        if (typeof (date) == "string") {
            date = new Date(date);
        }
        // UTCで出力.
        const y = "" + date.getUTCFullYear();
        const M = "" + (date.getUTCMonth() + 1);
        const d = "" + date.getUTCDate();
        const h = "" + date.getUTCHours();
        const m = "" + date.getUTCMinutes();
        const s = "" + date.getUTCSeconds();
        // こんな感じ `20150830T123600Z` で生成.
        return y + "00".substring(M.length) + M +
            "00".substring(d.length) + d +
            "T" +
            "00".substring(h.length) + h +
            "00".substring(m.length) + m +
            "00".substring(s.length) + s +
            "Z";
    }

    // リージョンを取得.
    // region 対象のリージョン名を設定します.
    // 戻り値: リージョン名が返却されます.
    const getRegion = function (region) {
        if (region == undefined || region == null) {
            region = "ap-northeast-1";
        }
        return region;
    }

    // sha256変換.
    // key 対象のキー.
    // returnMode digestにわたす引数(string).
    // 戻り値 変換結果(returnModeに依存)
    const sha256 = function (key, returnMode) {
        const ret = crypto.createHash('sha256')
            .update(key);
        if (returnMode == undefined || returnMode == null) {
            return ret.digest();
        }
        return ret.digest(returnMode);
    }

    // hmacSHA256で変換.
    // data 対象のデータ
    // key 対象のキー
    // returnMode digestにわたす引数(string).
    // 戻り値 変換結果(returnModeに依存)
    const hmacSHA256 = function (key, message, returnMode) {
        const ret = crypto.createHmac('sha256', key)
            .update(message);
        if (returnMode == undefined || returnMode == null) {
            return ret.digest();
        }
        return ret.digest(returnMode);
    }

    // リクエストヘッダのキー小文字変換版を作成.
    // header リクエストヘッダを設定します.
    //        この中身が直接変更されます.
    const convertRequestHeaderToLowerKeys = function (header) {
        let len, i, v, lk;
        const list = [];
        len = 0;
        for (let k in header) {
            v = header[k];
            lk = k.toLowerCase();
            delete header[k];
            list[len++] = lk;
            list[len++] = v;
        }
        for (i = 0; i < len; i += 2) {
            header[list[i]] = list[i + 1];
        }
    }

    // リクエストヘッダ名を取得.
    // header リクエストヘッダを設定します.
    const getRequestHeaderKeys = function (header) {
        const ret = [];
        for (let k in header) {
            ret[ret.length] = k;
        }
        ret.sort(function (a, b) { return a.localeCompare(b); });
        return ret;
    }

    // urlParamsを文字列に変換する.
    // urlParams 解析されたURLパラメータを設定します.
    // 戻り値: 変換された文字列が返却されます.
    const convertUrlParams = function (urlParams) {
        if (urlParams == undefined || urlParams == null) {
            return "";
        } else if (typeof (urlParams) == "string") {
            return urlParams;
        }
        const list = [];
        for (let k in urlParams) {
            list[list.length] =
                encodeURIComponent(k) + "=" +
                encodeURIComponent(urlParams[k]);
        }
        list.sort();
        const len = list.length;
        let ret = "";
        for (let i = 0; i < len; i++) {
            if (i != 0) {
                ret += "&";
            }
            ret += list[i];
        }
        return ret;
    }

    // path内容をencodeURIComponentする.
    // path 対象のパスを設定します.
    // 戻り値: encodeURIComponent変換されたパスが返却されます.
    const encodeURIToPath = function (path) {
        path = path.trim();
        // "/"文字のみの場合.
        // パスが空かパス内に "%" すでにURLEncodeしている場合.
        if (path.length == 0 || path == "/" || path.indexOf("%") != -1) {
            // 処理しない.
            return path;
        }
        let n, ret;
        const list = path.split("/");
        const len = list.length;
        // pathの "/" はURLエンコードしないで、それ以外のみURLエンコード処理を行う.
        ret = "";
        for (let i = 0; i < len; i++) {
            n = list[i].trim();
            if (n.length == 0) {
                ret = ret + "/";
            } else if (ret.length == 0 || ret == "/") {
                ret = ret + encodeURIComponent(n);
            } else {
                ret = ret + "/" + encodeURIComponent(n);
            }
        }
        return ret;
    }

    ////////////////////////////////
    // 通常のAWSのREST Apiアクセス用.
    ////////////////////////////////

    // step1.署名バージョン4の正規リクエストを作成する.
    // https://docs.aws.amazon.com/ja_jp/general/latest/gr/sigv4-create-canonical-request.html
    //  CanonicalRequest =
    //      HTTPRequestMethod + '\n' +
    //      CanonicalURI + '\n' +
    //      CanonicalQueryString + '\n' +
    //      CanonicalHeaders + '\n' +
    //      SignedHeaders + '\n' +
    //      HexEncode(Hash(RequestPayload)
    // credential getCredential() で取得した値(Object).
    // method HTTPメソッド(GET, POSTなど) = HTTPRequestMethod.
    // path 対象のパス名(string) = CanonicalURI.
    // urlParams urlパラメータ(object) = CanonicalQueryString.
    // header 対象のヘッダ(Object) = CanonicalHeaders.
    //        必ずhostを設定する必要があります.
    // payload 対象のRequestPayload = RequestPayload.
    //         この値はrequestBody値を設定.
    //         method=GETなどの場合は空文字[""]を設定.
    // 戻り値: {hashedCanonicalRequest: string, signedHeaders: string} 
    //        hashedCanonicalRequestがセット.
    //        signedHeadersがセット.
    const signatureV4Step1 = function (
        credential, method, path, urlParams, header, payload
    ) {
        // クレデンシャル内容が不正な場合.
        if (credential["secretAccessKey"] == undefined ||
            credential["accessKey"] == undefined) {
            throw new Error("AWS credentials not set.");
        }
        // httpヘッダ小文字変換.
        convertRequestHeaderToLowerKeys(header);
        // 必須ヘッダ条件.
        if (header["host"] == undefined) {
            throw new Error(
                "\"host\" is required in the request header.");
        }
        // パスの先頭スラッシュをセット.
        if (!(path = path.trim()).startsWith("/")) {
            path = "/" + path;
        }
        // payloadが設定されていない場合、空文字をセット.
        if (payload == undefined || payload == null) {
            payload = "";
        }
        // urlParamsを取得.
        urlParams = convertUrlParams(urlParams);
        // x-amz-dateが存在しない場合.
        if (header["x-amz-date"] == undefined) {
            const date = new Date();
            header["x-amz-date"] = createDateTimeText(date);
        }
        // credentialのセッショントークンが存在する場合.
        if (credential["sessionToken"] != undefined) {
            header["x-amz-security-token"] = credential["sessionToken"];
        }
        // payload(requestBody)sha256で計算.
        if (payload == "") {
            // 空の場合.
            header["x-amz-content-sha256"] = EMPTY_PAYLOAD_SHA256;
        } else {
            // 空じゃない場合計算する.
            header["x-amz-content-sha256"] = sha256(payload, "hex");
        }

        // SignedHeadersとCanonicalHeadersを作成.
        // key1;key2 ...の感じ.
        let signedHeaders = "";
        // key1:value\nkey2:value ...の感じ.
        let canonicalHeaders = "";
        let scode = ""
        // ヘッダソートキー.
        let list = getRequestHeaderKeys(header);
        const len = list.length;
        for (let i = 0; i < len; i++) {
            const key = list[i].trim();
            // SignedHeadersをセット.
            signedHeaders += scode + key; scode = ";";
            // CanonicalHeadersをセット.
            canonicalHeaders +=
                key.replace(/ +/g, " ") + ":" +
                header[key].trim().replace(/ +/g, " ") + "\n";
        }
        list = undefined; scode = undefined;
        // CanonicalRequestを作成.
        const canonicalRequest =
            method.toUpperCase() + '\n' +
            path + '\n' +
            urlParams + '\n' +
            canonicalHeaders + '\n' +
            signedHeaders + '\n' +
            header["x-amz-content-sha256"];
        // sha256 + hex変換.
        const hashedCanonicalRequest = sha256(canonicalRequest, "hex");
        // 処理結果を返却.
        return {
            hashedCanonicalRequest: hashedCanonicalRequest,
            signedHeaders: signedHeaders
        };
    }

    // step2.署名バージョン4の署名文字列を作成する.
    // https://docs.aws.amazon.com/ja_jp/general/latest/gr/sigv4-create-string-to-sign.html
    // StringToSign =
    //      Algorithm + \n +
    //      RequestDateTime + \n +
    //      CredentialScope + \n +
    //      HashedCanonicalRequest
    // header 対象のヘッダ(Object).
    // region 対象のリージョン(string).
    // service AWSサービス名(string).
    // step1Result signatureV4Step1で作成した値(Object).
    // 戻り値: {credentialScope: string, stringToSign: string, dateText: "string"}
    //         credentialScopeがセット.
    //         stringToSignがセット.
    //         dateText(yyyMMdd)がセット.
    const signatureV4Step2 = function (
        header, region, service, step1Result
    ) {
        // リージョン取得.
        region = getRegion(region);
        const dateTimeText = header["x-amz-date"];
        // yyyyMMdd変換.
        const dateText = dateTimeText.substring(0, dateTimeText.indexOf("T"));
        // CredentialScopeを生成.
        const credentialScope =
            dateText + "/" + region + "/" + service + "/" + END_SCOPE;
        // stringToSignを生成.
        const stringToSign =
            ALGORITHM + "\n"
            + dateTimeText + "\n"
            + credentialScope + "\n"
            + step1Result["hashedCanonicalRequest"];

        // 処理結果を返却.
        return {
            credentialScope: credentialScope,
            stringToSign: stringToSign,
            dateText: dateText
        }
    }

    // final.署名バージョン4の署名を計算する.
    // https://docs.aws.amazon.com/ja_jp/general/latest/gr/sigv4-calculate-signature.html
    // header リクエストヘッダ(Object).
    // credential getCredential() で取得した値(Object).
    // region 対象のリージョン(string).
    // service AWSサービス名(string).
    // step1Result signatureV4Step1で作成した値(Object).
    // step2Result signatureV4Step2で作成した値(Object).
    // 戻り値: Authorization の値.
    const signatureV4Final = function (
        header, credential, region, service, step1Result,
        step2Result
    ) {
        // クレデンシャル内容が不正な場合.
        if (credential["secretAccessKey"] == undefined ||
            credential["accessKey"] == undefined) {
            throw new Error("AWS credentials not set.");
        }
        // シグニチャーキー生成.
        let signature = SCHEME + credential["secretAccessKey"];
        signature = hmacSHA256(signature, step2Result["dateText"]);
        signature = hmacSHA256(signature, region);
        signature = hmacSHA256(signature, service);
        signature = hmacSHA256(signature, END_SCOPE);
        signature = hmacSHA256(signature, step2Result["stringToSign"], "hex");
        // Authorizationを生成.
        const sigV4 =
            ALGORITHM
            + " Credential=" + credential["accessKey"] + "/" + step2Result["credentialScope"]
            + ", SignedHeaders=" + step1Result["signedHeaders"]
            + ", Signature=" + signature;

        // header に シグニチャーV4を設定.
        header["Authorization"] = sigV4;
        return sigV4;
    }

    /////////////////////
    // queryParam系処理.
    /////////////////////

    // AWS的なURLエンコード.
    const urlEncode = function (value, flg) {
        if (flg != true) {
            // true以外の場合は普通にURLエンコード.
            return encodeURIComponent(value);
        }
        // trueの場合は/以外はURLエンコード.
        return encodeURIComponent(value)
            .split('%2F').join("/");
    }

    // ヘッダキー名一覧を正規化.
    const getCanonicalizeHeaderNames = function (headers) {
        if (headers == undefined || headers == null) {
            return "";
        }
        // Keyリスト抽出.
        const lst = [];
        for (let k in headers) {
            lst[lst.length] = k.toLowerCase();
        }
        // ソートして;区切りで文字列化.
        let i;
        let ret = "";
        lst.sort();
        const len = lst.length;
        for (let i = 0; i < len; i++) {
            if (i != 0) {
                ret += ";";
            }
            ret += lst[i];
        }
        return ret;
    }

    // ヘッダーKey/Value一覧を正規化.
    const getCanonicalizedHeaderString = function (headers) {
        if (headers == undefined || headers == null) {
            return "";
        }
        // 大文字、小文字区別なしでKeyソート.
        const lst = [];
        for (let k in headers) {
            lst[lst.length] = k.trim();
        }
        let i, k;
        let ret = "";
        lst.sort(function (a, b) { return a.localeCompare(b); });
        const len = lst.length;
        // keyを小文字変換で、Key=Value;で文字連結.
        for (let i = 0; i < len; i++) {
            k = lst[i];
            ret += k.toLowerCase().replaceAll(/\s+/g, " ") + ":" +
                headers[k].replaceAll(/\s+/g, " ") + "\n";
        }
        return ret;
    }

    // URLのホスト名を取得.
    const getURLToHost = function (url) {
        let p = 0;
        if (url.startsWith("https://")) {
            p = 8;
        } else if (url.startsWith("http://")) {
            p = 7;
        }
        const pp = url.indexOf("/", p);
        if (pp == -1) {
            return url.substring(p);
        }
        return url.substring(p, pp);
    }

    // URLのパスを正規化.
    const getCanonicalizedResourcePath = function (url) {
        let p = 0;
        if (url.startsWith("https://")) {
            p = 8;
        } else if (url.startsWith("http://")) {
            p = 7;
        }
        p = url.indexOf("/", p);
        let path = p != -1 ? url.substring(p + 1) : ""
        if (path == null || path == "") {
            return "/";
        }
        path = urlEncode(path, true);
        if (path.startsWith("/")) {
            return path;
        }
        return "/" + path;
    }

    // request条件を正規化.
    const getCanonicalRequest = function (endpoint, httpMethod, queryParameters,
        canonicalizedHeaderNames, canonicalizedHeaders, bodyHash) {
        return httpMethod + "\n" +
            getCanonicalizedResourcePath(endpoint) + "\n" +
            queryParameters + "\n" +
            canonicalizedHeaders + "\n" +
            canonicalizedHeaderNames + "\n" +
            bodyHash;
    }

    // queryStringを正規化.
    const getCanonicalizedQueryString = function (parameters) {
        const keys = [];
        for (let k in parameters) {
            keys[keys.length] = [urlEncode(k, false), k];
        }
        keys.sort(function (a, b) {
            a = a[0]; b = b[0];
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1
            }
            return 0;
        });
        const len = keys.length;
        let ret = "";
        for (let i = 0; i < len; i++) {
            if (i != 0) {
                ret += "&";
            }
            ret += keys[i][0] + "=" +
                urlEncode(parameters[keys[i][1]], false);
        }
        return ret;
    }

    // 署名文字列を取得.
    const getStringToSign = function (
        algorithm, dateTime, scope, canonicalRequest) {
        return algorithm + "\n" +
            dateTime + "\n" +
            scope + "\n" +
            sha256(canonicalRequest, "hex");
    }

    // 署名付きQueryParamを生成.
    // credential 対象のAWSクレデンシャルを設定します.
    // endpointUrl 対象のendpointなURLを設定します.
    // httpMethod 対象のHTTPメソッドを設定します.
    // serviceName サービス名を設定します.
    // regionName リージョン名を設定します.
    // headers　空のHttpHeader({})+必要なパラメータをセットします.
    // queryParameters クエリーパラメータを設定します.
    // bodyHash bodyハッシュを設定します.
    // 戻り値: クエリー文字列が返却されます.
    const signatureV4QueryParameter = function (
        credential, endpointUrl, httpMethod, serviceName, regionName,
        headers, queryParameters, bodyHash) {
        // クレデンシャル内容が不正な場合.
        if (credential["secretAccessKey"] == undefined ||
            credential["accessKey"] == undefined) {
            throw new Error("AWS credentials not set.");
        }
        // 現在時刻のDate情報を生成.
        const dateTimeStamp = createDateTimeText(new Date());

        // headewrのhost名にendPointUrlのホスト名をセット.
        headers["host"] = getURLToHost(endpointUrl);
        // ヘッダ情報のKeyを文字列変換.
        const canonicalizedHeaderNames = getCanonicalizeHeaderNames(headers);
        // ヘッダ情報のKeyValue
        const canonicalizedHeaders = getCanonicalizedHeaderString(headers);
        // yyyyMMddを取得.
        const dateStamp = dateTimeStamp.substring(0, dateTimeStamp.indexOf("T"));
        // scope作成
        const scope = dateStamp + "/" + regionName + "/" + serviceName + "/" + END_SCOPE;
        // パラメータセット.
        queryParameters["X-Amz-Algorithm"] = ALGORITHM;
        queryParameters["X-Amz-Credential"] = credential["accessKey"] + "/" + scope;
        queryParameters["X-Amz-Date"] = dateTimeStamp;
        queryParameters["X-Amz-SignedHeaders"] = canonicalizedHeaderNames;
        // queryパラメータの正規化.
        const canonicalizedQueryParameters = getCanonicalizedQueryString(queryParameters);

        // request条件を正規化.
        const canonicalRequest = getCanonicalRequest(endpointUrl, httpMethod,
            canonicalizedQueryParameters, canonicalizedHeaderNames,
            canonicalizedHeaders, bodyHash);

        // 署名文字列を取得.
        const stringToSign = getStringToSign(
            ALGORITHM, dateTimeStamp, scope, canonicalRequest);

        // シグニチャーキーを作成.
        let signature = SCHEME + credential["secretAccessKey"];
        signature = hmacSHA256(signature, dateStamp);
        signature = hmacSHA256(signature, getRegion(regionName));
        signature = hmacSHA256(signature, serviceName);
        signature = hmacSHA256(signature, END_SCOPE);
        signature = hmacSHA256(signature, stringToSign, "hex");
        // 戻り値.
        return "X-Amz-Algorithm=" + queryParameters["X-Amz-Algorithm"] +
            "&X-Amz-Credential=" + queryParameters["X-Amz-Credential"] +
            "&X-Amz-Date=" + queryParameters["X-Amz-Date"] +
            "&X-Amz-Expires=" + queryParameters["X-Amz-Expires"] +
            "&X-Amz-SignedHeaders=" + queryParameters["X-Amz-SignedHeaders"] +
            "&X-Amz-Signature=" + signature;
    }

    // httpsのURLを生成.
    // host [必須]対象のホスト名を設定します.
    // path [任意]対象のパス名を設定します.
    // port [任意]対象のポート番号を設定します.
    // urlParams [任意]urlパラメータを設定します.
    const getUrl = function (host, path, port, urlParams) {
        if (path == undefined || path == null) {
            path = "";
        } else if ((path = path.trim()).startsWith("/")) {
            path = path.substring(1).trim();
        }
        if (urlParams != undefined && urlParams != null) {
            urlParams = "?" + convertUrlParams(urlParams);
        } else {
            urlParams = "";
        }
        // URLを作成.
        return ((port | 0) > 0) ?
            "https://" + host + ":" + (port | 0) + "/" + path + urlParams :
            "https://" + host + "/" + path + urlParams;
    }

    // ヘッダ情報のキー文字を小文字変換.
    // header 対象のヘッダを設定します.
    // 戻り値: 変換されたヘッダ内容が返却されます.
    const convertHeaderToLowerKey = function (header) {
        const ret = {}
        for (let k in header) {
            ret[k.trim().toLowerCase()] = header[k];
        }
        return ret;
    }

    // httpClient.
    // host 対象のホスト名を設定します.
    // path 対象のパス名を設定します.
    // options その他オプションを設定します.
    //  - method(string)
    //    HTTPメソッドを設定します.
    //    設定しない場合は GET.
    //  - headers({})
    //    HTTPリクエストヘッダ(Object)を設定します.
    //  - body(Buffer or String)
    //    HTTPリクエストBodyを設定します.
    //  - port(number)
    //    HTTPS接続先ポート番号を設定します.
    //  - urlParams(string or object)
    //    urlパラメータを設定します.
    //  - response({})
    //    レスポンスステータスやレスポンスヘッダが返却されます.
    //    response = {
    //      status: number,
    //      headers: object,
    //    }
    //  - directURL(boolean)
    //    trueを設定した場合、host = URLになります.
    //  - resultType(string)
    //    戻りBodyの型を設定します.
    //    - text: 文字列で返却します.
    //    - json: JSON形式で返却します.
    //    - blob: blob形式で返却します.
    //    - それ以外: ArrayBuffer形式で返却します.
    //    設定しない場合は `text` になります.
    // 戻り値: bodyが返却されます.
    const request = async function (host, path, options) {
        // optionsが存在しない場合.
        if (options == undefined || options == null) {
            options = {};
        }
        // requestメソッドを取得.
        options.method = options.method == undefined ?
            "GET" : options.method.toUpperCase();
        // requestヘッダを取得.
        options.headers = options.headers == undefined ?
            {} : convertHeaderToLowerKey(options.headers);
        // requestBodyを取得.
        options.body = options.body == undefined ?
            undefined : options.body;
        // httpsPortを取得.
        const port = options.port == undefined ?
            "" : options.port;
        // urlパラメータを取得.
        const urlParams = options.urlParams == undefined ?
            undefined : options.urlParams;
        // bodyが存在して、header.content-lengthが存在しない.
        if (options.body != undefined && options.headers["content-length"] == undefined &&
            options.headers["transfer-encoding"] != "chunked") {
            options.headers["content-length"] = Buffer.byteLength(options.body);
        }
        // hostにhttps://が存在する場合は除外.
        if (options["directURL"] != true && host.startsWith("https://")) {
            host = host.substring(8).trim();
        }
        // 戻りBody型を取得.
        let resultType = options["resultMode"];
        if (resultType == undefined || resultType == null) {
            resultType = "text";
        }
        // クロスアカウント許可.
        options["mode"] = "cors";
        let url = host;
        try {
            // urlを取得.
            url = options["directURL"] == true ?
                host : getUrl(host, path, port, urlParams);
            // fetch実行.
            const response = await fetch(url, options);
            // optionにresponseをセット.
            if (options.response != undefined && options.response != null) {
                // statusとheaderをセット.
                options.response["status"] = response["status"];
                options.response["headers"] = response["headers"]
            }
            // 戻りBody型に応じて返却.
            if (resultType == "text") {
                // text.
                return await response.text();
            } else if (resultType == "json") {
                // json.
                return await response.json();
            } else if (resultType == "blob") {
                // blob.
                return await response.blob();
            }
            // binary.
            return await response.arrayBuffer();
        } catch (err) {
            console.error(
                "[error]medhot: " + options.method +
                " url: " + url);
            throw err;
        }
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.getCredential = getCredential;
    exports.encodeURIToPath = encodeURIToPath;
    exports.convertUrlParams = convertUrlParams;
    exports.signatureV4Step1 = signatureV4Step1;
    exports.signatureV4Step2 = signatureV4Step2;
    exports.signatureV4Final = signatureV4Final;
    exports.signatureV4QueryParameter = signatureV4QueryParameter;
    exports.request = request;

})();