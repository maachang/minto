// ************************************************************
// public/assets/jsonp.js
// GAS(GoogleAppsScript)へのJSONPアクセス用ヘルパー.
//
// 会社契約のGoogleWorkspace配下のGASは、XMLHttpRequest/fetchでの
// ドメイン超えアクセスがエラーになるため、scriptタグを使った
// JSONPでしかアクセスできない(詳細はREADME.md参照)。
// ************************************************************
(function (_g) {
    'use strict';

    // ランダムID生成(コールバック関数名の一意化用).
    const randomID = function () {
        return Math.random().toString(36).substring(2);
    };

    // 次のイベントループで実行(即時コールバック).
    const delayCall = function (fn) {
        setTimeout(fn, 0);
    };

    // 少し遅らせて実行(scriptタグ・グローバル関数の後始末用).
    const longDelayCall = function (fn) {
        setTimeout(fn, 5000);
    };

    // jsonp呼び出し.
    // url jsonp先のURLを設定します.
    //     このURL先のresponseヘッダはcontent-type=application/json である必要があります.
    // callback jsonpの実行結果を格納する function(json) を設定します.
    // successCall ロードがsuccessの場合に呼び出されます.
    // errorCall ロードがerrorの場合に呼び出されます
    //     (GASの初回利用許可画面がJSONPレスポンスとして返ってきた場合、
    //     期待するjsonpコールバックが呼ばれないままloadイベントだけ
    //     発生するため、この場合もerrorCall扱いになる)。
    // errorTimeout ロードエラーの判定用タイムアウト値(ミリ秒)を設定します.
    //              設定しない場合は2.5秒がセットされます.
    // callbackParamsName jsonp先に渡すコールバック対象の変数名を設定します.
    //     未設定の場合 `jsonpCall` が設定されます.
    _g.jsonp = function (
        url, callback, successCall, errorCall, errorTimeout, callbackParamsName) {
        if (callbackParamsName == undefined ||
            callbackParamsName == null ||
            callbackParamsName == "") {
            callbackParamsName = "jsonpCall";
        }
        // ランダムなjsonpコールバックメソッド名を生成.
        const callbackName =
            "_$_$_$jsonp_$" +
            Date.now().toString(16) + randomID();
        const em = document.createElement("script");

        url += (url.indexOf("?") != -1 ? "&" : "?") +
            callbackParamsName + "=" + callbackName;
        em.src = url;
        const head = document.getElementsByTagName("head");
        let successFlag = false;

        // グローバルにjsonp処理結果呼び出しのコールバックメソッドを定義.
        _g[callbackName] = function (json) {
            successFlag = true;
            delayCall(function () {
                if (typeof (successCall) == "function") {
                    try {
                        successCall();
                    } catch (e) {
                        console.error(
                            "[error]successCall処理でエラーが発生しました", e);
                    }
                }
                callback(json);
            });
            longDelayCall(function () {
                delete _g[callbackName];
                head[0].removeChild(em);
            });
        };

        if (typeof (errorCall) == "function") {
            // chromeの場合、失敗してもloadイベントが発火するので、
            // load後に一定時間jsonpコールバックが呼ばれなければ
            // エラー扱いにする.
            em.addEventListener("load", function () {
                errorTimeout = errorTimeout | 0;
                if (errorTimeout <= 0) {
                    errorTimeout = 2500;
                }
                setTimeout(function () {
                    if (!successFlag) {
                        errorCall();
                    }
                }, errorTimeout);
            }, false);
            // firefoxの場合は素直にerrorイベントが発火する.
            em.addEventListener("error", function () {
                delayCall(function () {
                    errorCall();
                });
            });
        }

        head[0].appendChild(em);
    };
})(window);
