// ************************************************************
// lib/session.js
// S3ベース セッション管理
// ************************************************************

(function () {
    'use strict';

    const s3 = $loadLib("s3client.js");
    const _conf = $loadConf("app.json");
    const _PREFIX = _conf.sessionPrefix || "sessions/";
    const _TIMEOUT = (_conf.sessionTimeoutMin || 30) * 60 * 1000;

    const _generateId = function () {
        const c =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let id = "";
        for (let i = 0; i < 48; i++) {
            id += c[(rand() >>> 0) % c.length];
        }
        return id + "_" + Date.now().toString(36);
    };

    const _key = function (sid) {
        return _PREFIX + sid + ".json";
    };

    // セッション作成 → セッションIDを返却.
    exports.create = async function (userId, userData) {
        const sid = _generateId();
        const now = Date.now();
        await s3.putJson(_key(sid), {
            sessionId: sid,
            userId: userId,
            name: userData.name || userId,
            role: userData.role || "user",
            createdAt: now,
            lastAccess: now
        });
        return sid;
    };

    // セッション取得 → ユーザー情報 or null.
    exports.get = async function (sid) {
        if (sid == null || sid == undefined || sid === "") {
            return null;
        }
        const ses = await s3.getJson(_key(sid));
        if (ses == null) return null;
        if (Date.now() - ses.lastAccess > _TIMEOUT) {
            await s3.remove(_key(sid));
            return null;
        }
        ses.lastAccess = Date.now();
        await s3.putJson(_key(sid), ses);
        return {
            userId: ses.userId,
            name: ses.name,
            role: ses.role
        };
    };

    // セッション破棄.
    exports.destroy = async function (sid) {
        if (sid != null && sid !== "") {
            await s3.remove(_key(sid));
        }
    };

    // 有効セッション数.
    exports.count = async function () {
        const keys = await s3.listKeys(_PREFIX);
        return keys.length;
    };
})();
