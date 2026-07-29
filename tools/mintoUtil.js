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
    // dirent.parentPath を常に末尾"/"付きの絶対パスに正規化する.
    // NodeとBunで parentPath の末尾スラッシュ有無が異なるため、
    // 単純な文字列比較(pp != path)に依存すると環境によって
    // パスが二重結合されて壊れる不具合があったため、常に
    // parentPathをそのまま正としてスラッシュのみ補う方式にする.
    const _normalizeParentPath = function (pp) {
        return !pp.endsWith("/") ? pp + "/" : pp;
    }

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
                    pp = _normalizeParentPath(lst[i].parentPath);
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
                    pp = _normalizeParentPath(lst[i].parentPath);
                    keyHead = pp.startsWith(path) ? pp.substring(path.length) : "";
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
        let pp;
        // key, value での戻り値じゃない場合.
        if (resultKeyValue != true) {
            // リスト返却.
            const ret = [];
            for (let i = 0; i < len; i++) {
                if (lst[i].isFile()) {
                    pp = _normalizeParentPath(lst[i].parentPath);
                    ret.push(pp + lst[i].name);
                }
            }
            return ret;
        } else {
            // 辞書型で返却.
            const ret = {};
            let keyHead
            for (let i = 0; i < len; i++) {
                if (lst[i].isFile()) {
                    pp = _normalizeParentPath(lst[i].parentPath);
                    keyHead = pp.startsWith(path) ? pp.substring(path.length) : "";
                    ret[keyHead + lst[i].name] = pp + lst[i].name;
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

    // テストモードを示す環境変数名.
    // test/配下のテストが子プロセス起動時に明示的に付与する(node:testで
    // 実行されていること自体からの自動判定は行わない).
    const _TEST_MODE_ENV = "MINTO_TEST_MODE";

    // 実行中がテストモードかどうかを判定する.
    // 戻り値: 環境変数 MINTO_TEST_MODE が "true" または "1" の場合true.
    exports.isTestMode = function () {
        const v = process.env[_TEST_MODE_ENV];
        return v === "true" || v === "1";
    }

    // ローカル実行専用の"*.local.json"、テスト実行専用の"*.test.json"
    // オーバーライドを解決する.
    // - テストモード(環境変数 MINTO_TEST_MODE)の場合: 同名の"xxx.test.json"
    //   が存在すればそちらを使う("xxx.local.json"は一切参照しない。
    //   開発者個人のローカル設定がテストに混入するのを防ぐため)。
    //   存在しなければ元の"xxx.json"を使う.
    // - 通常時: 同名の"xxx.local.json"が存在すればそちらを使う。
    //   無ければ元の"xxx.json"を使う.
    // 存在確認自体は呼び出し元で行う(このため.jsonで終わらないパスや、
    // 既に.local.json/.test.jsonのパスはそのまま返す=二重解決しない).
    // tools/index.jsのconf/env.json・conf/minto.json、tools/webapps.jsの
    // $loadConfから利用する。tools/mtPack.jsは"*.local.json"・
    // "*.test.json"自体をデプロイzipに含めないため対象外.
    // jsonPath 対象の.jsonファイルパス(末尾が.json)を設定します.
    // 戻り値: 実際に使用すべきパス(文字列)が返却されます.
    exports.resolveLocalConf = function (jsonPath) {
        if (!jsonPath.endsWith(".json") ||
            jsonPath.endsWith(".local.json") ||
            jsonPath.endsWith(".test.json")) {
            return jsonPath;
        }
        const base = jsonPath.substring(0, jsonPath.length - ".json".length);
        if (exports.isTestMode()) {
            const testPath = base + ".test.json";
            return exports.existsFileSync(testPath) ? testPath : jsonPath;
        }
        const localPath = base + ".local.json";
        return exports.existsFileSync(localPath) ? localPath : jsonPath;
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