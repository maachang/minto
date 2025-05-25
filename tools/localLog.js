////////////////////////////////////////////////
// ローカルログ出力.
////////////////////////////////////////////////
(function (_g) {
    'use strict';

    // ファイルI/O.
    const fs = require("fs");

    // util.
    const util = require("util");

    // 元のconsole名.
    const SRC_CONSOLE_NAME = "_@$before@$console$";

    // 元のconsole名が既に存在する場合.
    if (_g[SRC_CONSOLE_NAME] != undefined) {
        _g["console"] = _g[SRC_CONSOLE_NAME]
    }
    let console = _g["console"];

    // 修正コンソール.
    let _console = {};

    // デフォルトの出力先ディレクトリ名.
    const DEF_LOG_OUT_DIR = "./log";

    // デフォルトの出力先ファイル名.
    const DEF_LOG_OUT_FILE = "logout";

    // ログ拡張子.
    const LOG_EXTENTION = ".log";

    // 出力先を設定.
    let baseLogOutFile = null;

    // 出力タイプ: trace.
    const LEVEL_TRACE = 1;
    // 出力タイプ: debug.
    const LEVEL_DEBUG = 2;
    // 出力タイプ: info.
    const LEVEL_INFO = 3;
    // 出力タイプ: warn.
    const LEVEL_WARN = 4;
    // 出力タイプ: error.
    const LEVEL_ERROR = 5;
    // 出力タイプ: log.
    const LEVEL_LOG = 99;

    // ログレベル.
    let logLevel = LEVEL_INFO;

    // ログレベルを設定.
    // level ログレベルを設定します.
    // 戻り値: 設定されたログレベルが返却されます.
    const setLogLevel = function (level) {
        if (typeof (level) != "string") {
            return;
        }
        switch (level.trim().toLowerCase()) {
            case "none": logLevel = LEVEL_TRACE; break;
            case "trace": logLevel = LEVEL_TRACE; break;
            case "dbg": logLevel = LEVEL_DEBUG; break;
            case "debug": logLevel = LEVEL_DEBUG; break;
            case "info": logLevel = LEVEL_INFO; break;
            case "warn": logLevel = LEVEL_WARN; break;
            case "warning": logLevel = LEVEL_WARN; break;
            case "err": logLevel = LEVEL_ERROR; break;
            case "error": logLevel = LEVEL_ERROR; break;
        }
        return logLevel;
    }

    // ログ出力先の定義を行う.
    // options {dir: string, file: string, max: number}
    //   - dir 対象のディレクトリを設定します.
    //   - file 対象のファイル名(拡張子抜き)を設定する事で
    //          日付+.log拡張子がセットされます.
    //          例: logout => logout.{yyyy-MM-dd}.log
    //   - level ファイルに出力するログレベルを設定します.
    //           - trace console.traceから許可します.
    //           - debug console.debugから許可します.
    //           - info console.infoから許可します.
    //           - warn console.warnから許可します.
    //           - error console.errorから許可します.
    const setting = function (options) {
        // optionsが存在しない場合.
        if (options == null || options == undefined) {
            options = {};
        }
        // それぞれを取得.
        let dir = options.dir;
        let file = options.file;
        let level = options.level;
        // 出力先ディレクトリが存在しない場合.
        if (typeof (dir) != "string") {
            // デフォルトセット.
            dir = DEF_LOG_OUT_DIR;
        }
        // 出力先ファイルが存在しない場合.
        if (typeof (file) != "string") {
            // デフォルトセット.
            file = DEF_LOG_OUT_FILE;
        }
        // ログレベルが設定されている場合.
        if (typeof (level) == "string") {
            // ログ出力レベルをセット.
            setLogLevel(level);
        }

        // ディレクトリ名の整理
        dir = dir.trim();
        // ファイル名の整理.
        file = file.trim();
        // ディレクトリ名が存在しない場合は作成
        if (!_existsSync(dir)) {
            // cluster起動の場合エラーが出る場合があるので
            // 例外を出さない.
            try {
                fs.mkdirSync(dir);
            } catch (e) { };
        }
        // ディレクトリ名の最後に "/" が存在する場合.
        if (dir.endsWith("/")) {
            dir = dir.substring(0, dir.length - 1).trim();
        }
        // ファイル名の最初に "/" が存在する場合.
        if (file.startsWith("/")) {
            file = file.substring(1).trim();
        }
        // 基本出力先を設定.
        baseLogOutFile = dir + "/" + file;
    }

    // existsSyncをstatSyncで代用(existsSync=Deprecated)
    const _existsSync = function (name) {
        try {
            fs.statSync(name);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ログ出力.
    // mode trace, debug, warn, error, logの呼び出し条件を設定します.
    // level ログレベルを設定します.
    // args 出力内容を配列で設定します.
    const output = function (mode, level, args) {
        // settingが呼ばれてない場合.
        if (baseLogOutFile == null) {
            //throw new Error(
            //    "logger.setting() has not been called.");
            setting(); // デフォルト設定のsettingを呼び出す.
        }
        // 日付関連計算.
        const now = new Date();
        const y = now.getFullYear();
        const M = "" + (now.getMonth() + 1);
        const d = "" + now.getDate();
        const h = "" + now.getHours();
        const m = "" + now.getMinutes();
        const s = "" + now.getSeconds();
        const ss = "" + now.getMilliseconds();
        const ymd = y + "-" + "00".substring(M.length) +
            M + "-" + "00".substring(d.length) + d;
        const ymdhms = ymd + " " +
            "00".substring(h.length) + h + ":" +
            "00".substring(m.length) + m + ":" +
            "00".substring(s.length) + s + "." +
            "000".substring(ss.length) + ss;

        const srcMode = mode;
        // modeがlog以外の場合.
        if (mode != "log") {
            // modeを先頭表示にする.
            mode = "[" + mode + "] ";
        } else {
            // modeは空設定.
            mode = "";
        }
        // util.formatで文字変換.
        const msg = typeof (args) == "string" ?
            args : util.format.apply(null, args);
        // ログレベルが満たされた場合.
        if (logLevel <= level) {
            // ファイル追加出力.
            //fs.appendFileSync(
            // 非同期実行.
            fs.appendFile(
                // {baseLogOutFile}.{yyyy-MM_dd}.log
                baseLogOutFile + "." + ymd + LOG_EXTENTION
                // [{yyyy-MM-dd hh:mm:ss.sss}] {mode}{message}\n
                , "[" + ymdhms + "] " + mode + msg + "\n"
                , function () { } // 非同期実行先.
            );
        }
        // 元のコンソール出力
        _g[SRC_CONSOLE_NAME][srcMode](msg);
    }

    // 必要な条件以外は空のfunctionをセット.
    for (let k in console) {
        _console[k] = function () { };
    }

    // Array.prototype.slice.
    const ARRAY_SLICE = Array.prototype.slice;
    const aslice = function (args, start) {
        if (args == undefined || args == null) {
            return [];
        }
        return ARRAY_SLICE.call(args, start);
    }

    // console.timeシンボル管理.
    let timeSimboles = {};

    // 指定シンボルのタイム情報を取得.
    const getTime = function (simbol) {
        if (typeof (simbol) != "string") {
            simbol = null;
        }
        const t = timeSimboles[simbol];
        if (simbol == null) {
            simbol = "default";
        }
        if (t == undefined) {
            _g[SRC_CONSOLE_NAME].log(
                "no such label \'" + simbol + "\'");
            return null;
        }
        // startTime, simbol.
        return [t, simbol];
    }

    // console.countシンボル管理.
    let countSimboles = {};

    /////////////////////////////////////////////////////
    // 変更出力ログ条件を割り当てる.
    /////////////////////////////////////////////////////
    _console.trace = function () {
        output("trace", LEVEL_TRACE, arguments);
    }
    _console.debug = function () {
        output("debug", LEVEL_DEBUG, arguments);
    }
    _console.info = function () {
        output("info", LEVEL_INFO, arguments);
    }
    _console.warn = function () {
        output("warn", LEVEL_WARN, arguments);
    }
    _console.error = function () {
        output("error", LEVEL_ERROR, arguments);
    }
    _console.log = function () {
        output("log", LEVEL_LOG, arguments);
    }
    _console.clearTime = function () {
        timeSimboles = {};
    }
    _console.time = function (simbol) {
        if (typeof (simbol) != "string") {
            simbol = null;
        }
        output("log", LEVEL_LOG, "[time] " +
            (simbol == null ? "default" : simbol));
        timeSimboles[simbol] = Date.now();
    }
    _console.timeLog = function () {
        const simbol = arguments == null ?
            undefined : arguments[0];
        const time = getTime(simbol);
        if (time == null) {
            return;
        }
        const msg = "[timelog] " + time[1] + ": " +
            (Date.now() - time[0]) + "msec " +
            util.format.apply(null, aslice(arguments, 1));
        output("log", LEVEL_LOG, msg);
    }
    _console.timeEnd = function (simbol) {
        if (typeof (simbol) != "string") {
            simbol = null;
        }
        const time = getTime(simbol);
        if (time == null) {
            return;
        }
        delete timeSimboles[simbol];
        const msg = "[timele] " + time[1] + ": " +
            (Date.now() - time[0]) + "msec";
        output("log", LEVEL_LOG, msg);
    }
    _console.clearCount = function () {
        countSimboles = {};
    }
    _console.countReset = function (simbol) {
        if (typeof (simbol) != "string") {
            simbol = null;
        }
        delete countSimboles[simbol];
    }
    _console.count = function (simbol) {
        if (typeof (simbol) != "string") {
            simbol = null;
        }
        let c = countSimboles[simbol];
        if (c == undefined) {
            c = 1;
        }
        countSimboles[simbol] = c++;
        if (simbol == null) {
            simbol = "default";
        }
        output("log", LEVEL_LOG, simbol + ": " + c);
    }
    _console.assert = function () {
        let flag;
        let args = arguments;
        if (args == null || args.length == 0 ||
            args[0] == undefined || args[0] == null) {
            flag = false;
            if (args == null) {
                args = [];
            }
        } else {
            flag = args[0];
            const t = typeof (flag);
            if ((t == "string" && flag.length <= 0) ||
                (t == "number" && flag == 0) ||
                (t == "boolean" && flag != true)) {
                flag = false;
            } else {
                flag = true;
            }
        }
        if (!flag) {
            const msg = util.format.apply(null, aslice(args, 1));
            if (msg.length == 0) {
                output("log", LEVEL_LOG, "Assertion failed");
            } else {
                output("log", LEVEL_LOG, "Assertion failed: " + msg);
            }
        }
    }

    /////////////////////////////////////////////////////
    // consoleを置き換える.
    /////////////////////////////////////////////////////
    _g[SRC_CONSOLE_NAME] = console;
    _g["console"] = _console;

    // クリア.
    _console = undefined;
    console = undefined;

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.setting = setting;

})(global);
