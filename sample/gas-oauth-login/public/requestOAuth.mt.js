// ************************************************************
// public/requestOAuth.mt.js
// GAS oAuth開始: GASへのoAuth用URLを生成し、ブラウザを直接
// そのURLへリダイレクトする(fetch/XHR/JSONPは使わない通常の
// ページ遷移。CORSの制約を受けず、GAS初回利用時の許可画面も
// 通常のWebアプリアクセスとして自然に表示・完了する).
//
// 使い方: /requestOAuth?srcURL=/mypage
//         srcURLはoAuth成功後に最終的に着地させたいアプリ内パス.
// ************************************************************

exports.handler = async function () {
    const req = $request();
    const res = $response();
    const gasAuth = $loadLib("gasAuth.js");

    // GASへのoAuth問い合わせ用URL。GASはoAuth完了後、ブラウザを
    // 直接 /resultOAuth (callbackPath)へリダイレクトさせる.
    const oauthUrl = gasAuth.executeOAuthURL(req, "/resultOAuth");

    res.redirect(oauthUrl);
};
