///////////////////////////////////////////////
// (node専用)$loadLib参照チェックツール.
//
// プロジェクトの public/**/*.mt.js・public/**/*.mt.html・lib/**/*.js を
// 走査して `$loadLib("xxx.js")` の呼び出しを検出し、その参照先が
//   1. プロジェクトの lib/ 配下に既に存在する(OK. mtpkでもそのまま同梱される)
//   2. lib/には無いが $MINTO_HOME/modules/{カテゴリ名}/ 配下に存在する
//      (ローカルの`minto`コマンド実行時はtools/webapps.jsのmodules/フォール
//      バックで動くが、`mtpk`でのデプロイパッケージには対象カテゴリを
//      `-t {カテゴリ名}`で明示指定しない限り含まれない)
//   3. lib/にもmodules/のどのカテゴリにも見つからない(参照先が存在しない
//      か、独自libファイルの配置漏れの可能性)
// のいずれかを判定してレポートする。
//
// `mtpk`実行時に`-t`指定を忘れて本番(AWS Lambda)でのみ$loadLibが失敗する
// 事故を、デプロイ前にローカルで検出できるようにするためのツール。
//
// 起動パラメータ: [-v/--verbose] (指定時、各参照名を使用しているファイル
// 一覧も表示する)
///////////////////////////////////////////////
(function () {
    'use strict';

    const path = require("path");
    const args = require("./args.js");
    const mintoUtil = require("./mintoUtil.js");

    // コマンド名.
    const COMMAND_NAME = "checkModules";

    // このファイルが存在するディレクトリ($MINTO_HOME/tools/).
    const __DIR_NAME = (function () {
        let ret = process.env["MINTO_HOME"];
        if (ret != undefined) {
            if (!ret.endsWith("/")) {
                ret += "/";
            }
            return ret + "tools/";
        }
        throw new Error("The MINTO_HOME environment variable is not set.");
    })();

    // modulesディレクトリ($MINTO_HOME/modules/).
    const _MODULES_PATH = path.resolve(__DIR_NAME + "../modules") + "/";

    // modules以下のカテゴリディレクトリ一覧(辞書型: {カテゴリ名: パス}).
    const _MODULES_DICT = mintoUtil.listDir(_MODULES_PATH, true);

    // カレント(対象プロジェクト)パス.
    const _CURRENT_PATH = path.resolve() + "/";
    const _CURRENT_PUBLIC_PATH = _CURRENT_PATH + "public/";
    const _CURRENT_LIB_PATH = _CURRENT_PATH + "lib/";

    // verboseフラグ.
    const _verbose = args.isValue("-v", "--verbose");

    // 標準出力.
    const p = function (out) {
        console.log(out == undefined ? "" : out);
    }

    // $loadLib(...)呼び出し検出用の正規表現.
    // 対象文字列は '...'、"..."、`...` のいずれのクォーテーションも対応する.
    const _LOAD_LIB_REG = /\$loadLib\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

    // 指定ディレクトリ以下の対象拡張子ファイル一覧を再帰取得する.
    // (ディレクトリ自体が存在しない場合は空配列を返す).
    const _listFilesSafe = function (dirPath, extList) {
        if (!mintoUtil.existsDirSync(dirPath)) {
            return [];
        }
        const all = mintoUtil.listFile(dirPath, false, true);
        const len = all.length;
        const ret = [];
        for (let i = 0; i < len; i++) {
            const f = all[i];
            for (let j = 0; j < extList.length; j++) {
                if (f.endsWith(extList[j])) {
                    ret.push(f);
                    break;
                }
            }
        }
        return ret;
    };

    // 1ファイルから$loadLib参照名一覧を抽出する.
    const _extractLoadLibNames = function (filePath) {
        const fs = require("fs");
        const content = fs.readFileSync(filePath, "utf-8");
        const ret = [];
        let m;
        // 呼び出しの都度lastIndexがリセットされるよう正規表現を再生成する.
        const reg = new RegExp(_LOAD_LIB_REG.source, "g");
        while ((m = reg.exec(content)) != null) {
            let name = m[1].trim();
            if (name.charCodeAt(0) === 47) {
                // 先頭"/"は$loadLib側の仕様(index.js)に合わせて除去する.
                name = name.substring(1);
            }
            ret.push(name);
        }
        return ret;
    };

    // modulesの各カテゴリ配下ファイル一覧(相対パス)キャッシュ.
    // {カテゴリ名: Set(相対パス一覧)}
    const _buildModuleFileSets = function () {
        const ret = {};
        for (let category in _MODULES_DICT) {
            const dir = _MODULES_DICT[category];
            const files = mintoUtil.listFile(dir, false, true);
            const set = new Set();
            const prefixLen = dir.length;
            for (let i = 0; i < files.length; i++) {
                set.add(files[i].substring(prefixLen));
            }
            ret[category] = set;
        }
        return ret;
    };

    // 指定した参照名(basename含む相対パス)が、どのカテゴリに存在するかを
    // 検索する(完全一致優先。見つからない場合はbasename一致でフォール
    // バック検索する).
    // 戻り値: マッチしたカテゴリ名の配列(見つからない場合は空配列).
    const _findCategories = function (moduleFileSets, name) {
        let ret = [];
        for (let category in moduleFileSets) {
            if (moduleFileSets[category].has(name)) {
                ret.push(category);
            }
        }
        if (ret.length > 0) {
            return ret;
        }
        // 完全一致が無い場合、basename一致でフォールバック検索する
        // (例: サブディレクトリ配置違いなどの揺れを拾うため).
        const base = name.substring(name.lastIndexOf("/") + 1);
        for (let category in moduleFileSets) {
            const set = moduleFileSets[category];
            for (const f of set) {
                if (f === base || f.endsWith("/" + base)) {
                    ret.push(category);
                    break;
                }
            }
        }
        return ret;
    };

    const main = function () {
        // 走査対象ファイル一覧(public配下のmt.js/mt.html + lib配下のjs).
        const targetFiles = []
            .concat(_listFilesSafe(_CURRENT_PUBLIC_PATH, [".mt.js", ".mt.html"]))
            .concat(_listFilesSafe(_CURRENT_LIB_PATH, [".js"]));

        if (targetFiles.length === 0) {
            p("[" + COMMAND_NAME + "] public/・lib/ 配下に走査対象ファイルが" +
                "見つかりませんでした(カレントディレクトリがminto" +
                "プロジェクトルートか確認してください).");
            return;
        }

        // 参照名 -> 参照元ファイル一覧(相対パス).
        const refMap = {};
        for (let i = 0; i < targetFiles.length; i++) {
            const f = targetFiles[i];
            const names = _extractLoadLibNames(f);
            const relFile = f.startsWith(_CURRENT_PATH) ?
                f.substring(_CURRENT_PATH.length) : f;
            for (let j = 0; j < names.length; j++) {
                const name = names[j];
                if (refMap[name] == undefined) {
                    refMap[name] = [];
                }
                if (refMap[name].indexOf(relFile) === -1) {
                    refMap[name].push(relFile);
                }
            }
        }

        const refNames = Object.keys(refMap).sort();
        if (refNames.length === 0) {
            p("[" + COMMAND_NAME + "] $loadLib(...) の呼び出しは" +
                "見つかりませんでした.");
            return;
        }

        const moduleFileSets = _buildModuleFileSets();

        const okList = [];
        const needCategoryList = [];
        const ambiguousList = [];
        const notFoundList = [];
        const requiredCategories = new Set();

        for (let i = 0; i < refNames.length; i++) {
            const name = refNames[i];
            const localPath = _CURRENT_LIB_PATH + name;
            if (mintoUtil.existsFileSync(localPath)) {
                okList.push(name);
                continue;
            }
            const categories = _findCategories(moduleFileSets, name);
            if (categories.length === 1) {
                needCategoryList.push({ name: name, category: categories[0] });
                requiredCategories.add(categories[0]);
            } else if (categories.length > 1) {
                ambiguousList.push({ name: name, categories: categories });
                for (let j = 0; j < categories.length; j++) {
                    requiredCategories.add(categories[j]);
                }
            } else {
                notFoundList.push(name);
            }
        }

        p("[" + COMMAND_NAME + "] $loadLib 参照チェック結果" +
            "(" + refNames.length + "件検出)");
        p("");

        if (okList.length > 0) {
            p("## lib/ に配置済み(OK, そのままmtpkで同梱されます)");
            for (let i = 0; i < okList.length; i++) {
                p("  - " + okList[i]);
                if (_verbose) {
                    _printRefs(refMap[okList[i]]);
                }
            }
            p("");
        }

        if (needCategoryList.length > 0) {
            p("## lib/ に無く、modules/配下のカテゴリで見つかったもの" +
                "(mtpk実行時に -t 指定が必要)");
            for (let i = 0; i < needCategoryList.length; i++) {
                const e = needCategoryList[i];
                p("  - " + e.name + "  →  -t " + e.category);
                if (_verbose) {
                    _printRefs(refMap[e.name]);
                }
            }
            p("");
        }

        if (ambiguousList.length > 0) {
            p("## 複数カテゴリで同名ファイルが見つかったもの(要確認)");
            for (let i = 0; i < ambiguousList.length; i++) {
                const e = ambiguousList[i];
                p("  - " + e.name + "  →  候補: " + e.categories.join(", "));
                if (_verbose) {
                    _printRefs(refMap[e.name]);
                }
            }
            p("");
        }

        if (notFoundList.length > 0) {
            p("## lib/ にも modules/ のどのカテゴリにも見つからないもの" +
                "(typo、または独自libファイルの配置漏れの可能性)");
            for (let i = 0; i < notFoundList.length; i++) {
                p("  - " + notFoundList[i]);
                if (_verbose) {
                    _printRefs(refMap[notFoundList[i]]);
                }
            }
            p("");
        }

        if (requiredCategories.size > 0) {
            const list = Array.from(requiredCategories).sort();
            let cmd = "mtpk";
            for (let i = 0; i < list.length; i++) {
                cmd += " -t " + list[i];
            }
            p("## デプロイ時の推奨コマンド");
            p("  " + cmd);
            p("");
        } else if (notFoundList.length === 0) {
            p("## デプロイ時の追加 -t 指定は不要です" +
                "(全ての参照がlib/に配置済みです).");
            p("");
        }

        if (notFoundList.length > 0) {
            process.exitCode = 1;
        }
    };

    // 参照元ファイル一覧を表示する(verbose時のみ).
    function _printRefs(files) {
        for (let i = 0; i < files.length; i++) {
            console.log("      referenced by: " + files[i]);
        }
    }

    try {
        main();
    } catch (e) {
        console.error("[error]" + COMMAND_NAME + ": ", e);
        process.exitCode = 1;
    }
})();
