///////////////////////////////////////////////
// S3ベース セッション管理(共通モジュール).
//
// sample/login-logout/lib/session.js の実装を汎用化したもの.
// modules/sdk/s3sdk.js に依存する(AWS-SDK-V3利用).
///////////////////////////////////////////////
(function () {
    'use strict';

    const s3sdk = $loadLib("s3sdk.js");
    const crypto = $require("crypto");

    // StreamをStringに変換.
    // llrtでは for-await-of 構文が利用できないため
    // transformToString() を利用する.
    const _streamToString = function (stream) {
        return stream.transformToString("utf-8");
    };

    // セッションID生成.
    const _generateId = function () {
        return crypto.randomBytes(32).toString("hex") +
            "_" + Date.now().toString(36);
    };

    // セッションストアを生成します.
    // options.bucket 対象のS3バケット名を設定します(必須).
    // options.prefix セッション保存先prefixを設定します(デフォルト "sessions/").
    // options.timeoutMin セッション有効期限(分)を設定します(デフォルト30).
    // options.region S3接続先リージョンを設定します.
    // options.credentials S3接続用クレデンシャルを設定します.
    // 戻り値: {start, get, destroy, count} を持つセッションストアオブジェクト.
    exports.create = function (options) {
        options = options || {};
        if (options.bucket == null) {
            throw new Error("options.bucket is required.");
        }
        const _bucket = options.bucket;
        const _prefix = options.prefix || "sessions/";
        const _timeout = (options.timeoutMin || 30) * 60 * 1000;
        const _s3opts = {
            region: options.region,
            credentials: options.credentials
        };

        const _key = function (sid) {
            return sid + ".json";
        };

        const _getJson = async function (sid) {
            const res = await s3sdk.get(_bucket, _prefix, _key(sid), _s3opts);
            if (res == null) {
                return null;
            }
            const body = await _streamToString(res.Body);
            return JSON.parse(body);
        };

        const _putJson = async function (sid, data) {
            await s3sdk.put(_bucket, _prefix, _key(sid),
                JSON.stringify(data), _s3opts);
        };

        return {
            // 新規セッションを開始し、セッションIDを返却します.
            // userId 対象のユーザーIDを設定します.
            // userData セッションに紐づける任意のデータを設定します.
            // 戻り値: セッションID(文字列)が返却されます.
            start: async function (userId, userData) {
                const sid = _generateId();
                const now = Date.now();
                await _putJson(sid, {
                    sessionId: sid,
                    userId: userId,
                    data: userData || {},
                    createdAt: now,
                    lastAccess: now
                });
                return sid;
            },

            // セッションを取得します(有効期限切れの場合はnullを返却し自動削除).
            // sid 対象のセッションIDを設定します.
            // 戻り値: {userId, data} または null.
            get: async function (sid) {
                if (sid == null || sid === "") {
                    return null;
                }
                const ses = await _getJson(sid);
                if (ses == null) {
                    return null;
                }
                if (Date.now() - ses.lastAccess > _timeout) {
                    await s3sdk.delete(_bucket, _prefix, _key(sid), _s3opts);
                    return null;
                }
                ses.lastAccess = Date.now();
                await _putJson(sid, ses);
                return { userId: ses.userId, data: ses.data };
            },

            // セッションを破棄します.
            // sid 対象のセッションIDを設定します.
            destroy: async function (sid) {
                if (sid == null || sid === "") {
                    return;
                }
                await s3sdk.delete(_bucket, _prefix, _key(sid), _s3opts);
            },

            // 有効セッション数を取得します.
            // 戻り値: セッション数(number).
            count: async function () {
                const res = await s3sdk.list(_bucket, _prefix, _s3opts);
                return (res.Contents || []).length;
            }
        };
    };
})();
