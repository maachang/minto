///////////////////////////////////////////////
// S3 Direct-to-S3 アップロード支援モジュール.
//
// Lambda Function URLs のペイロード上限(6MB)を回避し、
// クライアント(ブラウザ等)からS3へ大容量ファイルを直接安全に
// アップロードするための署名発行・完了検証ヘルパー.
//
// llrtおよびNode.js完全互換(外部npmパッケージ不使用).
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = typeof $require === "function" ? $require("crypto") : require("crypto");

    // s3presignモジュールのロード.
    let _s3presign = null;
    const _getPresign = function () {
        if (_s3presign == null) {
            try {
                _s3presign = $loadLib("s3presign.js");
            } catch (e) {
                _s3presign = require("./s3presign.js");
            }
        }
        return _s3presign;
    };

    // s3sdkモジュールのロード.
    let _s3sdk = null;
    const _getS3Sdk = function () {
        if (_s3sdk == null) {
            try {
                _s3sdk = $loadLib("s3sdk.js");
            } catch (e) {
                _s3sdk = require("./s3sdk.js");
            }
        }
        return _s3sdk;
    };

    // MIMEタイプのホワイトリスト検証.
    // mime: "image/png"
    // allowedList: ["image/jpeg", "image/png", "image/*", "application/pdf"]
    const _isAllowedContentType = function (mime, allowedList) {
        if (!allowedList || !Array.isArray(allowedList) || allowedList.length === 0) {
            return true;
        }
        if (!mime || typeof mime !== "string") {
            return false;
        }
        mime = mime.trim().toLowerCase();
        const baseMime = mime.split(";")[0].trim();

        for (let i = 0; i < allowedList.length; i++) {
            const pattern = ("" + allowedList[i]).trim().toLowerCase();
            if (pattern === "*/*" || pattern === "*") {
                return true;
            }
            if (pattern.endsWith("/*")) {
                const typePrefix = pattern.substring(0, pattern.length - 1); // "image/"
                if (baseMime.startsWith(typePrefix)) {
                    return true;
                }
            } else if (baseMime === pattern) {
                return true;
            }
        }
        return false;
    };

    // 安全な拡張子の抽出.
    const _safeExtension = function (filename) {
        if (!filename || typeof filename !== "string") {
            return "";
        }
        const lastDot = filename.lastIndexOf(".");
        if (lastDot === -1 || lastDot === filename.length - 1) {
            return "";
        }
        const ext = filename.substring(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
        return ext ? "." + ext : "";
    };

    // アップロード用チケット(署名付きPUT URL)を発行.
    // options: {
    //   bucket: "my-bucket",                  // S3バケット名(省略時: process.env.S3_UPLOAD_BUCKET)
    //   prefix: "uploads/202609/",           // S3プレフィックス
    //   filename: "photo.png",                // 元ファイル名(拡張子判定・命名用)
    //   key: "explicit/key.png",              // 明示的なキー名(省略時はUUID自動採番)
    //   contentType: "image/png",             // MIMEタイプ
    //   allowedTypes: ["image/*"],            // 許可MIMEタイプ
    //   maxSize: 50 * 1024 * 1024,           // 最大ファイルサイズ(バイト)
    //   expiresIn: 900,                       // 署名有効期限(秒, デフォルト900=15分)
    //   region: "ap-northeast-1",             // S3リージョン
    //   credentials: { ... }                  // AWSクレデンシャル(任意)
    // }
    const createUploadTicket = function (options) {
        options = options || {};
        const bucket = options.bucket || process.env.S3_UPLOAD_BUCKET;
        if (!bucket) {
            throw new Error("S3 bucket name is required for upload ticket");
        }

        const contentType = options.contentType || "application/octet-stream";
        if (options.allowedTypes && !_isAllowedContentType(contentType, options.allowedTypes)) {
            throw new Error("Content-Type '" + contentType + "' is not allowed");
        }

        let key = options.key;
        if (!key) {
            const uuid = crypto.randomUUID();
            const ext = options.extension || _safeExtension(options.filename);
            const prefix = options.prefix ? options.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
            key = prefix + uuid + ext;
        }

        const expiresIn = options.expiresIn || 900;
        const presignOptions = {
            expiresIn: expiresIn,
            contentType: contentType,
            region: options.region,
            credentials: options.credentials
        };

        const uploadUrl = _getPresign().createPresignedPutUrl(bucket, "", key, presignOptions);
        const expiresAt = Date.now() + (expiresIn * 1000);

        return {
            uploadUrl: uploadUrl,
            bucket: bucket,
            key: key,
            contentType: contentType,
            maxSize: options.maxSize || null,
            expiresIn: expiresIn,
            expiresAt: expiresAt
        };
    };

    // アップロード完了後のファイル存在・整合性検証.
    // bucket: S3バケット名
    // key: S3キー名
    // options: {
    //   maxSize: 50 * 1024 * 1024,           // 最大許容サイズ(バイト)
    //   minSize: 1,                           // 最小許容サイズ(バイト, デフォルト1)
    //   allowedTypes: ["image/*"],            // 許可MIMEタイプ
    //   region: "ap-northeast-1",             // S3リージョン
    //   credentials: { ... }                  // AWSクレデンシャル(任意)
    // }
    // 戻り値: { valid: true, size, contentType, etag, lastModified, bucket, key }
    //         または { valid: false, error: string }
    const verifyUploadedFile = async function (bucket, key, options) {
        if (!bucket || !key) {
            return { valid: false, error: "Bucket and key are required" };
        }
        options = options || {};

        try {
            const headRes = await _getS3Sdk().head(bucket, "", key, {
                region: options.region,
                credentials: options.credentials,
                noError: true
            });

            if (!headRes) {
                return { valid: false, error: "Uploaded object not found in S3" };
            }

            const size = headRes.ContentLength != undefined ? headRes.ContentLength : null;
            const contentType = headRes.ContentType || "";
            const minSize = options.minSize !== undefined ? options.minSize : 1;

            if (size !== null) {
                if (size < minSize) {
                    return { valid: false, error: "File size is too small (" + size + " bytes)" };
                }
                if (options.maxSize && size > options.maxSize) {
                    return { valid: false, error: "File size exceeds maximum allowed size (" + size + " > " + options.maxSize + ")" };
                }
            }

            if (options.allowedTypes && !_isAllowedContentType(contentType, options.allowedTypes)) {
                return { valid: false, error: "Uploaded content-type '" + contentType + "' is not allowed" };
            }

            return {
                valid: true,
                bucket: bucket,
                key: key,
                size: size,
                contentType: contentType,
                etag: headRes.ETag ? headRes.ETag.replace(/^"|"$/g, "") : null,
                lastModified: headRes.LastModified || null
            };
        } catch (e) {
            console.error("[DIRECT_UPLOAD] Verification error:", e);
            return { valid: false, error: "Failed to verify uploaded object: " + (e.message || e) };
        }
    };

    // ダウンロード/閲覧用の一時署名付きURLを発行.
    // bucket: S3バケット名
    // key: S3キー名
    // options: {
    //   expiresIn: 900,                       // 有効期限(秒, デフォルト900=15分)
    //   filename: "download.pdf",             // ダウンロード時のファイル名指定(Content-Disposition)
    //   asAttachment: false,                  // trueなら強制ダウンロード(attachment)
    //   responseContentType: "application/pdf" // Content-Typeの上書き指定
    // }
    const createDownloadTicket = function (bucket, key, options) {
        if (!bucket || !key) {
            throw new Error("Bucket and key are required");
        }
        options = options || {};
        const expiresIn = options.expiresIn || 900;
        const presignOptions = {
            expiresIn: expiresIn,
            region: options.region,
            credentials: options.credentials,
            responseContentType: options.responseContentType
        };

        if (options.filename || options.asAttachment) {
            const dispositionType = options.asAttachment ? "attachment" : "inline";
            if (options.filename) {
                // RFC 5987 準拠のファイル名エンコード
                const safeAsciiName = options.filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
                const encodedUtf8Name = encodeURIComponent(options.filename);
                presignOptions.responseContentDisposition =
                    dispositionType + '; filename="' + safeAsciiName + '"; filename*=UTF-8\'\'' + encodedUtf8Name;
            } else {
                presignOptions.responseContentDisposition = dispositionType;
            }
        }

        const downloadUrl = _getPresign().createPresignedGetUrl(bucket, "", key, presignOptions);
        const expiresAt = Date.now() + (expiresIn * 1000);

        return {
            downloadUrl: downloadUrl,
            bucket: bucket,
            key: key,
            expiresIn: expiresIn,
            expiresAt: expiresAt
        };
    };

    exports.createUploadTicket = createUploadTicket;
    exports.verifyUploadedFile = verifyUploadedFile;
    exports.createDownloadTicket = createDownloadTicket;
    exports._isAllowedContentType = _isAllowedContentType;
    exports._safeExtension = _safeExtension;
})();
