///////////////////////////////////////////////
// (node専用)本番(lambda/src/index.js)の挙動を、ローカル実行・テスト実行
// 向けに上書きするための処理を1箇所にまとめたもの.
//
// tools/webapps.js(minitoコマンド)は、require("../lambda/src/index.js")
// した後、自分自身のコードでglobal.$loadLib/$loadConf等を「ローカル実行
// 向け」に上書きしている。一方tableTool.js/localSqsPoller.jsはwebapps.js
// を経由せずlambda/src/index.jsのhandler()を直接呼び出すため、この上書きが
// 一切行われず、常に本番(lambda/src/index.js)の素の実装のまま動いてしまう。
//
// AIメモ: 以前はtableTool.js/localSqsPoller.jsそれぞれに$loadLibの
// modules/フォールバックだけを個別実装しており(コピペで重複)、$loadConfの
// "*.local.json"/"*.test.json"優先解決は両方とも欠落していた
// (「tableTool経由でconf/table/master.test.jsonを置いても無視される」と
// いう不具合の原因)。本番のlambda/src/index.js自体は一切変更せず、
// このファイルでglobal $xxx を外側から上書きする形に一本化する
// ("*.local.json"/"*.test.json"の解決ロジック自体も、以前はtools/
// mintoUtil.jsに置いていたが、この関心事(本番の置き換え)専用のファイル
// であるここに寄せた).
///////////////////////////////////////////////
(function () {
    'use strict';

    const path = require("path");
    const mintoUtil = require("./mintoUtil.js");

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
    // $loadConf、このファイルのapplyLoadConfLocalOverrideから利用する。
    // tools/mtPack.jsは"*.local.json"・"*.test.json"自体をデプロイzipに
    // 含めないため対象外.
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
            return mintoUtil.existsFileSync(testPath) ? testPath : jsonPath;
        }
        const localPath = base + ".local.json";
        return mintoUtil.existsFileSync(localPath) ? localPath : jsonPath;
    }

    // modulesパス(s3MasterTable.js/s3IndexTable.js/s3Lock.js等の
    // フレームワーク同梱ライブラリ配置先).
    const _MODULES_PATH = path.join(__dirname, "../modules/") + "/";

    // modules以下ディレクトリキャッシュ.
    let _MODULES_DIRS_CACHE = undefined;

    // modules以下ディレクトリのライブラリ呼び出し処理.
    const _requireModules = function (name) {
        let mod = _MODULES_DIRS_CACHE;
        if (mod == undefined) {
            _MODULES_DIRS_CACHE = mintoUtil.listDir(_MODULES_PATH);
            mod = _MODULES_DIRS_CACHE;
        }
        const len = mod.length;
        for (let i = 0; i < len; i++) {
            const libPath = mod[i] + name;
            if (mintoUtil.existsFileSync(libPath)) {
                return require(libPath);
            }
        }
        return null;
    }

    // lambda/src/index.js内の$loadLibは、プロジェクト直下lib/のみを
    // 探索しmodules/へのフォールバックを行わない(webapps.jsがローカル
    // minto実行時にのみ書き換えを行っているため)。webapps.jsを経由しない
    // ツールで同等のmodules/フォールバックを$loadLibに追加する.
    // 戻り値・呼び出し前提: lambda/src/index.jsを既にrequire済みで、
    // global.$loadLibがセットされていること.
    exports.applyLoadLibModulesFallback = function () {
        const _originalLoadLib = global.$loadLib;
        global.$loadLib = function (name) {
            try {
                return _originalLoadLib(name);
            } catch (e) {
                const ret = _requireModules(("" + name).trim().replace(/^\//, ""));
                if (ret != null) {
                    return ret;
                }
                throw e;
            }
        }
    }

    // lambda/src/index.js内の$loadConfは、conf/xxx.jsonをそのまま読むだけで
    // "*.local.json"(ローカル実行専用)・"*.test.json"(MINTO_TEST_MODE設定時の
    // テスト実行専用)への優先解決を行わない(webapps.jsがローカルminto実行時
    // にのみ書き換えを行っているため)。webapps.jsを経由しないツールで同等の
    // 優先解決を$loadConfに追加する.
    // basePath 対象プロジェクトのベースパス(末尾"/"の有無どちらでも可、
    //          mintoLambdaIndex.setBasePath()に渡したものと同じ値を設定する).
    exports.applyLoadConfLocalOverride = function (basePath) {
        if (!basePath.endsWith("/")) {
            basePath += "/";
        }
        const confDir = basePath + "conf/";
        const _originalLoadConf = global.$loadConf;
        global.$loadConf = function (name) {
            let n = ("" + name).trim();
            if (n[0] === "/") {
                n = n.substring(1);
            }
            const resolved = exports.resolveLocalConf(confDir + n);
            const resolvedName = resolved.startsWith(confDir) ?
                resolved.substring(confDir.length) : n;
            return _originalLoadConf(resolvedName);
        }
    }
})();
