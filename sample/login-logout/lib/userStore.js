// ************************************************************
// lib/userStore.js
// S3ベース ユーザー管理
// ************************************************************

(function () {
    'use strict';

    const crypto = $require("crypto");
    const s3 = $loadLib("s3client.js");
    const _conf = $loadConf("app.json");
    const _PREFIX = _conf.userPrefix || "users/";

    const _hashPw = function (pw, salt) {
        return crypto.createHash("sha256")
            .update(salt + ":" + pw).digest("hex");
    };

    const _genSalt = function () {
        return crypto.randomBytes(16).toString("hex");
    };

    const _key = function (uid) {
        return _PREFIX + uid + ".json";
    };

    // ユーザー登録.
    exports.register = async function (uid, pw, name, role) {
        const ex = await s3.getJson(_key(uid));
        if (ex != null) {
            return {
                success: false,
                message: "このユーザーIDは既に登録されています"
            };
        }
        const salt = _genSalt();
        await s3.putJson(_key(uid), {
            userId: uid,
            name: name || uid,
            role: role || "user",
            salt: salt,
            passwordHash: _hashPw(pw, salt),
            createdAt: new Date().toISOString()
        });
        return { success: true, message: "ユーザー登録が完了しました" };
    };

    // 認証(ログイン検証).
    exports.authenticate = async function (uid, pw) {
        const u = await s3.getJson(_key(uid));
        if (u == null) return null;
        if (_hashPw(pw, u.salt) !== u.passwordHash) return null;
        return { userId: u.userId, name: u.name, role: u.role };
    };

    // ユーザー情報取得(パスワード除く).
    exports.getUser = async function (uid) {
        const u = await s3.getJson(_key(uid));
        if (u == null) return null;
        return {
            userId: u.userId, name: u.name,
            role: u.role, createdAt: u.createdAt
        };
    };

    // ユーザー一覧(管理者向け).
    exports.listUsers = async function () {
        const keys = await s3.listKeys(_PREFIX);
        const ret = [];
        for (let i = 0; i < keys.length; i++) {
            const u = await s3.getJson(keys[i]);
            if (u != null) {
                ret.push({
                    userId: u.userId, name: u.name,
                    role: u.role, createdAt: u.createdAt
                });
            }
        }
        return ret;
    };

    // パスワード変更.
    exports.changePassword = async function (uid, oldPw, newPw) {
        const u = await s3.getJson(_key(uid));
        if (u == null) {
            return { success: false, message: "ユーザーが見つかりません" };
        }
        if (_hashPw(oldPw, u.salt) !== u.passwordHash) {
            return {
                success: false,
                message: "現在のパスワードが正しくありません"
            };
        }
        const newSalt = _genSalt();
        u.salt = newSalt;
        u.passwordHash = _hashPw(newPw, newSalt);
        await s3.putJson(_key(uid), u);
        return { success: true, message: "パスワードを変更しました" };
    };
})();
