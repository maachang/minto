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

    // セッションチェック.
    const session = $loadLib("sessionStore.js");
    const sid = req.cookie("minto_sid");
    const user = await session.get(sid);

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
