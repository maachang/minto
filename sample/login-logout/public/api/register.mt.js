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
    // userId/nameは前後空白を許容しない項目のため、検証前にtrimしておく
    // (旧実装のtrimしてから検証する挙動を踏襲する).
    const trimmed = Object.assign({}, p, {
        userId: (p.userId || "").trim(),
        name: (p.name || "").trim()
    });

    // modules/validate/validate.js を使ったスキーマ検証
    // (以前は各項目を手書きのif文で個別にチェックしていたが、
    // validate.check()にまとめることでルールの見通しを良くしている).
    const validate = $loadLib("validate.js");
    const result = validate.check(trimmed, {
        userId: {
            type: "string", required: true, minLen: 3, maxLen: 32,
            pattern: /^[a-zA-Z0-9_]+$/,
            messages: {
                required: "ユーザーIDを入力してください",
                minLen: "ユーザーIDは3〜32文字で入力してください",
                maxLen: "ユーザーIDは3〜32文字で入力してください",
                pattern: "ユーザーIDは英数字とアンダースコアのみ使用できます"
            }
        },
        password: {
            type: "string", required: true, minLen: 4,
            messages: {
                required: "パスワードは4文字以上で入力してください",
                minLen: "パスワードは4文字以上で入力してください"
            }
        },
        passwordConfirm: {
            type: "string", required: true,
            messages: { required: "パスワードが一致しません" },
            // custom(value, data)で他フィールド(password)との一致を確認する.
            custom: (v, data) => v === data.password ? true : "パスワードが一致しません"
        },
        name: { type: "string" }
    });
    if (!result.valid) {
        return { success: false, message: result.errors[0].message };
    }

    const userId = result.data.userId;
    const password = result.data.password;
    const name = result.data.name;

    const userStore = $loadLib("userStore.js");
    return await userStore.register(userId, password, name || userId, "user");
};
