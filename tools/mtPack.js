// ローカルのminto 環境を lambda用にzip変換で デプロイ生成.
//

(function () {
    'use strict';

    // path.
    const path = require("path");
    // fs.
    const fs = require('fs');
    // zlib.
    const zlib = require('zlib');
    // crypto.
    const crypto = require('crypto');
    // execCommand.
    const { execSync } = require("child_process");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

    // jhtml.
    const jhtml = require("./jhtml.js");

    // args.
    const args = require("./args.js");

    // mintoメイン.
    require("../lambda/src/index.js");

    // コマンド名.
    const COMMAND_NAME = "mtpk";

    // このファイルが存在するディレクトリで `__dirname` と同じ.
    //  - $MINTO_HOME/tools/
    // が返却される.
    const __DIR_NAME = (function () {
        // MINTO_HOMEの環境変数を対象とする.
        let ret = process.env["MINTO_HOME"];
        if (ret != undefined) {
            if (!ret.endsWith("/")) {
                ret += "/";
            }
            return ret + "tools/";
        }
        throw new Error("The MINTO_HOME environment variable is not set.");
    })();

    // 実行対象拡張子(js).
    const _RUN_JS = ".mt.js";

    // jhtmlファイル拡張子.
    const JHTML_NAME = ".mt.html";

    // modulesディレクトリ.
    const _MODULES_PATH = path.resolve(__DIR_NAME + "../modules") + "/";

    // modules以下のディレクトリ一覧(辞書型).
    // ここに利用可能なライブラリが入ってる.
    const _MODULES_DICT = mintoUtil.listDir(_MODULES_PATH, true);

    // lambda.index path.
    const _LAMBDA_INDEX_PATH = path.resolve(__DIR_NAME + "../lambda/src") + "/";

    // lambda.lib.
    //const _LAMBDA_LIB_PATH = _LAMBDA_INDEX_PATH + "lib/";

    // lambda.conf.
    const _LAMBDA_CONF_PATH = _LAMBDA_INDEX_PATH + "conf/";

    // カレントパス.
    const _CURRENT_PATH = require("path").resolve() + "/";

    // カレント.public.
    const _CURRENT_PUBLIC_PATH = _CURRENT_PATH + "public/";

    // カレント.lib.
    const _CURRENT_LIB_PATH = _CURRENT_PATH + "lib/";

    // カレント.conf.
    const _CURRENT_CONF_PATH = _CURRENT_PATH + "conf/";

    // etags.conf.
    const _ETAGS_CONF_FILE = "conf/etags.json";

    // 作業ディレクトリ.
    const _WORK_DIR = _CURRENT_PATH + ".workDir/";

    // 圧縮結果のファイル名.
    const _ZIP_FILE = "mtpack.zip";

    // 標準出力.
    const p = function (out) {
        console.log(out);
    }

    // ディレクトリ終端を整形.
    const trimDir = function (dirName) {
        if (!dirName.endsWith("/")) {
            return dirName + "/";
        }
        return dirName;
    }

    // 指定ディレクトリを削除.
    // path 削除対象のディレクトリ名を設定します.
    // 戻り値: true の場合、ディレクトリ削除が成功しました.
    const removeDir = function (path) {
        // コマンドで実行.
        return execSync("rm -Rf " + path);
    }

    // 指定ディレクトリを生成.
    // path 生成対象のディレクトリ名を設定します.
    // 戻り値: true の場合、ディレクトリ生成が成功しました.
    const createDir = function (path) {
        try {
            // mkdirsで作成する.
            fs.mkdirSync(path, { recursive: true });
            return true;
        } catch (e) {
            return false;
        }
    }

    // コマンドでjsのminify実行.
    // src 対象元のファイル＋パスを設定します.
    // dest 対象先のファイル＋パスを設定します.
    // consoleOff: true の場合 console.log 関連を削除します.
    const cmdMimify = function (src, dest, consoleOff) {
        consoleOff = consoleOff == true
        try {
            execSync("uglifyjs " + src +
                " --compress drop_console=" + consoleOff +
                " --mangle -o " +
                dest);
        } catch (e) {
            throw new Error("uglifyjs command does not exist")
        }
    }

    // ファイルのコピー実行.
    // src 対象元のファイル＋パスを設定します.
    // dest 対象先のファイル＋パスを設定します.
    const cpFile = function (src, dest) {
        // ファイルをコピーする.
        fs.copyFileSync(src, dest);
    }

    // 指定ファイルの削除.
    const rmvFile = function (fileName) {
        fs.unlinkSync(fileName);
    }

    // 指定ファイルの移動.
    const mvFile = function (src, dest) {
        fs.renameSync(src, dest);
    }

    // gz変換.
    // src 対象元のファイル＋パスを設定します.
    // dest 対象先のファイル＋パスを設定します.
    const convGz = function (src, dest) {
        // gz変換.
        const content = fs.readFileSync(src);
        const res = zlib.gzipSync(content);
        fs.writeFileSync(dest, res);
    }

    // [public]ファイルハッシュを生成.
    const _FILE_HASH_LIST = {};
    const publicFileHash = function (path, fileName) {
        // ターゲットはworkディレクトリ + public 以下.
        const workPublic = _WORK_DIR + "public/"
        if (!path.startsWith(workPublic)) {
            return false;
        }
        const content = fs.readFileSync(path + "/" + fileName);
        const hash = crypto.createHash('sha256')
            .update(content).digest("hex");
        const target = "/" + (path + fileName).substring(workPublic.length);
        _FILE_HASH_LIST[target] = hash;
        return true;
    }

    // 指定ディレクトリを再帰的ループする.
    const targetDirLoop = function (
        srcBaseDir, destBaseDir, dirName, callOptions, callback) {
        srcBaseDir = trimDir(srcBaseDir);
        destBaseDir = trimDir(destBaseDir);
        dirName = trimDir(dirName);
        // ディレクトリ以下のファイル or ディレクトリ一覧を取得.
        let content, lst, len;
        try {
            lst = fs.readdirSync(dirName,
                { withFileTypes: true, recursive: false });
        } catch (e) {
            return;
        }
        len = lst.length;
        for (let i = 0; i < len; i++) {
            content = lst[i];
            // 対象条件を取得.
            if (content.isFile()) {
                // コピー先のディレクトリを取得.
                const nowDir = getNowDir(srcBaseDir, dirName);
                const destDirName = trimDir(destBaseDir + nowDir);
                // file: 指定コールバックfunctionを実行.
                callback(srcBaseDir, destBaseDir, dirName, destDirName, content.name,
                    callOptions);
            } else {
                // dir: 再帰実行.
                targetDirLoop(
                    srcBaseDir, destBaseDir, dirName + content.name, callOptions,
                    callback);
            }
        }
    }

    // 現在の階層ディレクトリを取得.
    const getNowDir = function (baseDir, dirName) {
        if (dirName.startsWith(baseDir)) {
            return dirName.substring(baseDir.length);
        }
        throw new Error(
            "baseDir and dirName prefixes do not match:(baseDir" +
            baseDir + " dirName: " + dirName + ")");
    }

    // 実行オプションを取得.
    const getOptions = function () {
        const ret = {};
        // jsMin.
        ret["min"] = args.isValue("-m", "--min", "-all", "--all");
        // etag.
        ret["etag"] = args.isValue("-e", "--etag", "-all", "--all");
        // gz.
        ret["gz"] = args.isValue("-z", "--gz", "-all", "--all");
        return ret;
    }

    // 拡張子を取得.
    const _extends = function (path) {
        // 最後が / の場合は拡張子なし.
        if (path.endsWith("/")) {
            return undefined;
        }
        // 最後にある / の位置を取得.
        let p = path.lastIndexOf("/");
        const ex = path.substring(p);
        p = ex.lastIndexOf(".");
        if (p == -1) {
            return "";
        }
        return ex.substring(p + 1)
            .trim().toLowerCase();
    }

    // jsをミニマム実行(パラメータ指定).
    const _convMinJs = function (target, opt) {
        // jsMin処理を行なう場合.
        if (opt["min"] == true) {
            p("  => min-js: " + target);
            // minify実行.
            cmdMimify(target, target + ".min");
            // 元のファイルを削除.
            rmvFile(target);
            // 元のファイルに移動.
            mvFile(target + ".min", target);
        }
    }

    // パラメータが all指定
    const isAllModules = function () {
        const target = args.get("-t", "--target");
        if (target == "all") {
            return true;
        }
        return false;
    }

    // 全てのの modulesディレクトリ定義の取り込み処理.
    const packAllModules = function (opt) {
        p("# [all modules]");
        let srcPath;
        for (let target in _MODULES_DICT) {
            // 対象モジュール名が存在する場合.
            srcPath = _MODULES_DICT[target];
            // 指定されたモジュール内容をコピーする.
            p("  # modules(" + target + "): " + srcPath);
            targetDirLoop(srcPath, _WORK_DIR + "lib", srcPath, opt,
                function (srcBaseDir, destBaseDir, dirName, destDirName, fileName, callOpt) {
                    p("   > copy: " + dirName + fileName);
                    // コピー先のディレクトリ名を生成.
                    createDir(destDirName);
                    // ファイルコピー.
                    cpFile(dirName + fileName, destDirName + fileName);
                    // lib = js関連.
                    if (fileName.endsWith(".js")) {
                        _convMinJs(destDirName + fileName, opt);
                    }
                });
        }
    }

    // minto modulesディレクトリに対する指定pack処理.
    // この指定処理は条件指定で取り込み処理を行います.
    const packTargetModules = function (opt) {
        p("# [target modules]");
        let cnt = 0;
        // モジュール(modulesディレクトリ内のディレクトリ名指定)
        // これの条件を取得して処理する.
        let target, srcPath;
        for (let i = 0; ; i++) {
            // 指定パラメータのモジュール内容をコピーする.
            target = args.next(i, "-t", "--target");
            if (target == null) {
                if (cnt == 0) {
                    p("  # no modules");
                }
                return;
            }
            // 対象モジュール名が存在する場合.
            srcPath = _MODULES_DICT[target];
            if (srcPath == undefined) {
                continue;
            }
            // 指定されたモジュール内容をコピーする.
            p("  # modules(" + target + "): " + srcPath);
            targetDirLoop(srcPath, _WORK_DIR + "lib", srcPath, opt,
                function (srcBaseDir, destBaseDir, dirName, destDirName, fileName, callOpt) {
                    p("   > copy: " + dirName + fileName);
                    // コピー先のディレクトリ名を生成.
                    createDir(destDirName);
                    // ファイルコピー.
                    cpFile(dirName + fileName, destDirName + fileName);
                    // lib = js関連.
                    if (fileName.endsWith(".js")) {
                        _convMinJs(destDirName + fileName, opt);
                    }
                });
            cnt++;
        }
    }

    // lib関連のpack処理.
    const packLib = function (opt, srcPath) {
        p("# lib: " + srcPath);
        // lambda lib 処理.
        createDir(_WORK_DIR + "lib")
        targetDirLoop(srcPath, _WORK_DIR + "lib", srcPath, opt,
            function (srcBaseDir, destBaseDir, dirName, destDirName, fileName, callOpt) {
                p(" > copy: " + dirName + fileName);
                // コピー先のディレクトリ名を生成.
                createDir(destDirName);
                // ファイルコピー.
                cpFile(dirName + fileName, destDirName + fileName);
                // lib = js関連.
                if (fileName.endsWith(".js")) {
                    _convMinJs(destDirName + fileName, opt);
                }
            });
    }

    // conf関連のpack処理.
    const packConf = function (opt, srcPath) {
        p("# conf: " + srcPath);
        // lambda lib 処理.
        createDir(_WORK_DIR + "conf")
        targetDirLoop(srcPath, _WORK_DIR + "conf", srcPath, opt,
            function (srcBaseDir, destBaseDir, dirName, destDirName, fileName, callOpt) {
                p(" > copy: " + dirName + fileName);
                // コピー先のディレクトリ名を生成.
                createDir(destDirName);
                // ファイルコピー.
                cpFile(dirName + fileName, destDirName + fileName);
            });
    }


    // lib関連のpack処理.
    const packPublic = function (opt, srcPath) {
        p("# public: " + srcPath);
        // lambda lib 処理.
        createDir(_WORK_DIR + "public")
        targetDirLoop(srcPath, _WORK_DIR + "public", srcPath, opt,
            function (srcBaseDir, destBaseDir, dirName, destDirName, fileName, callOpt) {
                p(" > copy: " + dirName + fileName);
                // コピー先のディレクトリ名を生成.
                createDir(destDirName);
                // ファイルコピー.
                cpFile(dirName + fileName, destDirName + fileName);

                // 動的実行ファイル(minto実行系)チェック.
                if (fileName.endsWith(_RUN_JS)) {
                    ///////////////////////
                    // mt.js の場合 min実行.
                    _convMinJs(destDirName + fileName, callOpt);
                    return;
                } else if (fileName.endsWith(JHTML_NAME)) {
                    ///////////////////////
                    // jhtml を js変換.
                    p("  => conv jhtml: " + destDirName + fileName);
                    const outJs = jhtml.convert(
                        fs.readFileSync(destDirName + fileName).toString());
                    // 元のファイル(jhtml)を削除.
                    rmvFile(destDirName + fileName);
                    // ファイル名をjhtmlからjs名に変換.
                    fileName = jhtml.changeExtensionByJhtmlToJs(fileName);
                    // 変換結果をファイル出力.
                    fs.writeFileSync(destDirName + fileName, outJs);
                    // jhtml.js の場合 min実行.
                    _convMinJs(destDirName + fileName, callOpt);
                    return;
                }

                // jsファイルの場合.
                if (fileName.endsWith(".js")) {
                    ///////////////////////
                    // js-min.
                    _convMinJs(destDirName + fileName, callOpt);
                }

                // publicHashが有効な場合.
                if (callOpt["etag"] == true) {
                    ///////////////////////
                    // etag生成.
                    publicFileHash(destDirName, fileName)
                }

                // gzip変換が有効な場合.
                if (callOpt["gz"] == true) {
                    ///////////////////////
                    // gzip変換.
                    const mime = $mime(_extends(fileName), true);
                    if (mime != null && mime["gz"] == true) {
                        // gzが有効な場合、対象ファイルをgz変換.
                        p("  => conv gz: " + destDirName + fileName);
                        convGz(destDirName + fileName, destDirName + fileName + ".gz");
                        // 元のファイルを削除.
                        rmvFile(destDirName + fileName)
                    }
                }
            });
    }

    // lambdaソース元の index.js ファイル名.
    const _SRC_INDEX_JS = "index.js";

    // lambdaにデプロイする時の index.js ファイル名.
    const _DEPLOY_INDEX_JS = "index.cjs";

    // lambda index.js をPack処理.
    const packIndexJs = function (opt) {
        p("# copy: " + _LAMBDA_INDEX_PATH + _SRC_INDEX_JS);
        // ファイルコピー.
        cpFile(_LAMBDA_INDEX_PATH + _SRC_INDEX_JS, _WORK_DIR + _DEPLOY_INDEX_JS);
        // jsMin.
        _convMinJs(_WORK_DIR + _DEPLOY_INDEX_JS, opt);
    }

    // FileHashが利用対象の場合は conf/etags.json に出力.
    const outputFileHashConf = function (opt) {
        if (opt["etag"] != true) {
            return false;
        }
        p("# create: " + _ETAGS_CONF_FILE);
        createDir(_WORK_DIR + "/conf");
        fs.writeFileSync(_WORK_DIR + _ETAGS_CONF_FILE,
            JSON.stringify(_FILE_HASH_LIST, null, "    "));
    }

    // zip圧縮.
    const convZip = function () {
        p("# deploy zip: " + _ZIP_FILE);
        execSync("cd " + _WORK_DIR + "; zip archive -r ./");
        execSync("mv " + _WORK_DIR + "archive.zip " + _CURRENT_PATH + _ZIP_FILE);
        // workディレクトリを削除.
        removeDir(_WORK_DIR);
        p("   ... success");
    }

    // 実行処理.
    const runCommand = function () {
        if (args.isValue("-h", "--help")) {
            help();
            return;
        }
        // 実行オプションを取得.
        const opt = getOptions();
        p("# " + COMMAND_NAME + ": " + JSON.stringify(opt));

        // 一時ディレクトリを削除+作成.
        removeDir(_WORK_DIR);
        createDir(_WORK_DIR);

        // 全てのモジュールpack指定の場合.
        if (isAllModules()) {
            // 全 modules 処理.
            packAllModules(opt);
        } else {
            // 個別 modules 処理.
            packTargetModules(opt);
        }

        // current Lib 処理.
        packLib(opt, _CURRENT_LIB_PATH);

        // lambda conf 処理.
        packConf(opt, _LAMBDA_CONF_PATH);

        // current conf 処理.
        packConf(opt, _CURRENT_CONF_PATH);

        // currentPublic 処理.
        packPublic(opt, _CURRENT_PUBLIC_PATH);

        // index.js 処理.
        packIndexJs(opt);

        // etags.json を出力.
        outputFileHashConf(opt);

        // zip圧縮.
        convZip();

        p("# exit " + COMMAND_NAME + ".");
    }

    // help.
    const help = function () {
        // help表示.
        p("Usage: " + COMMAND_NAME + " [OPTION]...");
        p(" Deploy the minto environment to AWS lambda.");
        p("[OPTION]:")
        p("  -m or --min:");
        p("    Minify your js files with uglifyjs.")
        p("  -e or --etag:");
        p("    Enables etag caching for contents.")
        p("  -z or --gz:");
        p("    The contents will be gz-compressed if gz is enabled.")
        p("  -all or --all:");
        p("    Enables the min, etag, and gz options.")
        p("  -t or --target:")
        p("    Packs a module by specifying the target module name.")
        p("    To pack all modules, set it to `-t all` or `--target all`.")
        p("    Also, this parameter has no relation to the parameter -all or --all.")
        p("");
    }

    // コマンド実行処理.
    runCommand();
})();
