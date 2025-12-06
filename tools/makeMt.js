// mintoプロジェクトを作成するコマンド.
//

(function () {
    'use strict';

    // fs.
    const fs = require('fs');

    // args.
    const args = require("./args.js");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

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
    const createEnvJson = function (projectName) {
        createConfJson(projectName, "env", "{\n}");
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
        const projectName = process.argv[2];
        if (projectName == undefined) {
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

        // プロジェクト作成完了.
        p("[success] " + projectName + " project created.");
    }

    // コマンド実行処理.
    runCommand();
})();