// tools関連のユーティリティ系.
//

(function () {
    'use strict';

    const fs = require("fs");

    // 指定ディレクトリ以下のディレクトリ群を取得.
    // path: 対象のパスを設定します.
    // resultKeyValue: true を設定した場合は返却値が 辞書型返却されます.
    //                 true 以外の場合はリスト型返却されます.
    // recursive: 指定ディレクトリ以下を再起実行する場合は trueを設定します.
    // 戻り値: resultKeyValue == trueの場合辞書型で返却.
    //         falseの場合リスト型で返却.
    exports.listDir = function (path, resultKeyValue, recursive) {
        path = !path.endsWith("/") ? path + "/" : path;
        const lst = fs.readdirSync(
            path, { withFileTypes: true, recursive: recursive == true });
        const len = lst.length;
        let pp;
        // key, value での戻り値じゃない場合.
        if (resultKeyValue != true) {
            // リスト返却.
            const ret = [];
            for (let i = 0; i < len; i++) {
                if (lst[i].isDirectory()) {
                    pp = lst[i].parentPath;
                    if (pp != path) {
                        pp = path + pp + "/";
                    }
                    ret.push(pp + lst[i].name + "/");
                }
            }
            return ret;
        } else {
            // 辞書型で返却.
            const ret = {};
            let keyHead
            for (let i = 0; i < len; i++) {
                if (lst[i].isDirectory()) {
                    pp = lst[i].parentPath;
                    if (pp != path) {
                        pp = path + pp + "/";
                        keyHead = pp.substring(path.length);
                    } else {
                        keyHead = "";
                    }
                    ret[keyHead + lst[i].name] = pp + lst[i].name + "/";
                }
            }
            return ret;
        }
    }

    // 指定ディレクトリ以下のファイル一覧を取得します.
    // path: 対象のパスを設定します.
    // resultKeyValue: true を設定した場合は返却値が 辞書型返却されます.
    //                 true 以外の場合はリスト型返却されます.
    // recursive: 指定ディレクトリ以下を再起実行する場合は trueを設定します.
    // 戻り値: resultKeyValue == trueの場合辞書型で返却.
    //         falseの場合リスト型で返却.
    exports.listFile = function (path, resultKeyValue, recursive) {
        path = !path.endsWith("/") ? path + "/" : path;
        const lst = fs.readdirSync(
            path, { withFileTypes: true, recursive: recursive == true });
        const len = lst.length;
        const ret = [];
        let pp;
        // key, value での戻り値じゃない場合.
        if (resultKeyValue != true) {
            // リスト返却.
            const ret = [];
            for (let i = 0; i < len; i++) {
                if (lst[i].isFile()) {
                    pp = lst[i].parentPath;
                    if (pp != path) {
                        pp = path + pp + "/";
                    }
                    ret.push(pp + lst[i].name + "/");
                }
            }
            return ret;
        } else {
            // 辞書型で返却.
            const ret = {};
            let keyHead
            for (let i = 0; i < len; i++) {
                if (lst[i].isFile()) {
                    pp = lst[i].parentPath;
                    if (pp != path) {
                        pp = path + pp + "/";
                        keyHead = pp.substring(path.length);
                    } else {
                        keyHead = "";
                    }
                    ret[keyHead + lst[i].name] = pp + lst[i].name + "/";
                }
            }
            return ret;
        }
    }

    // 指定ファイルが存在するか確認.
    // name 存在確認のファイル名を設定.
    // 戻り値: trueの場合存在します.
    exports.existsFileSync = function (name) {
        try {
            return fs.statSync(name).isFile();
        } catch (e) {
            return false;
        }
    }

    // 指定ディレクトリが存在するか確認.
    // name 存在確認のディレクトリ名を設定.
    // 戻り値: trueの場合存在します.
    exports.existsDirSync = function (name) {
        try {
            return fs.statSync(name).isDirectory();
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