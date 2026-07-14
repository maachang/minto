///////////////////////////////////////////////
// S3ベース 簡易排他ロック(AWS-SDK-V3利用).
//
// PutObjectCommand の IfNoneMatch(条件付き書き込み)を利用して
// 複数Lambda実行間での排他制御を行う.
//
// s3sdk.js は失敗時に必ずconsole.warnでログ出力する設計だが、
// ロック競合(PreconditionFailed)はロック機構における正常系の
// 一部であり、毎回警告ログを出すのは不適切なため、s3sdk.jsを
// 経由せず本モジュール内で直接S3Clientを扱う.
///////////////////////////////////////////////
(function () {
    'use strict';

    const {
        S3Client,
        PutObjectCommand,
        DeleteObjectCommand,
        GetObjectCommand
    } = require("@aws-sdk/client-s3");

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // AWSクレデンシャル(環境変数キャッシュ).
    let _AWS_CREDENTIAL = null;

    // 環境変数からCredentialを取得.
    const _getEnvCredential = function () {
        if (_AWS_CREDENTIAL == null) {
            _AWS_CREDENTIAL = {
                "access_key": process.env["AWS_ACCESS_KEY_ID"],
                "secret_access_key": process.env["AWS_SECRET_ACCESS_KEY"],
                "session_token": process.env["AWS_SESSION_TOKEN"]
            };
        }
        return _AWS_CREDENTIAL;
    };

    // リージョン毎のS3Client.
    const _S3CLIENT = {};

    // S3Clientオブジェクトを取得.
    const _getS3Client = function (region, credentials) {
        if (region == undefined || region == null) {
            region = _DEF_REGION;
        }
        if (credentials == undefined || credentials == null) {
            credentials = _getEnvCredential();
        }
        if (credentials["access_key"] == undefined) {
            if (_S3CLIENT[region] == undefined) {
                _S3CLIENT[region] = new S3Client({ region: region });
            }
            return _S3CLIENT[region];
        }
        const key = credentials["access_key"] + "_" + region;
        if (_S3CLIENT[key] == undefined) {
            let setCredentials;
            if (credentials["session_token"] == undefined) {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"]
                };
            } else {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"],
                    sessionToken: credentials["session_token"]
                };
            }
            _S3CLIENT[key] = new S3Client({
                region: region,
                credentials: setCredentials
            });
        }
        return _S3CLIENT[key];
    };

    // prefixとkeyをマージしてS3オブジェクトキーを生成.
    const _objectKey = function (prefix, lockKey) {
        let p = prefix;
        if (p.startsWith("/")) {
            p = p.substring(1);
        }
        if (p.endsWith("/")) {
            p = p.substring(0, p.length - 1);
        }
        return p + "/" + lockKey + ".lock";
    };

    // StreamをStringに変換.
    const _streamToString = function (stream) {
        return stream.transformToString("utf-8");
    };

    // エラーがロック競合(条件付き書き込み失敗)によるものか判定.
    const _isPreconditionFailed = function (e) {
        return e != null && (e.name === "PreconditionFailed" ||
            e.Code === "PreconditionFailed" ||
            (e.$metadata != undefined && e.$metadata.httpStatusCode === 412));
    };

    // ロックストアを生成します.
    // options.bucket 対象のS3バケット名を設定します(必須).
    // options.prefix ロック保存先prefixを設定します(デフォルト "locks/").
    // options.timeoutMs ロック有効期限(ms)を設定します(デフォルト30000)。
    //                    この時間を超えたロックはstaleとみなし自動失捉(reclaim)します.
    // options.region S3接続先リージョンを設定します.
    // options.credentials S3接続用クレデンシャルを設定します.
    // 戻り値: {acquire, release} を持つロックストアオブジェクト.
    exports.create = function (options) {
        options = options || {};
        if (options.bucket == null) {
            throw new Error("options.bucket is required.");
        }
        const _bucket = options.bucket;
        const _prefix = options.prefix || "locks/";
        const _timeoutMs = options.timeoutMs || 30000;
        const _client = _getS3Client(options.region, options.credentials);

        // 条件付き(IfNoneMatch)でロックオブジェクトを書き込む.
        // 成功時true、競合(既存ロックあり)時false、その他エラーはthrow.
        const _tryPut = async function (key) {
            try {
                await _client.send(new PutObjectCommand({
                    Bucket: _bucket,
                    Key: key,
                    Body: JSON.stringify({ acquiredAt: Date.now() }),
                    IfNoneMatch: "*"
                }));
                return true;
            } catch (e) {
                if (_isPreconditionFailed(e)) {
                    return false;
                }
                throw e;
            }
        };

        return {
            // ロックを取得します.
            // lockKey 対象のロックキーを設定します.
            // 戻り値: 取得成功時true、既に他者が保持中(かつstaleでない)場合false.
            acquire: async function (lockKey) {
                const key = _objectKey(_prefix, lockKey);
                if (await _tryPut(key)) {
                    return true;
                }
                // 既存ロックの保持時間を確認し、staleなら失捉(reclaim)を試みる.
                let existing;
                try {
                    const res = await _client.send(new GetObjectCommand({
                        Bucket: _bucket,
                        Key: key
                    }));
                    existing = JSON.parse(await _streamToString(res.Body));
                } catch (e) {
                    // 取得できない(既に解放された等)場合は再度取得を試みる.
                    return await _tryPut(key);
                }
                if (Date.now() - existing.acquiredAt <= _timeoutMs) {
                    // 有効なロックが存在する.
                    return false;
                }
                // staleなロックを削除して再取得を試みる(他者に先取りされた場合はfalse).
                await _client.send(new DeleteObjectCommand({
                    Bucket: _bucket,
                    Key: key
                }));
                return await _tryPut(key);
            },

            // ロックを解放します.
            // lockKey 対象のロックキーを設定します.
            release: async function (lockKey) {
                await _client.send(new DeleteObjectCommand({
                    Bucket: _bucket,
                    Key: _objectKey(_prefix, lockKey)
                }));
            }
        };
    };
})();
