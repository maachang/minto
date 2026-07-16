// mintoプロジェクトを作成するコマンド.
//

(function () {
    'use strict';

    // fs.
    const fs = require('fs');

    // path.
    const path = require('path');

    // args.
    const args = require("./args.js");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

    // プロジェクト生成テンプレートファイル(package.json, claude.md等)の
    // 配置先ディレクトリ. 編集して雛形の内容を変更できるようにするため、
    // ハードコードせずファイルとして切り出している.
    const _PROJECT_CONF_DIR = path.join(__dirname, "projectConf");

    // 作成対象フォルダ: public.
    const _PUBLIC_FOLDER = "public";
    // 作成対象フォルダ: lib.
    const _LIB_FOLDER = "lib";
    // 作成対象フォルダ: conf.
    const _CONF_FOLDER = "conf";

    // 作成対象フォルダ群.
    const _CREATE_FOLDERS = [
        _PUBLIC_FOLDER,
        _LIB_FOLDER,
        _CONF_FOLDER
    ];

    // コマンド名.
    const COMMAND_NAME = "mkmt";

    // 標準出力.
    const p = function (out) {
        console.log(out);
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

    // プロジェクトディレクトリを作成.
    const createProject = function (projectName) {
        // 既にプロジェクトディレクトリが存在する場合.
        if (mintoUtil.existsDirSync(projectName)) {
            p("[ERROR] Project directory already exists: " + projectName);
            return false;
        }
        // プロジェクトディレクトリ作成失敗.
        if (!createDir(projectName)) {
            // プロジェクトディレクトリ作成に失敗.
            p("[ERROR] Failed to create project directory: " + projectName);
            return false;
        }
        const len = _CREATE_FOLDERS.length;
        for (let i = 0; i < len; i++) {
            createDir(projectName + "/" + _CREATE_FOLDERS[i]);
        }
        return true;
    }

    // tools/projectConf/配下のテンプレートファイルを読み込み、"${変数名}"を
    // 置き換えた内容を返す.
    // templateName 対象のテンプレートファイル名(tools/projectConf/直下)を設定します.
    // vars 置き換える変数({変数名: 置き換え文字列})を設定します.
    // 戻り値: 置き換え後のテキストが返却されます.
    const renderTemplate = function (templateName, vars) {
        let text = fs.readFileSync(
            path.join(_PROJECT_CONF_DIR, templateName), "utf-8");
        for (const key in vars) {
            text = text.split("${" + key + "}").join(vars[key]);
        }
        return text;
    }

    // conf/xxx.json を作成.
    const createConfJson = function (projectName, confName, writeText) {
        // 既にプロジェクトディレクトリが存在する場合.
        if (!mintoUtil.existsDirSync(projectName)) {
            p("[ERROR] Project directory does not exist: " + projectName);
            return false;
        }
        // jsonファイルを作成
        fs.writeFileSync(
            projectName + "/" + _CONF_FOLDER + "/" + confName + ".json",
            writeText);
    }

    // conf/env.json を作成.
    // modules/s3table(s3sdk.js/s3Lock.js/s3MasterTable.js/s3IndexTable.js)の
    // ローカル検証環境(tools/localS3.js)向けの環境変数をデフォルトで含める.
    // AWSクレデンシャルは、MINTO_LOCAL_S3_ENDPOINT設定時はコード側
    // (s3sdk.js/s3Lock.js)が自動的にダミー値を使うため、ここでは設定不要.
    const createEnvJson = function (projectName) {
        createConfJson(projectName, "env",
            "{\n" +
            "    \"MINTO_LOCAL_S3_ENDPOINT\": \"http://localhost:9911\"\n" +
            "}"
        );
    }

    // package.json を作成(tools/projectConf/package.json テンプレートより).
    // modules/s3table が実行時に必要とする @aws-sdk/client-s3 を、プロジェクト
    // ローカルへ npm install できるようにするためのもの(ローカル検証専用。
    // AWS Lambda本番実行時は llrt-lambda-{cpu名}-full-sdk.zip のLayerが
    // @aws-sdk/client-s3 を提供するため、このpackage.json自体はデプロイ
    // パッケージ(mtpk)には含まれない).
    const createPackageJson = function (projectName) {
        if (!mintoUtil.existsDirSync(projectName)) {
            p("[ERROR] Project directory does not exist: " + projectName);
            return false;
        }
        fs.writeFileSync(
            projectName + "/package.json",
            renderTemplate("package.json", { PROJECT_NAME: projectName })
        );
    }

    // .claude/CLAUDE.md を作成(tools/projectConf/claude.md テンプレートより).
    // Claude Codeがセッション開始時に自動的に読み込む、プロジェクト固有情報
    // ファイルの雛形.
    const createClaudeMd = function (projectName) {
        if (!mintoUtil.existsDirSync(projectName)) {
            p("[ERROR] Project directory does not exist: " + projectName);
            return false;
        }
        const claudeDir = projectName + "/.claude";
        createDir(claudeDir);
        fs.writeFileSync(
            claudeDir + "/CLAUDE.md",
            renderTemplate("claude.md", { PROJECT_NAME: projectName })
        );
    }

    // conf/minto.json を作成.
    const createMintoJson = function (projectName) {
        createConfJson(projectName, "minto",
            "{\n" +
            "    \"bindPort\": 3210\n" +
            "}"
        );
    }

    // help.
    const help = function () {
        // help表示.
        p("Usage: " + COMMAND_NAME + " [PROJECT NAME]...");
        p(" Create a new minto project.");
        p("[PROJECT NAME]: Set the minto project name")
        p("");
        p(" <example> ");
        p("  > " + COMMAND_NAME + " testProject");
        p("    The minto project for testProject has been created.");
        p("");
    }

    // 実行処理.
    const runCommand = function () {
        if (args.isValue("-h", "--help")) {
            help();
            return;
        }
        // プロジェクト名を取得.
        const projectName = args.getFirst();
        if (projectName == undefined || projectName === "") {
            p("[ERROR] Project name not set.");
            return;
        }
        // プロジェクトディレクトリを作成.
        if (!createProject(projectName)) {
            return;
        }
        // env.json を作成.
        createEnvJson(projectName);

        // minto.json を作成.
        createMintoJson(projectName);

        // package.json を作成.
        createPackageJson(projectName);

        // .claude/CLAUDE.md を作成.
        createClaudeMd(projectName);

        // プロジェクト作成完了.
        p("[success] " + projectName + " project created.");
        p("  > cd " + projectName + " && npm install");
    }

    // コマンド実行処理.
    runCommand();
})();