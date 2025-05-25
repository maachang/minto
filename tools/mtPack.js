// ローカルのminto 環境を lambda用の zip変換.
//

(function () {
    'use strict';

    // path.
    const path = require("path");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

    // このファイルが存在するディレクトリ.
    // __dirname と同じ.
    const _DIR_NAME = (function () {
        // MINTO_HOMEの環境変数を対象とする.
        ret = process.env["MINTO_HOME"];
        if (ret != undefined) {
            if (!ret.endsWith("/")) {
                ret += "/";
            }
            return ret + "tools/";
        }
        throw new Error("The MINTO_HOME environment variable is not set.");
        // 環境変数が存在しない場合は、requireから取得.
        //return mintoUtil.getRequireResolvePath(require.resolve("./")) + "/";
    })();

    // lambda.index.
    const _LAMBDA_INDEX_JS = path.resolve(_DIR_NAME + "../lambda/src/index.js");

    // lambda.lib.
    const _LAMBDA_LIB_PATH = path.resolve(_DIR_NAME + "../lambda/src/lib") + "/";



})();
