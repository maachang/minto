// GASで長期間ログを残したい場合のログ操作.
// GASではGAS開発環境において、ログ出力が「永続化できない」
// 一方でこのGasLogでは、これら永続化が行えるようになる.
//
(function (_g) {

    // [環境変数]フォルダID.
    const _ENV_OUT_FOLDER_ID = "GLOG_FOLDER_ID";

    // 生成処理.
    // オブジェクトを生成して返却.
    const create = function (mode, id) {
        if(id == null || id == undefined || id == "") {
            // 環境変数からフォルダIDを取得.
            id = PropertiesService.getScriptProperties().getProperty(_ENV_OUT_FOLDER_ID);
        }
        if(id == null || id == undefined || id == "") {
            // フォルダIDが設定されていない場合は処理しない.
            return null;
        }
        // 出力先フォルダID.
        let folderId = id;
        // 出力対象者メールアドレス.
        let userMail = null;
        // 出力モード
        //  0: 日別ログ区分.
        //  1: ユーザ別ログ区分.
        let outMode = mode;
        // ログ情報格納先(メモリ).
        let outLogJson = [];
        // ログ出力日付.
        let date = new Date();
        // タイマー値.
        let timer = {}

        // ログオブジェクト.
        const o = {};

        // ログ内容をクリア.
        o.clear = function () {
            // [初期化]ログ情報格納先(メモリ).
            outLogJson = [];
            // [初期化]ログ出力日付.
            date = new Date();
            // [初期化]ユーザメール.
            userMail = null;
            return o;
        }

        // ログ内容をファイル出力.
        o.flush = function () {
            // 出力ログ条件が存在しない場合.
            if (outLogJson.length == 0) {
                return false;
            }
            // １つ下の出力先フォルダを取得.
            let outDir = [];
            // ユーザ単位でログ記録.
            if (outMode == 1) {
                // 指定ユーザ名フォルダに出力.
                outDir[outDir.length] = userMail;
                // 月別フォルダに出力
                outDir[outDir.length] = _outYyyyMM(date);
            } else {
                // 月別単位で出力.
                outDir[outDir.length] = _outYyyyMM(date);
            }
            // ファイル出力.
            const res = _flushLog(folderId, outDir, date, outLogJson);
            // クリア.
            o.clear();
            // 戻り値.
            return res;
        }

        // ログ出力.
        o.log = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "log", userMail, args);
            console.log.apply(null, args);
            return o;
        }
        // [DEBUG]ログ出力.
        o.debug = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "debug", userMail, args);
            // debugログが利用できないので、代わりにlogを利用.
            console.log.apply(null, args);
            return o;
        }
        // [INFO]ログ出力.
        o.info = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "info", userMail, args);
            console.info.apply(null, args);
            return o;
        }
        // [WARNING]ログ出力.
        o.warn = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "warn", userMail, args);
            console.warn.apply(null, args);
            return o;
        }
        // [ERROR]ログ出力.
        o.error = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "error", userMail, args);
            console.error.apply(null, args);
            return o;
        }
        // [FATAL]ログ出力.
        o.fatal = function () {
            const args = arguments;
            userMail = userMail || _getMail();
            _putLog(outLogJson, "fatal", userMail, args);
            // console.fatal は存在しないので、代わりに error で代用.
            console.error.apply(null, args);
            return o;
        }
        // タイムログ開始.
        // name: タイムログ名を設定します.
        o.startTimeLog = function (name, message) {
            name = name || "default";
            // ミリ秒のタイム値を設定して開始を行う.
            timer[name] = Date.now();
            if (message != undefined) {
                userMail = userMail || _getMail();
                _putLog(outLogJson, "time", userMail, [name, message]);
                console.info("[time] ", name, message);
            }
            return o;
        }
        // タイムログ出力処理.
        o.timeLog = function (message, name) {
            name = name || "default";
            const tm = (Date.now() - timer[name]) + " msec";

            userMail = userMail || _getMail();
            _putLog(outLogJson, "time", userMail, [name, message, tm]);
            console.info("[time] ", name, message, tm);
        }
        return o;
    }

    // コンソール返却のダミー関数を返却.
    // gasLog出力の条件が足らない場合に出力対象.
    const _dummyConsoleLogs = function() {
        const o = {};
        // タイマー値.
        let timer = {};
        // 出力対象者メールアドレス.
        let userMail = null;

        // ログ内容をクリア.
        o.clear = function () {
            return o;
        }

        // ログ内容をファイル出力(永続化しないため常にfalse).
        o.flush = function () {
            return false;
        }

        // ログ出力.
        o.log = function () {
            const args = arguments;
            console.log.apply(null, args);
            return o;
        }
        // [DEBUG]ログ出力.
        o.debug = function () {
            const args = arguments;
            console.log.apply(null, args);
            return o;
        }
        // [INFO]ログ出力.
        o.info = function () {
            const args = arguments;
            console.info.apply(null, args);
            return o;
        }
        // [WARNING]ログ出力.
        o.warn = function () {
            const args = arguments;
            console.warn.apply(null, args);
            return o;
        }
        // [ERROR]ログ出力.
        o.error = function () {
            const args = arguments;
            console.error.apply(null, args);
            return o;
        }
        // [FATAL]ログ出力.
        o.fatal = function () {
            const args = arguments;
            // console.fatal は存在しないので、代わりに error で代用.
            console.error.apply(null, args);
            return o;
        }
        // タイムログ開始.
        // name: タイムログ名を設定します.
        o.startTimeLog = function (name, message) {
            name = name || "default";
            // ミリ秒のタイム値を設定して開始を行う.
            timer[name] = Date.now();
            if (message != undefined) {
                userMail = userMail || _getMail();
                console.info("[time] ", name, message);
            }
            return o;
        }
        // タイムログ出力処理.
        o.timeLog = function (message, name) {
            name = name || "default";
            const tm = (Date.now() - timer[name]) + " msec";

            userMail = userMail || _getMail();
            console.info("[time] ", name, message, tm);
        }
        return o;
    }

    // GAS実行ユーザ名（メアド）を取得.
    const _getMail = function () {
        return Session.getActiveUser().getEmail();
    }

    // stack trace内容を取得..
    const _stackTrace = function (e) {
        try {
            return "# stack trace: " +
                //e.fileName + ": " + e.lineNumber + "\n" + e.name + ": " + e.message + "\n" +
                e.stack;
        } catch (ee) {
        }
        return "";
    }

    // yyyyMMの情報を取得.
    const _outYyyyMM = function (date) {
        const y = "" + date.getFullYear();
        const M = "" + (date.getMonth() + 1);
        return "0000".substring(y.length) + y +
            "00".substring(M.length) + M;
    }

    // yyyy-MM-dd HH:mm:ss.SSSの情報を取得.
    const _outYmdHmsS = function (date) {
        const y = "" + date.getFullYear();
        const M = "" + (date.getMonth() + 1);
        const d = "" + date.getDate();
        const h = "" + date.getHours();
        const m = "" + date.getMinutes();
        const s = "" + date.getSeconds();
        const sss = "" + date.getMilliseconds();
        return "0000".substring(y.length) + y + "-" +
            "00".substring(M.length) + M + "-" +
            "00".substring(d.length) + d + " " +
            "00".substring(h.length) + h + ":" +
            "00".substring(m.length) + m + ":" +
            "00".substring(s.length) + s + "." +
            "000".substring(sss.length) + sss;
    }

    // １つのログを登録.
    const _putLog = function (outLogJson, logLevel, userName, msgArgs) {
        try {
            let msg = "";
            let em;
            const len = msgArgs.length;
            for (let i = 0; i < len; i++) {
                if (i != 0) {
                    // スペースセット.
                    msg += " ";
                }
                em = msgArgs[i];
                if (em instanceof Error) {
                    msg += _stackTrace(em);
                } else {
                    msg += "" + em;
                }
            }
            outLogJson[outLogJson.length] = {
                logLevel: logLevel,
                user: userName,
                timestamp: _outYmdHmsS(new Date()),
                message: msg
            };
            return true;
        } catch (e) {
            // エラーの場合はログ出力.
            console.error(
                "putLogに失敗: " + logLevel + " " + userName + ": " +
                JSON.stringify(msgArgs),
                _stackTrace(e));
        }
        return false;
    }

    // 指定フォルダID以下のフォルダに対するID返却.
    // 対象フォルダ名が存在しない場合は作成して返却.
    const _getFolderInId = function (folder, name) {
        // 指定フォルダが文字列=folderIdの場合.
        if (typeof (folder) == "string") {
            // フォルダIDとして処理する.
            const folderId = folder;
            folder = DriveApp.getFolderById(folderId);
            if (folder == undefined) {
                throw new Error(
                    "folderId " + folderId + " の読み込みに失敗: " + name);
            }
        }
        // 既にname と同様のフォルダが存在するか確認.
        const folders = folder.getFolders();
        while (folders.hasNext()) {
            const folder = folders.next();
            if (folder.getName() == name) {
                return folder;
            }
        }
        // フォルダが存在しない場合は作成.
        return folder.createFolder(name);
    }

    // ファイルに出力.
    const _flushLog = function (folderId, innerFolderName, date, json) {
        try {
            // 月単位のフォルダを生成.
            let folder = null;
            let innerFolder = folderId;
            // フォルダ作成.
            const len = innerFolderName.length;
            for (let i = 0; i < len; i++) {
                folder = _getFolderInId(innerFolder, innerFolderName[i]);
                innerFolder = folder;
            }
            // 月単位のフォルダ以下に出力.
            folder.createFile(
                _outYmdHmsS(date) + ".json", JSON.stringify(json, null, "  "));
            return true;
        } catch (e) {
            // エラーの場合はログ出力.
            console.error(
                "ログ出力に失敗: " + folderId + " " + date + ": " +
                JSON.stringify(json),
                _stackTrace(e));
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////
    // グローバル定義.
    ////////////////////////////////////////////////////////////////////////////////

    // 実行ユーザ単位でのログ出力.
    _g.createGuLog = function (folderId, gobj) {
        gobj = gobj || _g;
        let ret = create(1, folderId);
        if(ret == null) {
            ret = _dummyConsoleLogs();
        }
        _g.GLOG = ret;
        gobj.GLOG = ret;
        return ret;
    }

    // 月単位でのログ出力.
    _g.createGLog = function (folderId, gobj) {
        gobj = gobj || _g;
        let ret = create(0, folderId);
        if(ret == null) {
            ret = _dummyConsoleLogs();
        }
        _g.GLOG = ret;
        gobj.GLOG = ret;
        return ret;
    }

})(this);
