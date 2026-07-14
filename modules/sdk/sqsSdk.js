// AWS-SQS接続(aws-sdk-v3).
// 最低限のSQS送受信(送信/受信/削除)操作が利用できる.
//
// AIメモ:
// - Lambda関数URL用途では単発メッセージ処理が中心という想定のため、
//   sendMessageBatch等のバッチ操作は対象外にしている.
// - キューへのメッセージ処理完了後は必ず delete を呼び出すこと
//   (呼ばない場合、可視性タイムアウト経過後に同じメッセージが再度
//   受信されてしまう).
//
(function () {
    'use strict';

    // SQS-Client.
    const {
        SQSClient,
        SendMessageCommand,
        ReceiveMessageCommand,
        DeleteMessageCommand
    } = require("@aws-sdk/client-sqs")

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // AWSクレデンシャル.
    let _AWS_CREDENTIAL = null;

    // 環境変数からCredentialを取得.
    const _getEnvCredential = function () {
        if (_AWS_CREDENTIAL == null) {
            _AWS_CREDENTIAL = {
                "access_key": process.env["AWS_ACCESS_KEY_ID"],
                "secret_access_key": process.env["AWS_SECRET_ACCESS_KEY"],
                "session_token": process.env["AWS_SESSION_TOKEN"]
            }
        }
        return _AWS_CREDENTIAL;
    }

    // リージョン毎のSQSClient.
    const _SQS_CLIENT = {};

    // SQSClientオブジェクトを取得.
    const _getSqsClient = function (region, credentials) {
        if (region == undefined || region == null) {
            region = _DEF_REGION;
        }
        // credentialsが設定されていない場合.
        if (credentials == undefined || credentials == null) {
            // 環境変数から取得.
            credentials = _getEnvCredential();
        }
        // accessKeyが存在しない場合.
        if (credentials["access_key"] == undefined) {
            if (_SQS_CLIENT[region] == undefined) {
                _SQS_CLIENT[region] = new SQSClient({
                    region: region
                });
            }
            return _SQS_CLIENT[region];
        }
        // SQSClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_SQS_CLIENT[key] == undefined) {
            let setCredentials;
            if (credentials["session_token"] == undefined) {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"]
                }
            } else {
                setCredentials = {
                    accessKeyId: credentials["access_key"],
                    secretAccessKey: credentials["secret_access_key"],
                    sessionToken: credentials["session_token"]
                }
            }
            _SQS_CLIENT[key] = new SQSClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _SQS_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 指定キューにメッセージを送信.
    // queueUrl 対象のキューURLを設定します.
    // body 送信対象のメッセージ本文(文字列)を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         delaySeconds: 配信遅延秒数(0-900)を設定します.
    //         messageGroupId: FIFOキュー利用時のグループIDを設定します.
    //         messageDeduplicationId: FIFOキュー利用時の重複排除IDを設定します.
    // 戻り値: 送信結果の{messageId}が返却されます(失敗時はnull).
    exports.send = async function (queueUrl, body, options) {
        if (options == undefined) {
            options = {};
        }
        const input = {
            QueueUrl: queueUrl,
            MessageBody: body
        }
        if (options.delaySeconds != undefined) {
            input["DelaySeconds"] = parseInt(options.delaySeconds);
        }
        if (options.messageGroupId != undefined) {
            input["MessageGroupId"] = "" + options.messageGroupId;
        }
        if (options.messageDeduplicationId != undefined) {
            input["MessageDeduplicationId"] = "" + options.messageDeduplicationId;
        }
        try {
            const res = await _getSqsClient(options.region, options.credentials).send(
                new SendMessageCommand(input)
            )
            return { messageId: res.MessageId };
        } catch (e) {
            console.warn("[SQS.SEND]queueUrl: " + queueUrl +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }

    // 指定キューからメッセージを受信.
    // queueUrl 対象のキューURLを設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         maxMessages: 最大取得件数(1-10)を設定します(デフォルト: 1).
    //         waitSeconds: ロングポーリング待機秒数(0-20)を設定します.
    //         visibilityTimeout: 可視性タイムアウト秒数を設定します.
    // 戻り値: [{ messageId, receiptHandle, body }, ...] が返却されます
    //         (メッセージが無い場合は空配列).
    exports.receive = async function (queueUrl, options) {
        if (options == undefined) {
            options = {};
        }
        const input = {
            QueueUrl: queueUrl,
            MaxNumberOfMessages: options.maxMessages != undefined ?
                parseInt(options.maxMessages) : 1
        }
        if (options.waitSeconds != undefined) {
            input["WaitTimeSeconds"] = parseInt(options.waitSeconds);
        }
        if (options.visibilityTimeout != undefined) {
            input["VisibilityTimeout"] = parseInt(options.visibilityTimeout);
        }
        try {
            const res = await _getSqsClient(options.region, options.credentials).send(
                new ReceiveMessageCommand(input)
            )
            const messages = res.Messages || [];
            return messages.map(function (m) {
                return {
                    messageId: m.MessageId,
                    receiptHandle: m.ReceiptHandle,
                    body: m.Body
                }
            });
        } catch (e) {
            console.warn("[SQS.RECEIVE]queueUrl: " + queueUrl +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return [];
        }
    }

    // 指定キューからメッセージを削除(受信済みメッセージの処理完了通知).
    // queueUrl 対象のキューURLを設定します.
    // receiptHandle receive で取得した対象メッセージのreceiptHandleを設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    exports.delete = async function (queueUrl, receiptHandle, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            await _getSqsClient(options.region, options.credentials).send(
                new DeleteMessageCommand({
                    QueueUrl: queueUrl,
                    ReceiptHandle: receiptHandle
                })
            )
            return true;
        } catch (e) {
            console.warn("[SQS.DELETE]queueUrl: " + queueUrl +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }
})();
