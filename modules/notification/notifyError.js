///////////////////////////////////////////////
// 一元化エラー通知モジュール (Slack対応).
//
// 発生した例外を構造化ログ($log.error)に記録し、
// Slack(Webhook URL または Bot Token)へエラーアラートを即時通知する.
//
// $notifyError(err, context, options)
///////////////////////////////////////////////
(function () {
    'use strict';

    // logモジュール(遅延ロード).
    let _log = null;
    const _getLog = function () {
        if (_log == null) {
            try {
                _log = typeof $log === "function" ? $log : $loadLib("log.js");
            } catch (e) {
                _log = null;
            }
        }
        return _log;
    };

    // sendSlackモジュール(遅延ロード).
    let _sendSlack = null;
    const _getSendSlack = function () {
        if (_sendSlack == null) {
            try {
                _sendSlack = $loadLib("sendSlack.js");
            } catch (e) {
                _sendSlack = null;
            }
        }
        return _sendSlack;
    };

    // [conf] 通知設定ファイル名.
    const _CONF_NAME = "notify.json";

    // 設定の取得(引数 > 環境変数 > conf/notify.json).
    const _getNotifyConfig = function (options) {
        options = options || {};

        let conf = {};
        try {
            if (typeof $loadConf === "function") {
                conf = $loadConf(_CONF_NAME) || {};
            }
        } catch (e) {
            // ignore
        }

        const webhookUrl = options.webhookUrl ||
            process.env["SLACK_ERROR_WEBHOOK_URL"] ||
            process.env["SLACK_WEBHOOK_URL"] ||
            conf.slackWebhookUrl ||
            conf.webhookUrl;

        const slackToken = options.slackToken ||
            process.env["SLACK_TOKEN"] ||
            conf.slackToken;

        const channel = options.channel ||
            process.env["SLACK_ERROR_CHANNEL"] ||
            process.env["SLACK_CHANNEL"] ||
            conf.slackChannel ||
            conf.channel ||
            "#alerts";

        const appName = options.appName ||
            process.env["APP_NAME"] ||
            conf.appName ||
            "minto-app";

        return {
            webhookUrl: webhookUrl,
            slackToken: slackToken,
            channel: channel,
            appName: appName
        };
    };

    // Webhook経由でSlackへ送信.
    const _sendWebhook = async function (webhookUrl, payload) {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        return { ok: res.status >= 200 && res.status < 300, status: res.status };
    };

    // エラーオブジェクトを通知用にフォーマット.
    const _buildSlackPayload = function (err, context, cfg) {
        context = context || {};

        const errName = (err && err.name) || "Error";
        const errMsg = (err && err.message) || ("" + (err || "Unknown error"));
        let stack = (err && err.stack) || "";
        if (stack.length > 1500) {
            stack = stack.substring(0, 1500) + "\n...[truncated]";
        }

        let reqId = context.requestId;
        let path = context.path;
        let method = context.method;

        if (!reqId) {
            try {
                if (typeof $requestId === "function") reqId = $requestId();
            } catch (e) {}
        }
        if (!path || !method) {
            try {
                if (typeof $request === "function") {
                    const req = $request();
                    if (req) {
                        if (!path && typeof req.path === "function") path = req.path();
                        if (!method && typeof req.method === "function") method = req.method();
                    }
                }
            } catch (e) {}
        }

        const fields = [];
        if (reqId) fields.push({ title: "Request ID", value: "`" + reqId + "`", short: true });
        if (path) fields.push({ title: "Endpoint", value: (method ? method + " " : "") + path, short: true });

        // 追加のコンテキストフィールド
        for (let k in context) {
            if (k !== "requestId" && k !== "path" && k !== "method" && typeof context[k] !== "object") {
                fields.push({ title: k, value: "" + context[k], short: true });
            }
        }

        const payload = {
            username: cfg.appName + " Error Notifier",
            icon_emoji: ":rotating_light:",
            text: "🚨 *[" + cfg.appName + "]* " + errName + ": " + errMsg,
            attachments: [
                {
                    color: "#e01e5a",
                    title: "[" + errName + "] " + errMsg,
                    fields: fields,
                    text: stack ? "```\n" + stack + "\n```" : undefined,
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };

        if (cfg.channel) {
            payload.channel = cfg.channel;
        }

        return payload;
    };

    // エラーを通知しログに記録.
    // err: Errorオブジェクト または エラーメッセージ
    // context: 補足コンテキストオブジェクト ({ userId, operation, etc. })
    // options: { webhookUrl, slackToken, channel, appName, throwError }
    const notifyError = async function (err, context, options) {
        options = options || {};
        context = context || {};

        // 1. 構造化ログを出力
        const logger = _getLog();
        if (logger && typeof logger.error === "function") {
            logger.error(err instanceof Error ? err.message : "" + err, err, context);
        } else {
            console.error("[notifyError]", err, context);
        }

        // 2. 設定の解決
        const cfg = _getNotifyConfig(options);

        // 3. Slack送信
        let result = { ok: false, reason: "No webhook or token configured" };
        try {
            const payload = _buildSlackPayload(err, context, cfg);

            if (cfg.webhookUrl) {
                result = await _sendWebhook(cfg.webhookUrl, payload);
            } else if (cfg.slackToken) {
                const slack = _getSendSlack();
                if (slack && typeof slack.json === "function") {
                    result = await slack.json(cfg.channel, payload, cfg.slackToken);
                } else {
                    result = { ok: false, reason: "sendSlack module not available" };
                }
            }
        } catch (sendErr) {
            console.warn("[notifyError] Failed to send Slack alert:", sendErr);
            result = { ok: false, error: sendErr };
        }

        // 4. throwError指定時の再送出
        if (options.throwError === true) {
            throw err;
        }

        return result;
    };

    // 非同期関数のエラー自動キャッチ＆通知ラッパー
    notifyError.catch = function (fn, context, options) {
        return async function () {
            try {
                return await fn.apply(this, arguments);
            } catch (err) {
                await notifyError(err, context, options);
                throw err;
            }
        };
    };

    exports.notify = notifyError;
    exports.notifyError = notifyError;
    module.exports = notifyError;
})();
