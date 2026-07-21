// ************************************************************
// public/filter.mt.js
// 認証フィルター
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const path = req.path();

    // 認証不要パス(GAS oAuthの往復・ログアウト).
    if (path === "/index" ||
        path === "/requestOAuth" ||
        path === "/resultOAuth" ||
        path === "/logout") {
        return true;
    }

    // セッションチェック.
    const session = $loadLib("sessionStore.js");
    const sid = req.cookie("minto_sid");
    const user = await session.get(sid);

    // セッションが存在しない場合.
    if (user == null) {
        $response().redirect("/index");
        return;
    }

    return true;
};
