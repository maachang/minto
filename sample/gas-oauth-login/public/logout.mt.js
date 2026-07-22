// ************************************************************
// public/logout.mt.js
// ログアウト (GET/POST)
// ************************************************************

exports.handler = async function () {
    const res = $response();

    // S3セッションの破棄＋Cookieクリアを1回で行う(modules/auth/session.js。
    // 接続設定はconf/session.jsonから自動的に読み込まれる).
    const session = $loadLib("session.js");
    await session.destroyCookie();

    res.redirect("/index");
};
