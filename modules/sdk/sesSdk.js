// AWS-SES接続(aws-sdk-v3).
// 最低限のメール送信(send)操作が利用できる.
//
// AIメモ:
// - テンプレート管理・添付ファイル付きメール(SendRawEmail/MIME組み立て)は
//   対象外にし、text/html本文のシンプルな送信のみに絞っている.
//
(function () {
    'use strict';

    // SES-Client.
    const {
        SESClient,
        SendEmailCommand
    } = require("@aws-sdk/client-ses")

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

    // リージョン毎のSESClient.
    const _SES_CLIENT = {};

    // SESClientオブジェクトを取得.
    const _getSesClient = function (region, credentials) {
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
            if (_SES_CLIENT[region] == undefined) {
                _SES_CLIENT[region] = new SESClient({
                    region: region
                });
            }
            return _SES_CLIENT[region];
        }
        // SESClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_SES_CLIENT[key] == undefined) {
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
            _SES_CLIENT[key] = new SESClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _SES_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // toをstring/array両対応でArray化.
    const _toArray = function (to) {
        if (to == undefined || to == null) {
            return [];
        }
        if (Array.isArray(to)) {
            return to;
        }
        return [to];
    }

    // メールを送信.
    // from 送信元メールアドレス(SESで検証済みのアドレス/ドメイン)を設定します.
    // to 宛先メールアドレスを設定します(文字列 or 文字列配列).
    // subject 件名を設定します.
    // body 本文を設定します(文字列、またはhtml指定時はHTML文字列).
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         html: true の場合bodyをHTML本文として送信します(デフォルト: false=text本文).
    //         cc: CC宛先メールアドレスを設定します(文字列 or 文字列配列).
    //         bcc: BCC宛先メールアドレスを設定します(文字列 or 文字列配列).
    //         replyTo: 返信先メールアドレスを設定します(文字列 or 文字列配列).
    //         charset: 文字コードを設定します(デフォルト: "UTF-8").
    // 戻り値: 送信結果の{messageId}が返却されます(失敗時はnull).
    exports.send = async function (from, to, subject, body, options) {
        if (options == undefined) {
            options = {};
        }
        const charset = options.charset == undefined ? "UTF-8" : options.charset;
        const bodyContent = {};
        if (options.html == true) {
            bodyContent["Html"] = { Data: body, Charset: charset };
        } else {
            bodyContent["Text"] = { Data: body, Charset: charset };
        }
        const input = {
            Source: from,
            Destination: {
                ToAddresses: _toArray(to)
            },
            Message: {
                Subject: { Data: subject, Charset: charset },
                Body: bodyContent
            }
        }
        if (options.cc != undefined) {
            input.Destination["CcAddresses"] = _toArray(options.cc);
        }
        if (options.bcc != undefined) {
            input.Destination["BccAddresses"] = _toArray(options.bcc);
        }
        if (options.replyTo != undefined) {
            input["ReplyToAddresses"] = _toArray(options.replyTo);
        }
        try {
            const res = await _getSesClient(options.region, options.credentials).send(
                new SendEmailCommand(input)
            )
            return { messageId: res.MessageId };
        } catch (e) {
            console.warn("[SES.SEND]from: " + from + " to: " + to +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }
})();
