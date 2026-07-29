///////////////////////////////////////////////////////////
// AWS Signature(version4).
// AWS のサービスに rest Apiでアクセスするための
// シグニチャーを計算する.
///////////////////////////////////////////////////////////
(function (_g) {
    'use strict'

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

    // credential取得先のENV.
    let TARGET_ENV_AWS_ACCESS_KEY = "AWS_ACCESS_KEY_ID";
    let TARGET_ENV_AWS_SECRET_KEY = "AWS_SECRET_ACCESS_KEY";
    let TARGET_ENV_AWS_SESSION_TOKEN = "AWS_SESSION_TOKEN";

    // credential取得先のEnv名をセット.
    // accessKey アクセスキーの環境変数名を設定します.
    // secretAccessKey シークレットアクセスキーの環境変数名を設定します.
    // sessionToken セッショントークンの環境変数名を設定します.
    const setCredentailEnv = function (accessKey, secretAccessKey, sessionToken) {
        if (typeof (accessKey) == "string") {
            TARGET_ENV_AWS_ACCESS_KEY = accessKey;
        } else {
            TARGET_ENV_AWS_ACCESS_KEY = "AWS_ACCESS_KEY_ID";
        }
        if (typeof (secretAccessKey) == "string") {
            TARGET_ENV_AWS_SECRET_KEY = secretAccessKey;
        } else {
            TARGET_ENV_AWS_SECRET_KEY = "AWS_SECRET_ACCESS_KEY"
        }
        if (typeof (sessionToken) == "string") {
            TARGET_ENV_AWS_SESSION_TOKEN = sessionToken;
        } else {
            TARGET_ENV_AWS_SESSION_TOKEN = "AWS_SESSION_TOKEN";
        }
    }

    // デフォルトのクレデンシャルを取得.
    // 戻り値: {accessKey: string, secretAccessKey: string,
    //           sessionToken: string}
    //         - accessKey アクセスキーが返却されます.
    //         - secretAccessKey シークレットアクセスキーが返却されます.
    //         - sessionToken セッショントークンが返却されます.
    //                        状況によっては空の場合があります.
    const getCredential = function () {
        if (DEFAULT_CREDENTIAL == null) {
            const props = PropertiesService.getScriptProperties();
            DEFAULT_CREDENTIAL = {
                accessKey: props.getProperty(TARGET_ENV_AWS_ACCESS_KEY),
                secretAccessKey: props.getProperty(TARGET_ENV_AWS_SECRET_KEY),
                sessionToken: props.getProperty(TARGET_ENV_AWS_SESSION_TOKEN)
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

    // 対象オブジェクトがBlobかチェック.
    const isBlob = function (o) {
        if (o == null || o == undefined) {
            // false扱いで返却されるが newBlob対象にはならないので注意.
            return false;
        }
        else if (typeof (o["copyBlob"]) == 'function') {
            return true;
        }
        return false;
    }

    // GAS: Utilitiesでの sha256系の返却共通処理.
    const _returnSHa256 = function (ret, returnMode) {
        // GASのユーティリティでは、byte=127以上はマイナスになるようなので
        // マイナス値の場合は 256を足す.
        const len = ret.length;
        for (let i = 0; i < len; i++) {
            if (ret[i] < 0) {
                ret[i] = 256 + ret[i];
            }
        }
        // 返却モードがhexの場合は hex文字変換を行う.
        if ((returnMode || "").trim().toLowerCase() == "hex") {
            let rstr = "";
            for (let i = 0; i < len; i++) {
                rstr += ret[i].toString(16).padStart(2, "0").toLowerCase();
            }
            return rstr;
        }
        return ret;
    }

    // 16進数文字列変換.
    const _DHEX_16 = {
        "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
        "8": 8, "9": 9, "a": 10, "b": 11, "c": 12, "d": 13, "e": 14, "f": 15
    };

    // hex文字列をバイナリ(配列)に変換する.
    const _decodeHex = function (value) {
        value = value.trim().toLowerCase();
        const ret = [];
        const len = value.length;
        for (let i = 0; i < len; i += 2) {
            ret[ret.length] =
                (_DHEX_16[value[i]] << 4) |
                (_DHEX_16[value[i + 1]]);
        }
        return ret;
    }

    // hmacSHA256で変換.
    // key 対象のキー
    // msg 対象のメッセージ
    // returnMode 何も設定しないや hex を設定した場合16進数文字列が返却されます.
    //            それ以外はBinaryの文字列が返却されます.
    // keyFormat keyのFormatを設定します.
    //            "TEXT" | "HEX" | "BYTES"
    // msgFormat msgのFormatを設定します.
    //            "TEXT" | "HEX" | "BYTES"
    // 戻り値 returnMode: に従って返却されます.
    const hmacSHA256 = function (key, msg, returnMode, keyFormat = "TEXT", msgFormat = "TEXT") {
        // formatがhexの場合はバイナリ変換.
        if (keyFormat != undefined && keyFormat != null &&
            keyFormat.trim().toUpperCase() == "HEX") {
            key = _decodeHex(key);
        } else if (isBlob(key)) {
            // blobの場合はバイナリ変換.
            key = key.getBytes();
        }
        // formatがhexの場合はバイナリ変換.
        if (msgFormat != undefined && msgFormat != null &&
            msgFormat.trim().toUpperCase() == "HEX") {
            msg = _decodeHex(msg);
        } else if (isBlob(msg)) {
            // blobの場合はバイナリ変換.
            msg = msg.getBytes();
        }
        // stringとArrayだとエラーになるので stringの場合は
        // Arrayに変換する.
        const k = typeof (key);
        const m = typeof (msg);
        if (k != m) {
            if (k == "string") {
                key = Utilities.newBlob(key).getBytes();
            }
            if (m == "string") {
                msg = Utilities.newBlob(msg).getBytes();
            }
        }
        return _returnSHa256(
            Utilities.computeHmacSha256Signature(msg, key), returnMode);
    }

    // sha256変換.
    // msg 対象のメッセージ.
    // returnMode hex を設定した場合16進数文字列が返却されます.
    //            それ以外はBinaryの文字列が返却されます.
    // msgFormat msgのFormatを設定します.
    //            "TEXT" | "HEX" | "BYTES"
    // 戻り値 returnMode: に従って返却されます.
    const sha256 = function (msg, returnMode, msgFormat = "TEXT") {
        // formatがhexの場合はバイナリ変換.
        if (msgFormat != undefined && msgFormat != null &&
            msgFormat.trim().toUpperCase() == "HEX") {
            msg = _decodeHex(msg);
        } else if (isBlob(msg)) {
            // blobの場合はバイナリ変換.
            msg = msg.getBytes();
        }
        return _returnSHa256(
            Utilities.computeDigest(
                Utilities.DigestAlgorithm.SHA_256, msg), returnMode);
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
        // AWS仕様(パラメータ名でソートし、名前が同じ場合のみ値でソート)に
        // 合わせるため、"key=value"の結合済み文字列ではなく、encode済みkey
        // 単体でソートする("a"と"a9"のような前方一致キーが混在する場合、
        // 結合済み文字列ソートだと"="(0x3D)と数字(0x30-0x39)のASCII順の
        // 関係でキー単体のソート結果と食い違うことがあるため).
        const keys = [];
        for (let k in urlParams) {
            keys[keys.length] = [encodeURIComponent(k), k];
        }
        keys.sort(function (a, b) {
            a = a[0]; b = b[0];
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }
            return 0;
        });
        const len = keys.length;
        let ret = "";
        for (let i = 0; i < len; i++) {
            if (i != 0) {
                ret += "&";
            }
            ret += keys[i][0] + "=" + encodeURIComponent(urlParams[keys[i][1]]);
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
        // CanonicalURIとしてURIエンコードする(署名対象のAWS REST APIで
        // スペース・日本語等percent-encodeが必要な文字を含むパスを扱う場合、
        // これを行わないとAWS側の計算結果と一致せずSignatureDoesNotMatchに
        // なるため必須).
        path = encodeURIToPath(path);
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
            //header["x-amz-content-sha256"] = sha256(payload, "hex");
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
        //const hashedCanonicalRequest = sha256(canonicalRequest, "hex");
        // sha256 + hex変換.
        const hashedCanonicalRequest = sha256(canonicalRequest, "hex", "TEXT");
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

        /*
        // シグニチャーキー生成.
        let signature = SCHEME + credential["secretAccessKey"];
        signature = hmacSHA256(signature, step2Result["dateText"]);
        signature = hmacSHA256(signature, region);
        signature = hmacSHA256(signature, service);
        signature = hmacSHA256(signature, END_SCOPE);
        signature = hmacSHA256(signature, step2Result["stringToSign"], "hex");
        */
        let signature = SCHEME + credential["secretAccessKey"];
        signature = hmacSHA256(signature, step2Result["dateText"], "hex", "TEXT", "TEXT");
        signature = hmacSHA256(signature, region, "hex", "HEX", "TEXT");
        signature = hmacSHA256(signature, service, "hex", "HEX", "TEXT");
        signature = hmacSHA256(signature, END_SCOPE, "hex", "HEX", "TEXT");

        // 署名を計算する.
        signature = hmacSHA256(
            signature,
            step2Result["stringToSign"],
            "hex", "HEX", "TEXT"
        );

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

    // AWSシグニチャーをセット.
    // service AWSサービス名を設定します.
    // credential AWSクレデンシャルを設定します.
    //   {accessKey: string, secretAccessKey: string,
    //     sessionToken: string}
    //   - accessKey アクセスキーが返却されます.
    //   - secretAccessKey シークレットアクセスキーが返却されます.
    //   - sessionToken セッショントークンが返却されます.
    //                  状況によっては空の場合があります.
    // region 対象のリージョンを設定します.
    // path 対象のURLパスを設定します.
    // method HTTPメソッドを設定します.
    // headers リクエストヘッダを設定します.
    // queryParams クエリーパラメータを設定します.
    // payload リクエストBodyを設定します.
    const setSignature = function (
        service, credential, region, path, method, headers, queryParams,
        payload) {
        // クレデンシャルが指定されてない場合は
        // 環境変数からクレデンシャルを取得.
        if (credential == undefined || credential == null) {
            credential = getCredential();
        }

        // シグニチャーV4を作成.
        let s1 = signatureV4Step1(
            credential, method, path, queryParams, headers, payload);
        let s2 = signatureV4Step2(
            headers, region, service, s1);
        signatureV4Final(
            headers, credential, region, service, s1, s2);
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
            //sha256(canonicalRequest, "hex");
            sha256(canonicalRequest, "hex", "TEXT");
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
        /*
        signature = hmacSHA256(signature, dateStamp);
        signature = hmacSHA256(signature, getRegion(regionName));
        signature = hmacSHA256(signature, serviceName);
        signature = hmacSHA256(signature, END_SCOPE);
        signature = hmacSHA256(signature, stringToSign, "hex");
        */
        signature = hmacSHA256(signature, dateStamp, "hex", "TEXT", "TEXT");
        signature = hmacSHA256(signature, getRegion(regionName), "hex", "HEX", "TEXT");
        signature = hmacSHA256(signature, serviceName, "hex", "HEX", "TEXT");
        signature = hmacSHA256(signature, END_SCOPE, "hex", "HEX", "TEXT");
        signature = hmacSHA256(signature, stringToSign, "hex", "HEX", "TEXT");
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

    // 対象Bodyのバイナリ長を取得.
    const getBodyLength = function (body) {
        if (isBlob(body)) {
            return body.getBytes().length;
        } else if (Array.isArray(body)) {
            return body.length;
        }
        // 一旦Blob変換してバイナリ長を返却.
        return Utilities.newBlob(
            body, MimeType.PDF, "unknown").getBytes().length;
    }

    // body返却関数.
    const _resultBody = function (type, response, charset) {
        switch (type) {
            case "blob":
                return response.getBlob();
            case "binary": case "bytes":
                return response.getContent();
            case "string": case "text":
                return response.getContentText(charset);
            case "json":
                return JSON.parse(response.getContentText(charset))
        }
        // type = その他 = text.
        return response.getContentText(charset);
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
    //    - binary: binary形式で返却します.
    //    - blob: blob形式で返却します.
    //    設定しない場合は `text` になります.
    // 戻り値: bodyが返却されます.
    const request = function (host, path, options) {
        // optionsが存在しない場合.
        if (options == undefined || options == null) {
            options = {};
        }
        let charset = "utf8";
        if (typeof (options.charset) == "string") {
            charset = options.charset;
        }
        // requestメソッドを取得.
        options.method = options.method == undefined ?
            "GET" : options.method.toUpperCase();
        // requestヘッダを取得.
        options.headers = options.headers == undefined ?
            {} : convertHeaderToLowerKey(options.headers);
        // requestBodyを取得.
        let body = options.payload;
        if (body == undefined) {
            body = options.body;
            delete options.body
        }
        /*
        // bodyがblobの場合.
        if (!isBlob(body)) {
            // コンテンツタイプが存在しない場合はセット.
            if (options.headers["content-type"] == undefined) {
                options.headers["content-type"] = body.getContentType();
            }
            // バイナリに変換.
            body = body.getBytes();
        }
        */
        // bodyが blob以外の場合.
        // ただし body == undefined or null の場合は変換しない.
        if (body != undefined && body != null && !isBlob(body)) {
            let mime = "application/octet-stream";
            if (typeof (options.headers["content-type"]) == "string") {
                mime = options.headers["content-type"];
            }
            // blobに変換.
            body = Utilities.newBlob(body, mime);
        }
        options.payload = body;
        // httpsPortを取得.
        const port = options.port == undefined ?
            "" : options.port;
        // urlパラメータを取得.
        const urlParams = options.urlParams == undefined ?
            undefined : options.urlParams;
        // bodyが存在して、header.content-lengthが存在しない.
        if (options.payload != undefined && options.headers["content-length"] == undefined &&
            options.headers["transfer-encoding"] != "chunked") {
            options.headers["content-length"] = getBodyLength(options.payload);
        }
        // hostにhttps://が存在する場合は除外.
        if (options["directURL"] != true && host.startsWith("https://")) {
            host = host.substring(8).trim();
        }
        // クロスアカウント許可.
        //options["mode"] = "cors";
        let url = host;
        try {
            // urlを取得.
            url = options["directURL"] == true ?
                host : getUrl(host, path, port, urlParams);
            // その他GAS用UrlFetchAppパラメータをセット.
            options["muteHttpExceptions"] = true;
            options["validateHttpsCertificates"] = false;
            // UrlFetchApp.fetch実行において、以下ヘッダ設定がNGなので、削除.
            delete options.headers["host"];
            delete options.headers["content-length"];
            // fetch実行.
            //const response = await fetch(url, options);
            const response = UrlFetchApp.fetch(url, options);

            // optionにresponseをセット.
            if (options.response != undefined && options.response != null) {
                // statusとheaderをセット.
                options.response["status"] = parseInt(response.getResponseCode())
                options.response["headers"] = convertHeaderToLowerKey(response.getHeaders());
                options.response["result"] = response;
            }
            // 戻りBody型を取得.
            let resultType = options["resultType"];
            if (resultType == undefined || resultType == null) {
                resultType = "text";
            }
            return _resultBody(resultType, response, charset);
        } catch (err) {
            console.error(
                "[error]url fetch medhot: " + options.method +
                " url: " + url);
            throw err;
        }
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    _g.setCredentailEnv = setCredentailEnv;
    _g.getCredential = getCredential;
    _g.encodeURIToPath = encodeURIToPath;
    _g.convertUrlParams = convertUrlParams;
    _g.signatureV4Step1 = signatureV4Step1;
    _g.signatureV4Step2 = signatureV4Step2;
    _g.signatureV4Final = signatureV4Final;
    _g.setSignature = setSignature;
    _g.signatureV4QueryParameter = signatureV4QueryParameter;
    _g.request = request;

})(this);
