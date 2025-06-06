// AWS-S3接続(aws-sdk-v3).
// 最低限のS3のI/Oが利用できる.
//
(function () {
    'use strict';

    // S3-Client.
    const {
        S3Client,
        PutObjectCommand,
        DeleteObjectCommand,
        GetObjectCommand,
        ListObjectsV2Command
    } = require("@aws-sdk/client-s3")

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // AWSクレデンシャル.
    let _AWS_CREDENTIAL = null;

    // 環境変数からCredentialを取得.
    const _getEnvCredential = function () {
        if (_AWS_CREDENTIAL == null) {
            _AWS_CREDENTIAL = {
                "access_key": process.env["AWS_ACCESS_KEY_ID"],
                "secret_access_key": process.env["AWS_SECRET_ACCESS_KEY"],
                "session_token": process.env["AWS_SESSION_TOKEN"]
            }
        }
        return _AWS_CREDENTIAL;
    }

    // リージョン毎のS3Client.
    const _S3CLIENT = {};

    // S3Clientオブジェクトを取得.
    const _getS3Client = function (region, credentials) {
        if (region == undefined || regin == null) {
            region = _DEF_REGION;
        }
        // credentialsが設定されていない場合.
        if (credentials == undefined || credentials == null) {
            // 環境変数から取得.
            credentials = _getEnvCredential();
        }
        // accessKeyが存在しない場合.
        if (credentials["access_key"] == undefined) {
            if (_S3CLIENT[region] == undefined) {
                _S3CLIENT[region] = new S3Client({
                    region: region
                });
            }
            return _S3CLIENT[region];
        }
        // S3Clientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_S3CLIENT[key] == undefined) {
            let setCredentials;
            if (credentials["session_token"] == undefined) {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"]
                }
            } else {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"],
                    sessionToken: credentials["session_token"]
                }
            }
            _S3CLIENT[key] = new S3Client({
                region: region,
                credentials: setCredentials
            });
        }
        return _S3CLIENT[key];
    }

    // prefixを整形.
    const _prefix = function (prefix) {
        if (prefix.startsWith("/")) {
            prefix = prefix.substring(1);
        }
        if (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length - 1);
        }
        return prefix;
    }

    // keyを整形.
    const _key = function (key) {
        if (key.startsWith("/")) {
            key = key.substring(1);
        }
        return key;
    }

    // prefixとkeyをマージ.
    const _prefixKey = function (prefix, key) {
        key = _key(key);
        if (prefix != undefined && prefix != null) {
            return _prefix(prefix) + "/" + key;
        }
        return key;
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 指定BucketのPrefix+Keyに対してBodyをセット.
    // bucket 対象のBucket名を設定します.
    // prefix 対象のprefixを設定します.
    // key 対象のkeyを設定します.
    // body 対象のkeyに対するbodyを設定します.
    // option 任意のオプションを設定します.
    //        noError: false の場合例外返却(デフォルト: true).
    //        region: 接続先リージョンを設定します(デフォルト: 東京).
    //        credentials: access_key, secret_access_key, session_token
    //                     などを設定します.
    exports.put = async function (bucket, prefix, key, body, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            await _getS3Client(options.region, options.credentials).send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: _prefixKey(prefix, key),
                    Body: body
                })
            )
            return true;
        } catch (e) {
            // ログ出力.
            console.warn("[S3.PUT]bucket: " + bucket + " prefix: " + prefix +
                " key: " + key + " options: " + _strOptions(options), e);
            // エラー返却の場合.
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }

    // 指定BucketのPrefix+Keyを削除.
    // bucket 対象のBucket名を設定します.
    // prefix 対象のprefixを設定します.
    // key 対象のkeyを設定します.
    // option 任意のオプションを設定します.
    //        noError: false の場合例外返却(デフォルト: true).
    //        region: 接続先リージョンを設定します(デフォルト: 東京).
    //        credentials: access_key, secret_access_key, session_token
    //                     などを設定します.
    exports.delete = async function (bucket, prefix, key, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            await _getS3Client(options.region, options.credentials).send(
                new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: _prefixKey(prefix, key)
                })
            )
            return true;
        } catch (e) {
            // ログ出力.
            console.warn("[S3.DELETE]bucket: " + bucket + " prefix: " + prefix +
                " key: " + key + " options: " + _strOptions(options), e);
            // エラー返却の場合.
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }

    // 指定BucketのPrefix+Keyを取得.
    // bucket 対象のBucket名を設定します.
    // prefix 対象のprefixを設定します.
    // key 対象のkeyを設定します.
    // option 任意のオプションを設定します.
    //        noError: false の場合例外返却(デフォルト: true).
    //        region: 接続先リージョンを設定します(デフォルト: 東京).
    //        credentials: access_key, secret_access_key, session_token
    //                     などを設定します.
    // 戻り値: 対象内容のbodyが返却されます.
    exports.get = async function (bucket, prefix, key, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            return await _getS3Client(options.region, options.credentials).send(
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: _prefixKey(prefix, key)
                })
            );
        } catch (e) {
            // ログ出力.
            console.warn("[S3.GET]bucket: " + bucket + " prefix: " + prefix +
                " key: " + key + " options: " + _strOptions(options), e);
            // エラー返却の場合.
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }

    // 指定BucketのPrefix以下のリスト取得.
    // bucket 対象のBucket名を設定します.
    // prefix 対象のprefixを設定します.
    // option 任意のオプションを設定します.
    //        noError: false の場合例外返却(デフォルト: true).
    //        region: 接続先リージョンを設定します(デフォルト: 東京).
    //        credentials: access_key, secret_access_key, session_token
    //                     などを設定します.
    //        maxKey: maxKey数を設定します(最大1000)
    //        delimiter: delimiterを設定します.
    //        continuationToken: 次の開始位置のトークンを設定します.
    //                           この値はlist返却の{IsTruncated; true}の場合
    //                           {NextContinuationToken}この内容を設定します.
    // 戻り値: リスト内容が返却されます.
    //         {Contents:[]} 以下がリスト情報内容となります.
    exports.list = async function (bucket, prefix, options) {
        if (options == undefined) {
            options = {};
        }
        const input = {
            Bucket: bucket
        }
        if (prefix != undefined && prefix != null) {
            input["Prefix"] = _prefix(prefix);
        }
        if (options.maxKey != undefined) {
            input["MaxKeys"] = parseInt(options.maxKey);
        }
        if (options.delimiter != undefined) {
            input["Delimiter"] = "" + options.delimiter;
        }
        if (options.continuationToken != undefined) {
            input["ContinuationToken"] = "" + options.continuationToken;
        }
        try {
            // リスト取得.
            return await _getS3Client(options.region, options.credentials).send(
                new ListObjectsV2Command(input)
            );
        } catch (e) {
            // ログ出力.
            console.warn("[S3.LIST]bucket: " + bucket + " prefix: " + prefix +
                " options: " + _strOptions(options), e);
            // エラー返却の場合.
            if (options.noError == false) {
                throw e;
            }
            return { "Contents": [], "IsTruncated": false };
        }
    }
})();