// (node専用)ローカルサーバー実行用 index.js.
//

(function () {
    'use strict';

    // mintoユーティリティ.
    const mintoUtil = require("./mintoUtil.js");

    // ローカルログ(console.log関連のwrapper).
    const localLog = require("./localLog.js");

    // 現在実行中のフルパス(pwd).
    const _CURRENT_PATH = require("path").resolve() + "/";

    // ログ初期化.
    const _initLog = function () {
        // log設定を読み込む.
        const confPath = _CURRENT_PATH + "conf/log.conf";
        if (mintoUtil.existsFileSync(confPath)) {
            const conf = mintoUtil.loadJson(confPath);
            localLog.setting(conf);
        } else {
            localLog.setting();
        }
    }

    // ログ初期化処理.
    _initLog();

    try {

        // webapps実行.
        const webapps = require("./webapps.js");

        // サーバーポート(デフォルトポートで実施).
        let bindPort = undefined;

        // MINTO-config.
        const _MINTO_CONF = _CURRENT_PATH + "conf/minto.json";
        let mintoConf = undefined;
        if (mintoUtil.existsFileSync(_MINTO_CONF)) {
            mintoConf = mintoUtil.loadJson(_MINTO_CONF);
            // bindPortを取得.
            if (mintConf.bindPort != undefined) {
                bindPort = mintConf.bindPort;
            }
        }

        // ENV-config.
        const _ENV_CONF = _CURRENT_PATH + "conf/env.json";
        if (mintoUtil.existsFileSync(_ENV_CONF)) {
            const envConf = mintoUtil.loadJson(_ENV_CONF);
            // 環境変数に定義条件を割り当てる.
            for (let key in envConf) {
                prcess.env[key] = envConf[key];
            }
        }

        // minto-localServerを起動.
        webapps.startup(_CURRENT_PATH, bindPort, mintoConf);

    } catch (e) {
        console.error("error", e);
        throw e;
    }

})();