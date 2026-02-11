// ************************************************************
// public/login.mt.js
// ログインAPI (POST)
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const res = $response();

    if (req.method() !== "POST") {
        throw new HttpError({ status: 405, message: "Method Not Allowed" });
    }

    const params = req.params();
    const userId = (params.userId || "").trim();
    const password = params.password || "";

    if (userId === "" || password === "") {
        return {
            success: false,
            message: "ユーザーIDとパスワードを入力してください"
        };
    }

    // S3認証.
    const userStore = $loadLib("userStore.js");
    const userData = await userStore.authenticate(userId, password);

    if (userData == null) {
        return {
            success: false,
            message: "ユーザーIDまたはパスワードが正しくありません"
        };
    }

    // S3セッション作成.
    const session = $loadLib("session.js");
    const sid = await session.create(userId, userData);

    // Cookie設定.
    res.cookie("minto_sid", {
        value: sid,
        path: "/",
        httponly: true,
        samesite: "lax",
        "max-age": "1800"
    });

    res.status(200);
    return {
        success: true,
        message: "ログイン成功",
        user: {
            userId: userData.userId,
            name: userData.name,
            role: userData.role
        }
    };
};
