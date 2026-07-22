///////////////////////////////////////////////
// S3ベース セッション管理(共通モジュール).
//
// conf/session.json ({bucket, prefix, timeoutMin, region}) を読み込んで
// 自動的に初期化される(呼び出し側でbucket等を指定してcreate()する必要は
// 無く、$loadLib("session.js")した結果をそのままモジュールとして使う)。
// modules/s3table/s3sdk.js に依存する(AWS-SDK-V3利用).
//
// AIメモ:
// - 以前はexports.create(options)で呼び出し毎にbucket等を明示指定する
//   ファクトリ方式だったが、admin.js等の他モジュールから
//   $loadLib("session.js").getCookie() のように「設定不要でそのまま
//   呼べる」ことを前提に使いたいケースが出てきたため、conf/session.json
//   から自動的に設定を読み込む方式に変更した(create()は廃止)。
// - 設定(bucket等)はモジュール初回利用時に一度だけ$loadConf()し、以降は
//   キャッシュする(1つのLambda実行環境内でconfが変わることは無いため).
///////////////////////////////////////////////
(function () {
    'use strict';

    const s3sdk = $loadLib("s3sdk.js");
    const crypto = $require("crypto");

    // セッションキャッシュ変数名.
    const _SESSION_CACHE = "modules.auth.session";

    // [環境変数]Cookieセッション名を取得.
    const _COOKIE_SESSION_NAME = "MINTO_COOKIE_SESSION_NAME";
    const _getCookieSessionName = function() {
        const ret = process.env[_COOKIE_SESSION_NAME];
        if(ret == undefined || ret == null) {
            // デフォルトのセッション名を返却.
            return "minto_sid";
        }
        return ret;
    }

    // [conf]セッション設定ファイル名(conf/session.json).
    const _CONF_NAME = "session.json";

    // セッション設定(bucket/prefix/timeout/s3opts)をconf/session.jsonから
    // 読み込んでキャッシュする.
    // 戻り値: {bucket, prefix, timeout(ミリ秒), s3opts: {region, credentials}}
    let _conf = null;
    const _getConf = function () {
        if (_conf == null) {
            const c = $loadConf(_CONF_NAME);
            if (c == null || c.bucket == null) {
                throw new Error(
                    "conf/" + _CONF_NAME + "(bucketを含む)の設定が必要です.");
            }
            _conf = {
                bucket: c.bucket,
                prefix: c.prefix || "sessions/",
                timeout: (c.timeoutMin || 30) * 60 * 1000,
                s3opts: { region: c.region, credentials: c.credentials }
            };
        }
        return _conf;
    }

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

    const _key = function (sid) {
        return sid + ".json";
    };

    const _getJson = async function (sid) {
        const conf = _getConf();
        const res = await s3sdk.get(conf.bucket, conf.prefix, _key(sid), conf.s3opts);
        if (res == null) {
            return null;
        }
        const body = await _streamToString(res.Body);
        return JSON.parse(body);
    };

    const _putJson = async function (sid, data) {
        const conf = _getConf();
        await s3sdk.put(conf.bucket, conf.prefix, _key(sid),
            JSON.stringify(data), conf.s3opts);
    };

    // 新規セッションを開始し、セッションIDを返却します.
    // userId 対象のユーザーIDを設定します.
    // userData セッションに紐づける任意のデータを設定します.
    // 戻り値: セッションID(文字列)が返却されます.
    exports.start = async function (userId, userData) {
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
    };

    // セッションを取得します(有効期限切れの場合はnullを返却し自動削除).
    // sid 対象のセッションIDを設定します.
    // 戻り値: {userId, data} または null.
    exports.get = async function (sid) {
        if (sid == null || sid === "") {
            return null;
        }
        const ses = await _getJson(sid);
        if (ses == null) {
            return null;
        }
        const conf = _getConf();
        if (Date.now() - ses.lastAccess > conf.timeout) {
            await s3sdk.delete(conf.bucket, conf.prefix, _key(sid), conf.s3opts);
            return null;
        }
        ses.lastAccess = Date.now();
        await _putJson(sid, ses);
        return { userId: ses.userId, data: ses.data };
    };

    // セッションを破棄します.
    // sid 対象のセッションIDを設定します.
    exports.destroy = async function (sid) {
        if (sid == null || sid === "") {
            return;
        }
        const conf = _getConf();
        await s3sdk.delete(conf.bucket, conf.prefix, _key(sid), conf.s3opts);
    };

    // 有効セッション数を取得します.
    // 戻り値: セッション数(number).
    exports.count = async function () {
        const conf = _getConf();
        const res = await s3sdk.list(conf.bucket, conf.prefix, conf.s3opts);
        return (res.Contents || []).length;
    };

    // 新規セッションを開始し、CookieにSIDを設定します
    // (既存セッションの有無に関わらず、必ず新規セッションを作成します).
    // 戻り値: 発行したセッションID(文字列).
    exports.setCookie = async function (userId, userData) {
        const res = $response();

        // ユーザIDを登録.
        const sid = await exports.start(userId, userData);
        if (sid == null) {
            throw new Error("Session registration failed.");
        }

        // Cookie設定.
        res.cookie(_getCookieSessionName(), {
            value: sid,
            path: "/",
            httponly: true,
            samesite: "lax",
            "max-age": "" + (_getConf().timeout / 1000)
        });

        // キャッシュをクリア.
        $cache()[_SESSION_CACHE] = undefined;

        return sid;
    };

    // ログアウト用. Cookieからセッションを取得してS3側も破棄した上で、
    // Cookieもクリアします.
    exports.destroyCookie = async function () {
        const req = $request();
        const res = $response();
        const sid = req.cookie(_getCookieSessionName());
        if (sid != null) {
            await exports.destroy(sid);
        }
        // Cookieクリア.
        res.cookie(_getCookieSessionName(), {
            value: "",
            path: "/",
            httponly: true,
            samesite: "lax",
            "max-age": "0"
        });
        // キャッシュをクリア.
        $cache()[_SESSION_CACHE] = undefined;
    };

    // requestのCookieからセッションIDを取得し、セッション情報を返却します.
    // 戻り値: {userId, data}(getと同じ形式)。存在しない場合はnull.
    exports.getCookie = async function () {
        const cs = $cache();
        // キャッシュが存在する場合はキャッシュから取得
        // (nullという正当なキャッシュ結果と、未キャッシュ(undefined)を
        // 区別するため厳密不等価で判定する).
        if (cs[_SESSION_CACHE] !== undefined) {
            return cs[_SESSION_CACHE];
        }
        const req = $request();
        const sid = req.cookie(_getCookieSessionName());
        const ret = await exports.get(sid);
        // キャッシュにセット.
        cs[_SESSION_CACHE] = ret;
        return ret;
    };
})();
