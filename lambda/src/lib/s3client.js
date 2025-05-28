///////////////////////////////////////////////
// S3 client ユーティリティ.
//
// - aws sdk(v2) for javascript
// - aws sdk(v3) s3Client
// などの「比較的巨大なモジュール」に対して
// Lambdaコールドスタート時において、
// 読み込みに4000ミリ秒以上かかる
// (nodejs+128mb).
//
// 代替えとして、S3 向けの REST APIが提供
// されているので、この機能を利用して最小限の
// プログラムでS3のI/Oを行う.
///////////////////////////////////////////////
(function () {
    'use strict'

    // [ENV]メインS3Bucket名.
    const ENV_MAIN_S3_BUCKET = "MAIN_S3_BUCKET";

    // signatureVersion4.
    const asv4 = require("./asv4.js");

    // サービス名.
    const SERVICE = 's3';

    // nextMarker有無情報を格納するHTTPヘッダ名.
    const NEXT_MARKER_NAME = "x-next-marker";

    // 署名URLExpireデフォルト値(1分).
    const PRE_SIGNED_URL_EXPIRE = 60;

    // リージョンを取得.
    // region 対象のregionを設定します.
    // 戻り値: リージョンが返却されます.
    const getRegion = function (region) {
        if (region == undefined || region == null) {
            // 存在しない場合は東京リージョン.
            region = "ap-northeast-1";
        }
        return region;
    }

    // [GET系]s3Host名を生成.
    // 仕様: https://{bucket}.s3-{region}.amazonaws.com/{prefix + object}.
    // region= "us-east-1"の場合は `https://{bucket}.s3.amazonaws.com`
    // bucket 対象のバケット名を設定(string).
    // region 対象のregionを設定(string).
    // 戻り値: host名返却.
    const createGetS3Host = function (bucket, region) {
        // us-east-1の場合は、リージョン名は不要.
        if ("us-east-1" == region) {
            return bucket + "." + SERVICE + ".amazonaws.com";
        }
        // それ以外はリージョン名は必要.
        return bucket + "." + SERVICE + "-" + region +
            ".amazonaws.com";
    }

    // [PUT系]s3Host名を生成.
    // 仕様: https://s3-{region}.amazonaws.com/{bucket}/{prefix + object}.
    // region= "us-east-1"の場合は `https://s3.amazonaws.com`
    // region 対象のregionを設定(string).
    // 戻り値: host名返却.
    const createPutS3Host = function (region) {
        // us-east-1の場合は、リージョン名は不要.
        if ("us-east-1" == region) {
            return SERVICE + ".amazonaws.com";
        }
        // それ以外はリージョン名は必要.
        return SERVICE + "-" + region + ".amazonaws.com";
    }

    // リクエストヘッダを作成.
    // host 接続先のホスト名を設定します.
    // 戻り値: リクエストヘッダ(object)が返却されます.
    const createRequestHeader = function (host) {
        // hostは必須.
        return {
            "Host": host
        };
    }

    // AWSシグニチャーをセット.
    // credential AWSクレデンシャルを設定します.
    //   {accessKey: string, secretAccessKey: string,
    //     sessionToken: string}
    //   - accessKey アクセスキーが返却されます.
    //   - secretAccessKey シークレットアクセスキーが返却されます.
    //   - sessionToken セッショントークンが返却されます.
    //                  状況によっては空の場合があります.
    // region 対象のリージョンを設定します.
    // key 取得対象のS3キー名を設定します.
    // method HTTPメソッドを設定します.
    // headers リクエストヘッダを設定します.
    // queryParams クエリーパラメータを設定します.
    // payload リクエストBodyを設定します.
    const setSignature = function (
        credential, region, key, method, headers, queryParams,
        payload) {
        // クレデンシャルが指定されてない場合は
        // 環境変数からクレデンシャルを取得.
        if (credential == undefined || credential == null) {
            credential = asv4.getCredential();
        }

        // シグニチャーV4を作成.
        let s1 = asv4.signatureV4Step1(
            credential, method, key, queryParams, headers, payload);
        let s2 = asv4.signatureV4Step2(
            headers, region, SERVICE, s1);
        asv4.signatureV4Final(
            headers, credential, region, SERVICE, s1, s2);
    }

    // xmlの１つの要素内容を取得.
    // name xmlの取得対象タグ名を設定します. 
    // xml 対象のXML(string)を設定します.
    // b [pos] のArray条件を設定します.
    // 戻り値 name指定タグに対するstringが返却されます.
    const getXmlElement = function (name, xml, b) {
        const len = name.length;
        // 開始条件を取得.
        let p = xml.indexOf("<" + name + ">", b[0]);
        if (p == -1) {
            // 開始が存在しない場合はnull.
            return null;
        }
        // 開始位置をセット.
        let s = p + len + 2;
        b[0] = s;
        // 終了条件を取得.
        p = xml.indexOf("</" + name + ">", b[0]);
        if (p == -1) {
            // 終端が見つからない場合はエラー.
            throw new Error("\"" + name +
                "\" terminator does not exist.")
        }
        // 次の検索位置をセット.
        b[0] = p + len + 3;
        // 開始位置と終了位置の文字列を取得.
        // 内容の変換にurlDecodeを利用する.
        return decodeURIComponent(
            xml.substring(s, p).trim());
    }

    // listObjectのXMLから必要な内容をJson変換.
    // response 対象のresponseを設定します.
    // xml 対象のXML結果を取得.
    // keyOnly trueの場合、Key名だけを取得します.
    // maxKeys 最大読み込み件数を設定します.
    // 戻り値 json結果が返却されます.
    const resultXmlToJson = function (response, xml, keyOnly, maxKeys) {
        let p, b, n, k, map;
        b = [0];
        let cnt = 0;
        let endKeys = false;
        const ret = [];
        // Key名だけ返却の場合.
        if (keyOnly == true) {
            while (true) {
                // コンテンツ条件を取得.
                if ((p = xml.indexOf("<Contents>", b[0])) == -1) {
                    // 存在しない場合終了.
                    break;
                }
                b[0] = p + 10;
                // Key条件を取得.
                if ((k = getXmlElement("Key", xml, b)) == null) {
                    // Key条件が存在しない場合.
                    break;
                    // prefixのみの場合.
                } else if (k.endsWith("/")) {
                    // 取り込まない
                    continue;
                    // 取得件数を超えてる場合.
                } else if (endKeys) {
                    // 次の内容が存在.
                    response.headers[NEXT_MARKER_NAME] = "true";
                    // 処理終了.
                    return ret;
                }
                // Key名だけ取得.
                ret[cnt++] = k;
                // 取得件数を超えた場合.
                if (maxKeys <= cnt) {
                    // 取得件数を超えた.
                    endKeys = true;
                }
            }
            // 件数が未満なので、次の内容は存在しない.
            response.headers[NEXT_MARKER_NAME] = "false";
            return ret;
        }
        while (true) {
            // コンテンツ条件を取得.
            if ((p = xml.indexOf("<Contents>", b[0])) == -1) {
                // 存在しない場合終了.
                break;
            }
            map = {};
            b[0] = p + 10;
            // Key条件を取得.
            if ((k = getXmlElement("Key", xml, b)) == null) {
                // Key条件が存在しない場合.
                break;
            }
            map["key"] = k;
            // LastModified条件を取得.
            if ((n = getXmlElement("LastModified", xml, b)) == null) {
                // LastModified条件が存在しない場合.
                break;
            }
            map["lastModified"] = n;
            // Size条件を取得.
            if ((n = getXmlElement("Size", xml, b)) == null) {
                // Size条件が存在しない場合.
                break;
            }
            map["size"] = parseInt(n);
            // prefixのみの場合.
            if (k.endsWith("/")) {
                // 取り込まない.
                continue;
                // 取得件数を超えてる場合.
            } else if (endKeys) {
                // 次の内容が存在.
                response.headers[NEXT_MARKER_NAME] = "true";
                return ret;
            }
            ret[cnt++] = map;
            // 取得件数を超えた場合.
            if (maxKeys <= cnt) {
                // 取得件数を超えた.
                endKeys = true;
            }
        }
        // 件数が未満なので、次の内容は存在しない.
        response.headers[NEXT_MARKER_NAME] = "false";
        return ret;
    }

    // nextMarkerが必要判断情報を返却.
    // response 対象のresponseを設定します.
    // xml 対象のxmlテキストを設定します.
    // 戻り値: 存在する場合は"true"で存在しない場合は "false" が返却されます.
    /*const setNextMarker = function(response, xml) {
        // nextMarkerを取得(存在しない場合は"false");
        const nextMarker = getXmlElement(
            "IsTruncated", xml, [0]);
        // nextMarkerが存在する場合はセット.
        if(nextMarker != null) {
            response.headers[NEXT_MARKER_NAME] =
                nextMarker.toLowerCase();
        } else {
            response.headers[NEXT_MARKER_NAME] = "false";
        }
    }*/

    // bucket内容をencodeURIComponentする.
    // bucket 対象のbucketを設定します.
    // 戻り値: encodeURIComponent変換されたパスが返却されます.
    const encodeURIToBucket = function (bucket) {
        bucket = bucket.trim();
        // bucket内に "%" すでにURLEncodeしている場合.
        if (bucket.indexOf("%") != -1) {
            // 処理しない.
            return bucket;
        }
        return encodeURIComponent(bucket);
    }

    // S3書き込みモード: スタンダード.
    const PUT_S3_MODE_STANDARD = "STANDARD";

    // S3書き込みモード: 低冗長化(RRS).
    // ※standardの方が最近は安いので、使わない.
    //const PUT_S3_MODE_REDUCED_REDUNDANCY = "REDUCED_REDUNDANCY";

    // 指定S3オブジェクトをセット.
    // response HTTPレスポンスヘッダ、ステータスが返却されます.
    //          {status: number, headers: {}}
    //          - status レスポンスステータスが返却されます.
    //          - headers レスポンスヘッダが返却されます.
    // region 対象のリージョンを設定します.
    //        指定しない場合は 東京リージョン(ap-northeast-1)が
    //        セットされます.
    // bucket 対象のS3バケット名を設定します.
    // key 対象のS3キー名を設定します.
    // body 対象のBody情報を設定します.
    // credential AWSクレデンシャルを設定します.
    // 戻り値: 対象のS3オブジェクトが返却されます.
    const putObject = async function (
        response, region, bucket, key, body, credential) {
        if (typeof (key) != "string" || key.length == 0) {
            throw new Error("key does not exist.");
        } else if (body == undefined || body == null) {
            throw new Error("body does not exist.");
        }
        // bucket, keyをencodeURL.
        bucket = encodeURIToBucket(bucket);
        key = asv4.encodeURIToPath(key);
        // リージョンを取得.
        region = getRegion(region);
        // ホスト名を取得.
        const host = createPutS3Host(region);
        // メソッド名.
        const method = "PUT";
        // ヘッダを取得.
        const headers = createRequestHeader(host);
        // 文字列の場合、バイナリ変換.
        if (typeof (body) == "string") {
            body = Buffer.from(body);
        }
        // ヘッダ追加.
        headers["content-length"] = "" + body.length;
        headers["x-amz-storage-class"] = PUT_S3_MODE_STANDARD;

        // putの場合パスの先頭にbucket名をセットする.
        key = bucket + "/" + key;

        // シグニチャーを生成.
        setSignature(credential, region, key,
            method, headers, null, body);

        // HTTPSクライアント問い合わせ.
        return await asv4.request(host, key, {
            method: method,
            headers: headers,
            body: body,
            response: response
        });
    }

    // 指定S3オブジェクトを削除.
    // response HTTPレスポンスヘッダ、ステータスが返却されます.
    //          {status: number, headers: {}}
    //          - status レスポンスステータスが返却されます.
    //          - headers レスポンスヘッダが返却されます.
    // region 対象のリージョンを設定します.
    //        指定しない場合は 東京リージョン(ap-northeast-1)が
    //        セットされます.
    // bucket 対象のS3バケット名を設定します.
    // key 対象のS3キー名を設定します.
    // credential AWSクレデンシャルを設定します.
    const deleteObject = async function (
        response, region, bucket, key, credential) {
        if (typeof (key) != "string" || key.length == 0) {
            throw new Error("key does not exist.");
        }
        // bucket, keyをencodeURL.
        bucket = encodeURIToBucket(bucket);
        key = asv4.encodeURIToPath(key);
        // リージョンを取得.
        region = getRegion(region);
        // ホスト名を取得.
        const host = createGetS3Host(bucket, region);
        // メソッド名.
        const method = "DELETE";
        // ヘッダを取得.
        const headers = createRequestHeader(host);

        // keyの整理.
        key = key.trim();
        if (key.startsWith("/")) {
            key = key.substring(1).trim();
        }

        // シグニチャーを生成.
        setSignature(credential, region, key, method, headers);

        // HTTPSクライアント問い合わせ.
        await asv4.request(host, key, {
            method: method,
            headers: headers,
            response: response
        });
    }

    // 指定S3オブジェクトを取得.
    // response HTTPレスポンスヘッダ、ステータスが返却されます.
    //          {status: number, headers: {}}
    //          - status レスポンスステータスが返却されます.
    //          - headers レスポンスヘッダが返却されます.
    // region 対象のリージョンを設定します.
    //        指定しない場合は 東京リージョン(ap-northeast-1)が
    //        セットされます.
    // bucket 対象のS3バケット名を設定します.
    // key 対象のS3キー名を設定します.
    // resultType ResponseBodyの型を設定します.
    //    - text: 文字列で返却します.
    //    - json: JSON形式で返却します.
    //    - それ以外: ArrayBuffer形式で返却します.
    //    設定しない場合は `text` になります.
    // credential AWSクレデンシャルを設定します.
    // 戻り値: 対象のS3オブジェクトが返却されます.
    const getObject = async function (
        response, region, bucket, key, resultType, credential) {
        if (typeof (key) != "string" || key.length == 0) {
            throw new Error("key does not exist.");
        }
        // bucket, keyをencodeURL.
        bucket = encodeURIToBucket(bucket);
        key = asv4.encodeURIToPath(key);
        // リージョンを取得.
        region = getRegion(region);
        // ホスト名を取得.
        const host = createGetS3Host(bucket, region);
        // メソッド名.
        const method = "GET";
        // ヘッダを取得.
        const headers = createRequestHeader(host);

        // keyの整理.
        key = key.trim();
        if (key.startsWith("/")) {
            key = key.substring(1).trim();
        }

        // シグニチャーを生成.
        setSignature(credential, region, key, method, headers);

        // HTTPSクライアント問い合わせ.
        return await asv4.request(host, key, {
            method: method,
            headers: headers,
            resultType: resultType,
            response: response
        });
    }

    // 指定S3オブジェクトのメタデータを取得.
    // response HTTPレスポンスヘッダ、ステータスが返却されます.
    //          {status: number, headers: {}}
    //          - status レスポンスステータスが返却されます.
    //          - headers レスポンスヘッダが返却されます.
    // region 対象のリージョンを設定します.
    //        指定しない場合は 東京リージョン(ap-northeast-1)が
    //        セットされます.
    // bucket 対象のS3バケット名を設定します.
    // key 対象のS3キー名を設定します.
    // credential AWSクレデンシャルを設定します.
    const headObject = async function (
        response, region, bucket, key, credential) {
        if (typeof (key) != "string" || key.length == 0) {
            throw new Error("key does not exist.");
        }
        // bucket, keyをencodeURL.
        bucket = encodeURIToBucket(bucket);
        key = asv4.encodeURIToPath(key);
        // リージョンを取得.
        region = getRegion(region);
        // ホスト名を取得.
        const host = createGetS3Host(bucket, region);
        // メソッド名.
        const method = "HEAD";
        // ヘッダを取得.
        const headers = createRequestHeader(host);

        // keyの整理.
        key = key.trim();
        if (key.startsWith("/")) {
            key = key.substring(1).trim();
        }

        // シグニチャーを生成.
        setSignature(credential, region, key, method, headers);

        // HTTPSクライアント問い合わせ.
        await asv4.request(host, key, {
            method: method,
            headers: headers,
            response: response
        });
    }

    // 指定S3バケット+プレフィックスのリストを取得.
    // １度に取得できるサイズは最大1000件.
    // response HTTPレスポンスヘッダ、ステータスが返却されます.
    //          {status: number, headers: {}}
    //          - status レスポンスステータスが返却されます.
    //          - headers レスポンスヘッダが返却されます.
    // region 対象のリージョンを設定します.
    //        指定しない場合は 東京リージョン(ap-northeast-1)が
    //        セットされます.
    // bucket 対象のS3バケット名を設定します.
    // prefix 対象のS3プレフィックス名を設定します.
    // options {maxKeys: number, delimiter: string, marker: string}
    //   - maxKeys 最大読み込み件数を設定します.
    //       設定しない場合500がセットされます.
    //   - delimiter マーカーを設定します.
    //   - marker 前のlistObject処理で response.headers["x-next-marker"]
    //            情報がtrueの場合、一番最後の取得したKey名を設定します.
    //   - keyOnly trueの場合Key名だけ取得します.
    // credential AWSクレデンシャルを設定します.
    // 戻り値: リスト情報が返却されます.
    //         options.keyOnly == true以外の場合.
    //         [{key: string, lastModified: string, size: number} ... ]
    //         - key: オブジェクト名.
    //         - lastModified: 最終更新時間(yyyy/MM/ddTHH:mm:ssZ).
    //         - size: ファイルサイズ.
    //         options.keyOnly == trueの場合.
    //         [key, key, ...]
    //         Arrayに取得Key一覧が返却されます.
    const listObject = async function (
        response, region, bucket, prefix, options, credential) {
        if (typeof (prefix) != "string") {
            throw new Error("prefix does not exist.");
        }
        // optionsが未設定.
        if (options == undefined || options == null) {
            options = {};
        }
        // bucket, prefixをencodeURL.
        bucket = encodeURIToBucket(bucket);
        prefix = asv4.encodeURIToPath(prefix);
        // リージョンを取得.
        region = getRegion(region);
        // ホスト名を取得.
        const host = createGetS3Host(bucket, region);
        // メソッド名.
        const method = "GET";
        // ヘッダを取得.
        const headers = createRequestHeader(host);

        // prefixの整理.
        prefix = prefix.trim();
        if (prefix.startsWith("/")) {
            prefix = prefix.substring(1).trim();
        }

        // 最大読み込み数を数字変換.
        options.maxKeys = options.maxKeys | 0;
        if (options.maxKeys <= 0 || options.maxKeys >= 500) {
            if (options.maxKeys >= 500) {
                options.maxKeys = 500;
            } else {
                options.maxKeys = 100;
            }
        }
        // 設定されているmaxKeyを取得.
        const maxKeys = options.maxKeys;
        // 余分に取得する
        // 指定値の20%UP + 5の数字で取得.
        // maxKeys = 100 の場合、125で取得する.
        options.maxKeys = (((maxKeys * 1.2) + 0.5) | 0) + 5;

        // パラメータをセット.
        let urlParams = {
            "encoding-type": "url", // レスポンスオブジェクトのエンコードタイプ.
            "max-keys": options.maxKeys, // 最大読み込み件数(default 100 max 500).
            "prefix": prefix // 読み込みプレフィックス.
        }

        // delimiterが設定されている場合.
        if (typeof (options.delimiter) == "string") {
            urlParams["delimiter"] = asv4.encodeURIToPath(
                options.delimiter);
        }

        // markerが設定されている場合.
        if (typeof (options.marker) == "string") {
            urlParams["marker"] = options.marker;
        }

        // パラメータはUrlParams処理しない.
        //urlParams = asv4.convertUrlParams(urlParams);

        // シグニチャーを生成.
        setSignature(credential, region, "", method, headers,
            urlParams);

        // HTTPSクライアント問い合わせ.
        const xml = await asv4.request(host, "", {
            method: method,
            headers: headers,
            resultType: "text",
            urlParams: urlParams,
            response: response
        });

        // ステータスが400以上の場合.
        if (response.status >= 400) {
            // 空返却.
            return [];
        }

        // nextMarkerが必要判断情報を返却.
        //setNextMarker(response, xml);

        // xmlのリスト情報をJSON変換.
        return resultXmlToJson(
            response, xml, options.keyOnly, maxKeys);
    }

    // 署名URLを取得.
    // region リージョンを設定します.
    // method HTTPメソッドを設定します.
    // bucket 署名URL発行先のs3Bucket名を設定します.
    // key 署名URL発行先のs3Predix+Key名を設定します.
    // expire 署名URLのexpire値を秒で指定します.
    // headers 設定したいHTTPヘッダを設定します.
    // credential AWSクレデンシャルを設定します.
    // 戻り値: 署名URLが返却されます.
    const preSignedUrl = function (
        region, method, bucket, key, expire, headers, credential) {
        // クレデンシャルが指定されてない場合は
        // 環境変数からクレデンシャルを取得.
        if (credential == undefined || credential == null) {
            credential = asv4.getCredential();
        }
        // ヘッダが存在しない場合.
        if (headers == undefined || headers == null) {
            headers = {};
        }
        // リージョンが存在しない場合のデフォルト設定.
        region = getRegion(region);
        // bucket名のスラッシュを除外.
        if (bucket.endsWith("/")) {
            bucket = bucket.substring(0, bucket.length - 1);
        }
        // key名のスラッシュを除外.
        if (key.startsWith("/")) {
            key = key.substring(1);
        }
        // endpointのURLを設定.
        let endpointUrl;
        if (region == "us-east-1") {
            endpointUrl = "https://s3.amazonaws.com/" + bucket + "/" + key;
        } else {
            endpointUrl = "https://s3-" + region + ".amazonaws.com/" + bucket + "/" + key;
        }
        // expire値のチェック.
        expire = expire | 0;
        // 無効なexpire値.
        if (expire <= 0) {
            // デフォルトのexpire値は1分.
            expire = PRE_SIGNED_URL_EXPIRE;
        }
        // クエリーパラメータを設定.
        const queryParams = {
            "X-Amz-Expires": "" + expire
        }
        // 署名URLを発行.
        const ret = endpointUrl + "?" + asv4.signatureV4QueryParameter(
            credential, endpointUrl, method.toUpperCase(), SERVICE, region,
            headers, queryParams, "UNSIGNED-PAYLOAD"
        );

        return ret;
    }

    // バケット名が指定されない場合は、環境変数で定義された
    // バケット情報を利用する.
    // bucket 設定バケット名を設定します.
    // 戻り値: バケット名が返却されます.
    const _getBucketName = function (bucket) {
        // 空セットの場合.
        if (bucket == null || bucket == undefined ||
            bucket.length == 0) {
            // 環境変数から取得.
            bucket = process.env[ENV_MAIN_S3_BUCKET];
            if (bucket == null || bucket == undefined ||
                bucket.length == 0) {
                throw new Error("Bucket name is empty.");
            }
        }
        return bucket;
    }

    // S3Clientを取得.
    // region 対象のリージョンを設定します.
    // credential AWSクレデンシャルを設定します.
    //   {accessKey: string, secretAccessKey: string,
    //     sessionToken: string}
    //   - accessKey アクセスキーが返却されます.
    //   - secretAccessKey シークレットアクセスキーが返却されます.
    //   - sessionToken セッショントークンが返却されます.
    //                  状況によっては空の場合があります.
    // 戻り値: S3Clientが返却されます.
    const create = function (region, credential) {

        /////////////////////////////////////////////////////
        // オブジェクト群.
        /////////////////////////////////////////////////////
        const ret = {};

        // 条件を指定してS3Bucket+Prefixのリスト情報を取得.
        // params {Bucket: string, Prefix: string}
        //         - [必須]Bucket 対象のbucket名を設定します.
        //         - [必須]Prefix 対象のprefix名を設定します.
        //         - [任意]MaxKeys 最大取得数を設定します(1 - 1000).
        //         - [任意]Delimiter 取得階層の範囲を設定します.
        //                          "/" を設定した場合は指定prefixが"/"の階層の範囲を
        //                         リスト取得します.
        //         - [任意]Marker 前のlistObject処理で response.headers["x-next-marker"]
        //                  情報が"true"の場合、一番最後の取得したKey名(prefix+key)を設定します.
        //         - [任意]KeyOnly trueの場合Key名だけ取得します.
        //        またparams.responseが設定されます.
        //        {status: number, headers: object}
        // 戻り値: {nextMarker, list} が返却されます.
        //          - nextMarker:
        //             null以外は残りのリスト情報が存在します.
        //             存在する場合は、引き続き取得する場合は listObjectsのparamsの `Marker` に設定します.
        //         - list 
        //             KeyOnly = trueの場合.
        //             [string, string, string ....]
        //                Arrayに対して、Key名が入ります.
        //             KeyOnly = true以外の場合.
        //             [{key: string, lastModified: string, size: number} ... ]
        //               - key: オブジェクト名.
        //               - lastModified: 最終更新時間(yyyy/MM/ddTHH:mm:ssZ).
        //               - size: ファイルサイズ.
        ret.listObjects = async function (params) {
            // バケット名を取得.
            const bucket = _getBucketName(params.Bucket);
            const options = {
                maxKeys: params.MaxKeys,
                delimiter: params.Delimiter,
                marker: params.Marker,
                keyOnly: params.KeyOnly
            };
            // リスト取得.
            const response = {};
            params.response = response;
            // nextMarkerをリセット.
            const ret = await listObject(
                response, region, bucket, params.Prefix,
                options, credential);
            // レスポンスステータスが400以上の場合エラー.
            if (response.status >= 400) {
                throw new Error("[ERROR: " + response.status +
                    "]getList bucket: " + bucket +
                    " prefix: " + params.Prefix);
            }
            // リストの続きが存在する場合.
            let nextMarker = null;
            if (response[NEXT_MARKER_NAME] == "true") {
                if (ret.length > 0) {
                    // 最終のMarkerを取得する.
                    const last = ret[ret.length - 1];
                    // keyOnly取得.
                    if (typeof (last) == "string") {
                        nextMarker = last;
                        // 要素取得.
                    } else {
                        nextMarker = last.key;
                    }
                }
            }
            return {
                nextMarker: nextMarker, // 次のリスト.存在しない場合はnull.
                list: ret // リスト情報.
            };
        }

        // 条件を指定してS3Bucket+Keyのメタ情報を取得.
        // params {Bucket: string, Key: string}
        //         - [必須]Bucket 対象のbucket名を設定します.
        //         - [必須]Key 対象のkey名を設定します.
        //        またparams.responseが設定されます.
        //        {status: number, headers: object}
        // 戻り値: {lastModified: string, size: number}
        //         - lastModified: 最終更新時間(yyyy/MM/ddTHH:mm:ssZ).
        //         - size: ファイルサイズ.
        ret.headObject = async function (params) {
            // バケット名を取得.
            const bucket = _getBucketName(params.Bucket);
            // オブジェクト取得.
            const response = {};
            params.response = response;
            const ret = await headObject(
                response, region, bucket, params.Key, credential);
            // レスポンスステータスが400以上の場合エラー.
            if (response.status >= 400) {
                throw new Error("[ERROR: " + response.status +
                    "]headObject bucket: " + bucket + " key: " +
                    params.Key);
            }
            return ret;
        };

        // 条件を指定してS3Bucket+Key情報を取得.
        // params {Bucket: string, Key: string, resultType: string}
        //         - [必須]Bucket 対象のbucket名を設定します.
        //         - [必須]Key 対象のkey名を設定します.
        //         - [任意]resultType Body結果の変換条件を設定します.
        //           - text: 文字列で返却します.
        //           - json: jsonで返却します.
        //           - それ以外: ArrayBufferで返却されます.
        //           設定しない場合は `text` が設定されます.
        //        またparams.responseが設定されます.
        //        {status: number, headers: object}
        // 戻り値: 処理結果のBody情報が返却されます.
        ret.getObject = async function (params) {
            // バケット名を取得.
            const bucket = _getBucketName(params.Bucket);
            // オブジェクト取得.
            const response = {};
            params.response = response;
            const ret = await getObject(
                response, region, bucket, params.Key, params.gzip,
                credential);
            // レスポンスステータスが400以上の場合エラー.
            if (response.status >= 400) {
                throw new Error("[ERROR: " + response.status +
                    "]getObject bucket: " + bucket + " key: " +
                    params.Key);
            }
            return ret;
        };

        // 条件を指定してS3Bucket+Key情報にBodyをセット.
        // params {Bucket: string, Key: string, Body: string or Buffer}
        //         - [必須]Bucket 対象のbucket名を設定します.
        //         - [必須]Key 対象のkey名を設定します.
        //         - [必須]Body 対象のbody情報を設定します.
        //        またparams.responseが設定されます.
        //        {status: number, headers: object}
        // 戻り値: trueの場合、正常に設定されました.
        ret.putObject = async function (params) {
            // バケット名を取得.
            const bucket = _getBucketName(params.Bucket);
            // bodyをput.
            const response = {};
            params.response = response;
            await putObject(
                response, region, bucket, params.Key,
                params.Body, credential);
            // レスポンスステータスが400以上の場合エラー.
            if (response.status >= 400) {
                throw new Error("[ERROR: " + response.status +
                    "]putObject bucket: " + bucket + " key: " +
                    params.Key);
            }
            return response.status <= 299;
        }

        // 条件を指定してS3Bucket+Key情報を削除.
        // params {Bucket: string, Key: string}
        //         - Bucket 対象のbucket名を設定します.
        //         - Key 対象のkey名を設定します.
        //        またparams.responseが設定されます.
        //        {status: number, headers: object}
        // 戻り値: trueの場合、正常に設定されました.
        ret.deleteObject = async function (params) {
            // バケット名を取得.
            const bucket = _getBucketName(params.Bucket);
            // オブジェクト取得.
            const response = {};
            params.response = response;
            const result = await deleteObject(
                response, region, bucket, params.Key, credential);
            // レスポンスステータスが400以上の場合エラー.
            if (response.status >= 400) {
                throw new Error("[ERROR: " + response.status +
                    "]deleteObject bucket: " + bucket + " key: " +
                    params.Key + " message: " + Buffer.from(result).toString());
            }
            return response.status <= 299;
        }

        // 署名付きダウンロードURLを取得.
        // params {Bucket: string, Key: string, Expire}
        //         - [必須]Bucket ダウンロード対象のS3bucket名を設定します.
        //         - [必須]Key ダウンロード対象のS3のkey名を設定します.
        //         - [任意]Expire 署名URLの寿命を秒単位で設定します.
        //                 設定しない場合は任意の値(60秒)が設定されます.
        // 戻り値：署名付きダウンロードURLが返却されます.
        ret.getPreSignedUrl = function (params) {
            // 署名付きダウンロードURLを返却.
            return preSignedUrl(
                region, "GET", _getBucketName(params.Bucket), params.Key,
                params.Expire, null, credential);
        }

        return ret;
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    // restAPI用.
    exports.NEXT_MARKER_NAME = NEXT_MARKER_NAME;
    exports.putObject = putObject;
    exports.deleteObject = deleteObject;
    exports.getObject = getObject;
    exports.headObject = headObject;
    exports.listObject = listObject;
    exports.preSignedUrl = preSignedUrl;

    // s3client用.
    exports.create = create;

})();