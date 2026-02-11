// ************************************************************
// public/api/register.mt.js
// ユーザー登録API (POST)
// ************************************************************

exports.handler = async function () {
    const req = $request();

    if (req.method() !== "POST") {
        throw new HttpError({ status: 405, message: "Method Not Allowed" });
    }

    const p = req.params();
    const userId = (p.userId || "").trim();
    const password = p.password || "";
    const passwordConfirm = p.passwordConfirm || "";
    const name = (p.name || "").trim();

    if (userId === "") {
        return { success: false, message: "ユーザーIDを入力してください" };
    }
    if (userId.length < 3 || userId.length > 32) {
        return { success: false, message: "ユーザーIDは3〜32文字で入力してください" };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(userId)) {
        return {
            success: false,
            message: "ユーザーIDは英数字とアンダースコアのみ使用できます"
        };
    }
    if (password.length < 4) {
        return { success: false, message: "パスワードは4文字以上で入力してください" };
    }
    if (password !== passwordConfirm) {
        return { success: false, message: "パスワードが一致しません" };
    }

    const userStore = $loadLib("userStore.js");
    return await userStore.register(userId, password, name || userId, "user");
};
