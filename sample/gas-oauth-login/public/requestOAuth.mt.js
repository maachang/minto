// ************************************************************
// public/requestOAuth.mt.js
// GAS oAuth開始: GASへのoAuth用URL・許可用URLを生成して
// requestOAuth.html(ブラウザ側でJSONP実行)へリダイレクトする.
//
// 使い方: /requestOAuth?srcURL=/mypage
//         srcURLはoAuth成功後に最終的に着地させたいアプリ内パス.
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const res = $response();
    const gasAuth = $loadLib("gasAuth.js");

    // GASへのoAuth問い合わせ用URL(JSONPでアクセスする).
    const oauthUrl = gasAuth.executeOAuthURL(req);
    // GASのアカウントデータ利用許可用URL(初回のみブラウザで直接開く).
    const allowAd = gasAuth.allowAccountDataURL();

    res.redirect(
        "/requestOAuth.html?oauthUrl=" + encodeURIComponent(oauthUrl) +
        "&allowAd=" + encodeURIComponent(allowAd)
    );
};
