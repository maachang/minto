// tools関連のユーティリティ系.
//

(function () {
    'use strict';

    const fs = require("fs");

    // 指定ファイルやディレクトリが存在するか確認.
    // existsSyncをstatSyncで代用(existsSync=Deprecated)
    // name 存在確認のファイル名 or ディレクトリ名を設定.
    // 戻り値: trueの場合存在します.
    exports.existsSync = function (name) {
        try {
            fs.statSync(name);
            return true;
        } catch (e) {
            return false;
        }
    }

    // jsonファイルをロード.
    exports.loadJson = function (name) {
        return JSON.parse(fs.readFileSync(name));
    }

    // require.resolve("./") に対するパスを取得.
    // __dirname と同じ結果が返却される(ただ現在__dirnameは非推奨).
    // あとこれは llrt では利用出来ない(node専用).
    exports.getRequireResolvePath = function (value) {
        let p = value.lastIndexOf("/");
        if (p == -1) {
            return value;
        }
        return value.substring(0, p);
    }
})();