///////////////////////////////////////////////
// S3 署名付きURL(Pre-signed URL)生成モジュール(AWS SigV4).
//
// Lambda Function URLのペイロード上限(6MB)を回避し、
// S3への直接アップロード(PUT)やセキュアな一時ダウンロード(GET)
// を行うための署名付きURLを生成する.
//
// llrt(Low Latency Runtime)およびNode.jsで動作し、
// 外部の追加ライブラリ(@aws-sdk/s3-request-presigner等)に依存せず
// node:crypto (HMAC-SHA256 / SHA256) のみで完全な AWS SigV4 署名を生成する.
//
// tools/localAws.js (ローカルS3エミュレータ)および実AWS S3に対応.
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = typeof $require === "function" ? $require("crypto") : require("crypto");

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // デフォルト有効期限(秒) - 15分.
    const _DEF_EXPIRES_IN = 900;

    // 最大有効期限(秒) - 7日間 (SigV4の仕様上の上限).
    const _MAX_EXPIRES_IN = 604800;

    // RFC 3986 準拠のパーセントエンコード.
    // encodeURIComponent は !'()* をエンコードしないため、SigV4仕様に合わせて補正.
    const _rfc3986 = function (str) {
        return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
            return "%" + c.charCodeAt(0).toString(16).toUpperCase();
        });
    };

    // パスをRFC 3986準拠でエンコード(スラッシュ区切りを維持).
    const _encodePath = function (pathStr) {
        return pathStr.split("/").map(_rfc3986).join("/");
    };

    // prefixを整形.
    const _prefix = function (prefix) {
        if (!prefix) return "";
        if (prefix.startsWith("/")) {
            prefix = prefix.substring(1);
        }
        if (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length - 1);
        }
        return prefix;
    };

    // keyを整形.
    const _key = function (key) {
        if (!key) return "";
        if (key.startsWith("/")) {
            key = key.substring(1);
        }
        return key;
    };

    // prefixとkeyを結合.
    const _prefixKey = function (prefix, key) {
        key = _key(key);
        if (prefix != undefined && prefix != null && prefix !== "") {
            return _prefix(prefix) + "/" + key;
        }
        return key;
    };

    // HMAC-SHA256のバイナリダイジェストを計算.
    const _hmac = function (key, data) {
        return crypto.createHmac("sha256", key).update(data).digest();
    };

    // SHA-256のHexダイジェストを計算.
    const _hashHex = function (data) {
        return crypto.createHash("sha256").update(data).digest("hex");
    };

    // 2桁ゼロ埋め.
    const _pad2 = function (n) {
        return n < 10 ? "0" + n : "" + n;
    };

    // 日時文字列(amzDate: YYYYMMDDTHHMMSSZ, dateStamp: YYYYMMDD)を生成.
    const _formatDates = function (dateObj) {
        const d = dateObj || new Date();
        const year = d.getUTCFullYear();
        const month = _pad2(d.getUTCMonth() + 1);
        const day = _pad2(d.getUTCDate());
        const hours = _pad2(d.getUTCHours());
        const minutes = _pad2(d.getUTCMinutes());
        const seconds = _pad2(d.getUTCSeconds());

        const dateStamp = "" + year + month + day;
        const amzDate = dateStamp + "T" + hours + minutes + seconds + "Z";
        return { dateStamp: dateStamp, amzDate: amzDate };
    };

    // 環境変数等からクレデンシャルを取得.
    const _getCredentials = function (optionsCredentials, localEndpoint) {
        if (optionsCredentials != null && optionsCredentials.access_key != null) {
            return {
                accessKeyId: optionsCredentials.access_key,
                secretAccessKey: optionsCredentials.secret_access_key,
                sessionToken: optionsCredentials.session_token
            };
        }
        if (optionsCredentials != null && optionsCredentials.accessKeyId != null) {
            return {
                accessKeyId: optionsCredentials.accessKeyId,
                secretAccessKey: optionsCredentials.secretAccessKey,
                sessionToken: optionsCredentials.sessionToken
            };
        }
        const envAccessKey = process.env["AWS_ACCESS_KEY_ID"];
        const envSecretKey = process.env["AWS_SECRET_ACCESS_KEY"];
        const envSessionToken = process.env["AWS_SESSION_TOKEN"];
        if (envAccessKey) {
            return {
                accessKeyId: envAccessKey,
                secretAccessKey: envSecretKey,
                sessionToken: envSessionToken
            };
        }
        if (localEndpoint != null) {
            return {
                accessKeyId: "local",
                secretAccessKey: "local",
                sessionToken: null
            };
        }
        return null;
    };

    // エンドポイント・ホスト・URLパスの解決.
    // 戻り値: { protocol, host, canonicalUri, baseUrl }
    const _resolveEndpoint = function (bucket, fullKey, region, options, localEndpoint) {
        let customEndpoint = options.endpoint !== undefined ? options.endpoint : localEndpoint;
        if (customEndpoint === null || customEndpoint === false) {
            customEndpoint = null;
        }

        let forcePathStyle = options.forcePathStyle;
        if (forcePathStyle === undefined) {
            forcePathStyle = customEndpoint != null;
        }

        let protocol = "https:";
        let host = "";
        let canonicalUri = "";
        let baseUrl = "";

        if (customEndpoint) {
            // ローカル/カスタムエンドポイント指定 (例: http://localhost:9911, https://s3.example.com)
            let endpointStr = "" + customEndpoint;
            if (!endpointStr.startsWith("http://") && !endpointStr.startsWith("https://")) {
                endpointStr = "http://" + endpointStr;
            }
            // 末尾のスラッシュを除去
            if (endpointStr.endsWith("/")) {
                endpointStr = endpointStr.substring(0, endpointStr.length - 1);
            }
            const urlObj = new URL(endpointStr);
            protocol = urlObj.protocol;
            host = urlObj.host; // host:portを含む

            const isIpOrLocalhost = urlObj.hostname === "localhost" ||
                /^(\d{1,3}\.){3}\d{1,3}$/.test(urlObj.hostname) ||
                urlObj.hostname.includes(":");

            const encodedKey = _encodePath(fullKey);
            if (forcePathStyle || isIpOrLocalhost) {
                canonicalUri = "/" + _rfc3986(bucket) + (encodedKey ? "/" + encodedKey : "");
            } else {
                host = _rfc3986(bucket) + "." + host;
                canonicalUri = "/" + encodedKey;
            }
            baseUrl = protocol + "//" + host + canonicalUri;
        } else if (forcePathStyle) {
            // S3 パス形式 (例: https://s3.ap-northeast-1.amazonaws.com/bucket/key)
            host = region === "us-east-1" ? "s3.amazonaws.com" : "s3." + region + ".amazonaws.com";
            const encodedKey = _encodePath(fullKey);
            canonicalUri = "/" + _rfc3986(bucket) + (encodedKey ? "/" + encodedKey : "");
            baseUrl = "https://" + host + canonicalUri;
        } else {
            // S3 仮想ホスト形式 (例: https://bucket.s3.ap-northeast-1.amazonaws.com/key)
            host = region === "us-east-1" ? bucket + ".s3.amazonaws.com" : bucket + ".s3." + region + ".amazonaws.com";
            const encodedKey = _encodePath(fullKey);
            canonicalUri = "/" + encodedKey;
            baseUrl = "https://" + host + canonicalUri;
        }

        return {
            protocol: protocol,
            host: host,
            canonicalUri: canonicalUri,
            baseUrl: baseUrl
        };
    };

    // ヘッダーの正規化と署名対象ヘッダーの構築.
    const _buildCanonicalHeaders = function (host, extraHeaders) {
        const headers = Object.assign({}, extraHeaders);
        headers["host"] = host.toLowerCase();

        const lowerKeys = Object.keys(headers).map(function (k) {
            return k.toLowerCase();
        }).sort();

        let canonicalHeaders = "";
        for (let i = 0; i < lowerKeys.length; i++) {
            const k = lowerKeys[i];
            let v = headers[k];
            if (v == null) {
                for (let orig in headers) {
                    if (orig.toLowerCase() === k) {
                        v = headers[orig];
                        break;
                    }
                }
            }
            const valStr = ("" + (v != null ? v : "")).replace(/\s+/g, " ").trim();
            canonicalHeaders += k + ":" + valStr + "\n";
        }

        const signedHeaders = lowerKeys.join(";");
        return {
            canonicalHeaders: canonicalHeaders,
            signedHeaders: signedHeaders
        };
    };

    // クエリパラメータの構築.
    const _buildCanonicalQueryString = function (queryParams) {
        const keys = Object.keys(queryParams).sort();
        const pairs = [];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = queryParams[k];
            pairs.push(_rfc3986(k) + "=" + _rfc3986("" + (v != null ? v : "")));
        }
        return pairs.join("&");
    };

    // SigV4 署名鍵の導出.
    const _getSigningKey = function (secretKey, dateStamp, region, service) {
        const kDate = _hmac("AWS4" + secretKey, dateStamp);
        const kRegion = _hmac(kDate, region);
        const kService = _hmac(kRegion, service);
        const kSigning = _hmac(kService, "aws4_request");
        return kSigning;
    };

    // 署名付きURLを生成.
    // method: HTTPメソッド ("GET", "PUT", "DELETE", "HEAD")
    // bucket: バケット名
    // prefix: プレフィックス (null/undefined可)
    // key: キー名
    // options:
    //   expiresIn: 有効期限(秒。デフォルト: 900, 最大: 604800)
    //   region: リージョン(デフォルト: ap-northeast-1)
    //   credentials: { access_key, secret_access_key, session_token }
    //   endpoint: カスタムエンドポイント
    //   forcePathStyle: パス形式を強制(boolean)
    //   contentType: PUT等のContent-Type (指定時はsignedHeadersに含まれます)
    //   headers: 署名に含める追加ヘッダー ({ "content-type": "image/png" })
    //   responseContentType: GET時のレスポンスContent-Type
    //   responseContentDisposition: GET時のレスポンスContent-Disposition (ファイル名指定等)
    //   queryParams: 追加のクエリパラメータ
    //   date: 署名基準日時 (Dateオブジェクト。テスト等で使用)
    //   noError: エラー時に例外をthrowするか (デフォルト: true=null返却)
    exports.createPresignedUrl = function (method, bucket, prefix, key, options) {
        options = options || {};
        try {
            if (!method || typeof method !== "string") {
                throw new Error("HTTP method is required (e.g. GET, PUT, DELETE).");
            }
            if (!bucket || typeof bucket !== "string") {
                throw new Error("Bucket name is required.");
            }
            if (key == null) {
                throw new Error("Key is required.");
            }

            const httpMethod = method.toUpperCase();
            const fullKey = _prefixKey(prefix, key);
            const region = options.region || _DEF_REGION;
            const localEndpoint = process.env["MINTO_LOCAL_S3_ENDPOINT"];
            const credentials = _getCredentials(options.credentials, localEndpoint);

            if (!credentials || !credentials.accessKeyId || !credentials.secretAccessKey) {
                throw new Error("AWS credentials not found. Please specify credentials in options or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.");
            }

            let expiresIn = options.expiresIn != null ? parseInt(options.expiresIn) : _DEF_EXPIRES_IN;
            if (isNaN(expiresIn) || expiresIn <= 0) {
                expiresIn = _DEF_EXPIRES_IN;
            }
            if (expiresIn > _MAX_EXPIRES_IN) {
                expiresIn = _MAX_EXPIRES_IN;
            }

            const { dateStamp, amzDate } = _formatDates(options.date);
            const { host, canonicalUri, baseUrl } = _resolveEndpoint(bucket, fullKey, region, options, localEndpoint);

            // 追加ヘッダーの整理 (contentTypeのショートハンド対応)
            const extraHeaders = Object.assign({}, options.headers);
            if (options.contentType && !extraHeaders["content-type"]) {
                extraHeaders["content-type"] = options.contentType;
            }

            const { canonicalHeaders, signedHeaders } = _buildCanonicalHeaders(host, extraHeaders);

            const credentialScope = dateStamp + "/" + region + "/s3/aws4_request";

            // クエリパラメータの構築
            const queryParams = Object.assign({}, options.queryParams);
            queryParams["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256";
            queryParams["X-Amz-Credential"] = credentials.accessKeyId + "/" + credentialScope;
            queryParams["X-Amz-Date"] = amzDate;
            queryParams["X-Amz-Expires"] = "" + expiresIn;
            queryParams["X-Amz-SignedHeaders"] = signedHeaders;

            if (credentials.sessionToken) {
                queryParams["X-Amz-Security-Token"] = credentials.sessionToken;
            }

            // GET用レスポンスヘッダ上書きクエリパラメータ
            if (options.responseContentType) {
                queryParams["response-content-type"] = options.responseContentType;
            }
            if (options.responseContentDisposition) {
                queryParams["response-content-disposition"] = options.responseContentDisposition;
            }

            const canonicalQueryString = _buildCanonicalQueryString(queryParams);

            // Canonical Request
            const canonicalRequest = [
                httpMethod,
                canonicalUri,
                canonicalQueryString,
                canonicalHeaders,
                signedHeaders,
                "UNSIGNED-PAYLOAD"
            ].join("\n");

            const hashedCanonicalRequest = _hashHex(canonicalRequest);

            // String To Sign
            const stringToSign = [
                "AWS4-HMAC-SHA256",
                amzDate,
                credentialScope,
                hashedCanonicalRequest
            ].join("\n");

            // 署名計算
            const signingKey = _getSigningKey(credentials.secretAccessKey, dateStamp, region, "s3");
            const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

            // 最終URL生成
            const presignedUrl = baseUrl + "?" + canonicalQueryString + "&X-Amz-Signature=" + signature;
            return presignedUrl;
        } catch (e) {
            console.warn("[S3.PRESIGN] method: " + method + " bucket: " + bucket +
                " prefix: " + prefix + " key: " + key, e);
            if (options.noError === false) {
                throw e;
            }
            return null;
        }
    };

    // アップロード用署名付きURL (PUT)
    exports.createPresignedPutUrl = function (bucket, prefix, key, options) {
        return exports.createPresignedUrl("PUT", bucket, prefix, key, options);
    };

    // ダウンロード用署名付きURL (GET)
    exports.createPresignedGetUrl = function (bucket, prefix, key, options) {
        return exports.createPresignedUrl("GET", bucket, prefix, key, options);
    };

    // 削除用署名付きURL (DELETE)
    exports.createPresignedDeleteUrl = function (bucket, prefix, key, options) {
        return exports.createPresignedUrl("DELETE", bucket, prefix, key, options);
    };

    // s3sdk互換のショートハンド
    exports.getPresignedUrl = exports.createPresignedUrl;
    exports.getPresignedPutUrl = exports.createPresignedPutUrl;
    exports.getPresignedGetUrl = exports.createPresignedGetUrl;
    exports.getPresignedDeleteUrl = exports.createPresignedDeleteUrl;
})();
