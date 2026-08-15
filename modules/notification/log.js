///////////////////////////////////////////////
// 構造化ログ(JSON Logger)モジュール.
//
// CloudWatch Logs Insights やローカルでの解析が容易な
// JSON 1行形式の構造化ログを出力する.
//
// $log(message, data) または
// $log.info(message, data), $log.warn(...), $log.error(...), $log.debug(...)
///////////////////////////////////////////////
(function () {
    'use strict';

    const _LEVELS = {
        trace: 10,
        debug: 20,
        info: 30,
        warn: 40,
        error: 50,
        none: 100
    };

    const _getLevelValue = function (lvlStr) {
        if (!lvlStr) return _LEVELS.info;
        const low = ("" + lvlStr).toLowerCase().trim();
        return _LEVELS[low] != null ? _LEVELS[low] : _LEVELS.info;
    };

    const _getMinLevel = function () {
        const envLevel = process.env["LOG_LEVEL"] || process.env["MINTO_LOG_LEVEL"];
        return _getLevelValue(envLevel);
    };

    // Errorオブジェクトをシリアライズ可能なオブジェクトに変換.
    const _serializeError = function (err) {
        if (!err) return null;
        if (typeof err === "string") return { message: err };
        const obj = {
            name: err.name || "Error",
            message: err.message || "" + err
        };
        if (err.stack) obj.stack = err.stack;
        if (err.code) obj.code = err.code;
        if (err.status) obj.status = err.status;
        if (err.statusCode) obj.statusCode = err.statusCode;
        return obj;
    };

    // ログエントリを構築してJSON文字列として出力.
    const _output = function (levelName, message, dataOrError, options) {
        const levelVal = _LEVELS[levelName.toLowerCase()] || _LEVELS.info;
        if (levelVal < _getMinLevel()) {
            return null;
        }

        let reqId = null;
        try {
            if (typeof $requestId === "function") {
                reqId = $requestId();
            }
        } catch (e) {
            // ignore
        }

        let path = null;
        let method = null;
        try {
            if (typeof $request === "function") {
                const req = $request();
                if (req) {
                    if (typeof req.path === "function") path = req.path();
                    if (typeof req.method === "function") method = req.method();
                }
            }
        } catch (e) {
            // ignore
        }

        const entry = {
            time: (new Date()).toISOString(),
            level: levelName.toUpperCase(),
            message: typeof message === "string" ? message : (message instanceof Error ? message.message : JSON.stringify(message))
        };

        if (reqId) entry.requestId = reqId;
        if (path) entry.path = path;
        if (method) entry.method = method;

        // エラーまたは追加データ
        if (message instanceof Error) {
            entry.error = _serializeError(message);
        }

        if (dataOrError != null) {
            if (dataOrError instanceof Error) {
                entry.error = _serializeError(dataOrError);
            } else if (typeof dataOrError === "object") {
                entry.data = dataOrError;
            } else {
                entry.data = { value: dataOrError };
            }
        }

        if (options && typeof options === "object") {
            for (let k in options) {
                if (entry[k] === undefined) {
                    entry[k] = options[k];
                }
            }
        }

        const jsonStr = JSON.stringify(entry);

        // consoleへの振り分け
        if (levelVal >= _LEVELS.error) {
            console.error(jsonStr);
        } else if (levelVal >= _LEVELS.warn) {
            console.warn(jsonStr);
        } else {
            console.log(jsonStr);
        }

        return entry;
    };

    const log = function (message, data, options) {
        return _output("info", message, data, options);
    };

    log.trace = function (message, data, options) {
        return _output("trace", message, data, options);
    };

    log.debug = function (message, data, options) {
        return _output("debug", message, data, options);
    };

    log.info = function (message, data, options) {
        return _output("info", message, data, options);
    };

    log.warn = function (message, data, options) {
        return _output("warn", message, data, options);
    };

    log.error = function (message, dataOrError, options) {
        return _output("error", message, dataOrError, options);
    };

    log.serializeError = _serializeError;

    // module.exports
    for (let k in log) {
        exports[k] = log[k];
    }
    module.exports = log;
})();
