// ************************************************************
// public/filter.mt.js
// 認証フィルター
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const path = req.path();

    // 認証不要パス(GAS oAuthの往復・ログアウト).
    if (path === "/index" ||
        path === "/resultOAuth" ||
        path === "/logout") {
        return true;
    }

    // セッションチェック(modules/auth/session.js。1実行毎にキャッシュされる
    // ため、同一リクエスト内で複数回呼んでもS3への問い合わせは1回だけで済む。
    // 接続設定はconf/session.jsonから自動的に読み込まれる).
    const session = $loadLib("session.js");
    const user = await session.getCookie();

    // セッションが存在しない場合、現在アクセスしようとしていたパスを
    // srcURLとして自動的に使い、GASへのoAuthURLへ1回の呼び出しで
    // リダイレクトする(/requestOAuthを経由する必要がない).
    if (user == null) {
        const gasAuth = $loadLib("gasAuth.js");
        gasAuth.redirectToOAuth(req, $response(), "/resultOAuth");
        return;
    }

    return true;
};
