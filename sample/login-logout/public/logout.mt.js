// ************************************************************
// public/logout.mt.js
// ログアウト (GET/POST)
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const res = $response();

    const session = $loadLib("session.js");
    const sid = req.cookie("minto_sid");
    if (sid != null) {
        await session.destroy(sid);
    }

    // クッキークリア.
    res.cookie("minto_sid", {
        value: "",
        path: "/",
        httponly: true,
        samesite: "lax",
        "max-age": "0"
    });

    res.redirect("/index");
};
