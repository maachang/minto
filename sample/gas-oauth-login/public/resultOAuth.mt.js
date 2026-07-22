// ************************************************************
// public/resultOAuth.mt.js
// GAS oAuthコールバック受信: メールアドレスを検証・取得し、
// ログインセッションを作成した上で元々アクセスしたかったURLへ
// リダイレクトする.
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const res = $response();
    const gasAuth = $loadLib("gasAuth.js");

    // mail/redirectToken/type/tokenKeyを検証し、メールアドレスを取得
    // (検証失敗時はHttpErrorがthrowされる).
    const mail = gasAuth.getOAuthMail(req);

    // S3セッション作成＋Cookie設定を1回で行う(modules/auth/session.js。
    // ユーザーIDとしてメールアドレスをそのまま使う).
    const conf = $loadConf("app.json");
    const session = $loadLib("session.js").create({
        bucket: conf.s3Bucket,
        prefix: conf.sessionPrefix,
        timeoutMin: conf.sessionTimeoutMin,
        region: conf.region
    });
    await session.setCookie(mail, { mail: mail });

    // 元々アクセスしたかったURLへリダイレクト(無ければマイページへ).
    const srcURL = req.params()["srcURL"];
    if (srcURL != null && srcURL !== "") {
        res.redirect(gasAuth.encodeRedirectUrlParams(srcURL));
    } else {
        res.redirect("/mypage");
    }
};
