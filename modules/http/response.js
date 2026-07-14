///////////////////////////////////////////////
// JSONレスポンス/エラーレスポンス組み立てヘルパー.
//
// public/*.mt.js から呼び出して利用する.
// lambda/src/index.js の $response() をラップし、
// .mt.js側で毎回書きがちな
//   $response().contentType("application/json", "utf-8");
//   $response().status(status);
//   $response().body(JSON.stringify(data));
// の定型処理を共通化しただけのもの. $response()自体を
// 直接使う分には何ら制限しない(併用可能).
///////////////////////////////////////////////
(function () {
    'use strict';

    // 正常系JSONレスポンスを組み立てる.
    // data レスポンスbodyとして返却するJSオブジェクトを設定します.
    // status HTTPステータスコードを設定します(デフォルト: 200).
    exports.json = function (data, status) {
        const res = $response();
        res.contentType("application/json", "utf-8");
        res.status(status == undefined ? 200 : status);
        res.body(JSON.stringify(data));
    };

    // エラー系JSONレスポンスを組み立てる.
    // status HTTPステータスコードを設定します(例: 400, 404, 500).
    // message エラーメッセージ(文字列)を設定します.
    // extra エラーレスポンスにマージする追加フィールド(JSオブジェクト)を
    //       設定します(省略可。例: { code: "INVALID_PARAM" }).
    exports.error = function (status, message, extra) {
        const body = Object.assign({}, extra, { error: message });
        exports.json(body, status);
    };
})();
