///////////////////////////////////////////////
// (node専用)ローカルSQSトリガー模擬ポーラー.
//
// 実際のAWSでは「SQS→Lambda」はSQS自身がpushするのではなく、Lambdaの
// イベントソースマッピングがキューをポーリングして handler(event) を
// 呼び出す仕組みになっている。このツールはその挙動をローカルで再現する。
//
// tools/localAws.js(ローカルAWSエミュレータ)のSQS機能に対して
// ReceiveMessageでポーリングし、受信したメッセージ群を
// event.Records = [{ body: "..." }, ...] の形にまとめて
// lambda/src/index.js の handler() を直接呼び出す
// (tools/tableTool.jsと同じ「lambda/src/index.jsをそのまま使う」パターン)。
//
// lambda/src/index.js の _responseSqsParams() は現状レコード単位の
// 成否をthrowせず内部でログ出力するのみ(バッチ全体としては常に成功)
// のため、実AWSのデフォルト動作(ReportBatchItemFailures未使用時、
// 呼び出しが正常終了すればバッチ全体を削除)に合わせ、handler()呼び出し
// (例外を投げない限り)後は受信した全メッセージを削除する。
//
// 起動パラメータ: -e/--endpoint (localAws.jsのURL、例: http://127.0.0.1:9911),
// -q/--queue (キュー名、例: mySqsQueue),
// -i/--interval (ポーリング間隔ms、デフォルト2000),
// -w/--wait (ReceiveMessageのWaitTimeSeconds、デフォルト0),
// -b/--batchSize (1回のポーリングで受信する最大件数、デフォルト10、上限10).
///////////////////////////////////////////////
(function () {
    'use strict';

    const path = require("path");
    const args = require("./args.js");
    const mintoUtil = require("./mintoUtil.js");

    // mintoメイン(lambda/src/index.js).
    const mintoLambdaIndex = require("../lambda/src/index.js");

    // 対象プロジェクトのカレントパス.
    const _CURRENT_PATH = path.resolve() + "/";

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
    // 探索しmodules/へのフォールバックを行わない(tableTool.jsと同じ理由).
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

    // デフォルト値.
    const _DEF_ENDPOINT = "http://127.0.0.1:9911";
    const _DEF_INTERVAL = 2000;
    const _DEF_WAIT = 0;
    const _DEF_BATCH_SIZE = 10;
    const _MAX_BATCH_SIZE = 10;

    // 起動パラメータ取得(-e/--endpoint, -q/--queue, -i/--interval,
    // -w/--wait, -b/--batchSize).
    const _endpoint = args.get("-e", "--endpoint") || _DEF_ENDPOINT;
    const _queueName = args.get("-q", "--queue");
    const _interval = args.getNumber("-i", "--interval") || _DEF_INTERVAL;
    const _wait = args.getNumber("-w", "--wait") || _DEF_WAIT;
    const _batchSize = Math.min(
        args.getNumber("-b", "--batchSize") || _DEF_BATCH_SIZE, _MAX_BATCH_SIZE);

    // 停止フラグ(SIGINT/SIGTERM時にtrue).
    let _stopping = false;

    // SQS(AWS JSON 1.0 protocol)呼び出し.
    const _sqsCall = async function (action, input) {
        const res = await fetch(_endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/x-amz-json-1.0",
                "x-amz-target": "AmazonSQS." + action
            },
            body: JSON.stringify(input)
        });
        if (!res.ok) {
            throw new Error("SQS " + action + " failed: status=" + res.status);
        }
        return await res.json();
    }

    // 1回分のポーリング処理(受信→handler実行→削除).
    const _pollOnce = async function (queueUrl) {
        const received = await _sqsCall("ReceiveMessage", {
            QueueUrl: queueUrl,
            MaxNumberOfMessages: _batchSize,
            WaitTimeSeconds: _wait
        });
        const messages = received.Messages || [];
        if (messages.length === 0) {
            return 0;
        }
        const event = {
            Records: messages.map(function (m) {
                return { body: m.Body };
            })
        };
        const result = await mintoLambdaIndex.handler(event, {});
        console.log("[localSqsPoller] handled: " + JSON.stringify(result));
        // handler()が例外を投げず正常終了した場合、実AWSのデフォルト動作
        // (ReportBatchItemFailures未使用)に合わせてバッチ全体を削除する.
        for (let i = 0; i < messages.length; i++) {
            await _sqsCall("DeleteMessage", {
                QueueUrl: queueUrl,
                ReceiptHandle: messages[i].ReceiptHandle
            });
        }
        return messages.length;
    }

    const main = async function () {
        if (_queueName == null) {
            console.error("使い方: localSqsPoller -q <queueName> " +
                "[-e <endpoint(デフォルト: " + _DEF_ENDPOINT + ")>] " +
                "[-i <intervalMs(デフォルト: " + _DEF_INTERVAL + ")>] " +
                "[-w <waitSeconds(デフォルト: " + _DEF_WAIT + ")>] " +
                "[-b <batchSize(デフォルト: " + _DEF_BATCH_SIZE + ", 上限: " +
                _MAX_BATCH_SIZE + ")>]");
            process.exitCode = 1;
            return;
        }
        // 基本パスをカレントプロジェクトディレクトリに設定.
        mintoLambdaIndex.setBasePath(_CURRENT_PATH);

        const base = _endpoint.endsWith("/") ? _endpoint : _endpoint + "/";
        const queueUrl = base + "queue/" + _queueName;

        console.log("[localSqsPoller] polling queue: " + queueUrl +
            " (interval: " + _interval + "ms)");

        process.on("SIGINT", function () { _stopping = true; });
        process.on("SIGTERM", function () { _stopping = true; });

        while (!_stopping) {
            const handled = await _pollOnce(queueUrl);
            if (handled === 0) {
                await new Promise(function (resolve) {
                    setTimeout(resolve, _interval);
                });
            }
        }
        console.log("[localSqsPoller] stopped.");
    };

    main().catch(function (e) {
        console.error("[error]localSqsPoller: ", e);
        process.exitCode = 1;
    });
})();
