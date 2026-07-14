// AWS-SNS接続(aws-sdk-v3).
// 最低限のSNS通知送信(publish)操作が利用できる.
//
// AIメモ:
// - トピック作成・購読(subscribe/unsubscribe)管理はIaC(CloudFormation/CDK等)
//   側の責務とみなし、本モジュールでは対象外にしている. 既存トピックへの
//   publishのみを提供する.
//
(function () {
    'use strict';

    // SNS-Client.
    const {
        SNSClient,
        PublishCommand
    } = require("@aws-sdk/client-sns")

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

    // リージョン毎のSNSClient.
    const _SNS_CLIENT = {};

    // SNSClientオブジェクトを取得.
    const _getSnsClient = function (region, credentials) {
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
            if (_SNS_CLIENT[region] == undefined) {
                _SNS_CLIENT[region] = new SNSClient({
                    region: region
                });
            }
            return _SNS_CLIENT[region];
        }
        // SNSClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_SNS_CLIENT[key] == undefined) {
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
            _SNS_CLIENT[key] = new SNSClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _SNS_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 指定トピックにメッセージをpublish.
    // topicArn 対象のトピックARNを設定します(SMS送信の場合は電話番号).
    // message 送信対象のメッセージ本文(文字列)を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         subject: 通知の件名(メール通知等で利用)を設定します.
    //         messageGroupId: FIFOトピック利用時のグループIDを設定します.
    //         messageDeduplicationId: FIFOトピック利用時の重複排除IDを設定します.
    // 戻り値: publish結果の{messageId}が返却されます(失敗時はnull).
    exports.publish = async function (topicArn, message, options) {
        if (options == undefined) {
            options = {};
        }
        const input = {
            TopicArn: topicArn,
            Message: message
        }
        if (options.subject != undefined) {
            input["Subject"] = "" + options.subject;
        }
        if (options.messageGroupId != undefined) {
            input["MessageGroupId"] = "" + options.messageGroupId;
        }
        if (options.messageDeduplicationId != undefined) {
            input["MessageDeduplicationId"] = "" + options.messageDeduplicationId;
        }
        try {
            const res = await _getSnsClient(options.region, options.credentials).send(
                new PublishCommand(input)
            )
            return { messageId: res.MessageId };
        } catch (e) {
            console.warn("[SNS.PUBLISH]topicArn: " + topicArn +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }
})();
