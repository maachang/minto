// ************************************************************
// public/filter.mt.js
// 認証フィルター
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const path = req.path();

    // 認証不要パス.
    if (path === "/index" ||
        path === "/login" ||
        path === "/logout" ||
        path === "/register" ||
        path === "/api/register" ||
        path.startsWith("/assets/")) {
        return true;
    }

    // セッションチェック.
    const session = $loadLib("session.js");
    const sid = req.cookie("minto_sid");
    const user = await session.get(sid);

    // セッションが存在しない場合.
    if (user == null) {
        // リダイレクト.
        $response().redirect("/index");
        return;
    }

    return true;
};
