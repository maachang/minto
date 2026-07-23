// ************************************************************
// public/auth/mfa/authMfaVerify.mt.js
// 2段階認証コードの検証処理(authMfa.mt.htmlからfetch()でJSON POSTされる).
//
// パラメータ(POST json): user, password, code, redirect
//
// user/passwordから(登録時と同じ式で)key1/key2を再計算し、
// modules/auth/mfa.jsのcreate()で生成される「前のコード・現在のコード」の
// いずれかとcodeが一致すれば認証OKとする。
//
// 検証に成功したこの場でmodules/auth/session.jsによりセッションCookieを
// 発行し、redirectはただの遷移先として返す(以前の実装は、検証成功時に
// redirectUrl?user=...を返すだけで、遷移先ページ側がそのuser(GET
// パラメータ)だけを信用してセッションを発行する設計だった。これだと
// 「認証コード検証を経由しないGETアクセスでもセッションが発行できて
// しまう」実質的な抜け道になり得るため、検証とセッション発行をこの
// エンドポイント内で完結させる形に修正した)。
// 一致しない場合は失敗メッセージを返す(画面遷移は行わずauthMfa.mt.html側で
// エラー表示する)。
//
// このパスはログイン必須にしないこと(filter.mt.js側で
// /auth/mfa/ 以下を認証除外に設定する必要がある).
// ************************************************************
exports.handler = async function () {
    const req = $request();
    if (req.method() !== "POST") {
        throw new HttpError({ status: 405, message: "Method Not Allowed" });
    }
    const params = req.params();
    const user = params.user;
    const password = params.password;
    const code = params.code;
    const redirect = params.redirect;
    if (user == undefined || user === "" ||
        password == undefined || password === "" ||
        code == undefined || code === "" ||
        redirect == undefined || redirect === "") {
        throw new HttpError({
            status: 400,
            message: "user/password/code/redirect is required."
        });
    }
    // オープンリダイレクト防止: 相対パス以外は許可しない.
    if (!redirect.startsWith("/")) {
        throw new HttpError({ status: 400, message: "Invalid redirect." });
    }

    const mfaConf = $loadConf("mfa.json");
    if (mfaConf == null || mfaConf.keyCode == undefined || mfaConf.keyCode === "") {
        throw new HttpError({
            status: 500,
            message: "conf/mfa.json(keyCode)の設定が必要です."
        });
    }

    const mfaKey = $loadLib("mfaKey.js");
    const host = req.header("host");
    const keys = mfaKey.compute(user, password, host);

    const mfa = $loadLib("mfa.js");
    const mfaLen = mfaConf.mfaLen || 6;
    const updateTime = mfaConf.updateTime || 30;
    const codes = mfa.create(
        [], mfaConf.keyCode, user, keys.key1, keys.key2, mfaLen, updateTime);

    // codes: [0]前のコード [1]現在のコード [2]次のコード.
    // 時計のずれを許容するため前/現在のいずれかに一致すればOKとする
    // (未来の"次のコード"は許容しない).
    if (code !== codes[0] && code !== codes[1]) {
        return { success: false, message: "認証コードが正しくありません。" };
    }

    // 検証成功: この場でセッションCookieを発行する.
    const session = $loadLib("session.js");
    await session.setCookie(user, {});

    return { success: true, redirectUrl: redirect };
};
