// (node専用)ローカルサーバー実行用 index.js.
//

(function () {
    'use strict';

    // mintoユーティリティ.
    const mintoUtil = require("./mintoUtil.js");

    // 本番(lambda/src/index.js)の挙動をローカル実行向けに上書きする処理
    // ("*.local.json"/"*.test.json"の優先解決を含む).
    const lambdaOverrides = require("./lambdaOverrides.js");

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
        // conf/minto.local.jsonが存在する場合はそちらを優先する(ローカル
        // 実行専用の上書き。詳細はlambdaOverrides.resolveLocalConfを参照).
        const _MINTO_CONF = lambdaOverrides.resolveLocalConf(_CURRENT_PATH + "conf/minto.json");
        let mintoConf = undefined;
        if (mintoUtil.existsFileSync(_MINTO_CONF)) {
            mintoConf = mintoUtil.loadJson(_MINTO_CONF);
            // bindPortを取得.
            if (mintoConf.bindPort != undefined) {
                bindPort = mintoConf.bindPort;
            }
        }

        // ENV-config.
        // conf/env.local.jsonが存在する場合はそちらを優先する(同上).
        const _ENV_CONF = lambdaOverrides.resolveLocalConf(_CURRENT_PATH + "conf/env.json");
        if (mintoUtil.existsFileSync(_ENV_CONF)) {
            const envConf = mintoUtil.loadJson(_ENV_CONF);
            // 環境変数に定義条件を割り当てる.
            for (let key in envConf) {
                process.env[key] = envConf[key];
            }
        }

        // minto-localServerを起動.
        webapps.startup(_CURRENT_PATH, bindPort, mintoConf);

    } catch (e) {
        console.error("error", e);
        throw e;
    }

})();