// ************************************************************
// public/logout.mt.js
// ログアウト (GET/POST)
// ************************************************************

exports.handler = async function () {
    const res = $response();

    // S3セッションの破棄＋Cookieクリアを1回で行う(modules/auth/session.js).
    const conf = $loadConf("app.json");
    const session = $loadLib("session.js").create({
        bucket: conf.s3Bucket,
        prefix: conf.sessionPrefix,
        timeoutMin: conf.sessionTimeoutMin,
        region: conf.region
    });
    await session.destroyCookie();

    res.redirect("/index");
};
