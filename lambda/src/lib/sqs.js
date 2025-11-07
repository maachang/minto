///////////////////////////////////////////////
// SQS ユーティリティ.
//
// asw4.js(AWS Signature version4)を使って
// SQSにPushする機能を実装する.
///////////////////////////////////////////////
(function () {
    'use strict';

    // signatureVersion4.
    const asv4 = require("./asv4.js");

    // サービス名.
    const SERVICE = "sqs";

    // [ENV]SQS利用対象AWS-ID.
    let ENV_AWS_ID = "MAIN_SQS_AWS_ID";

    // SQS利用対象AWS-IDの環境変数名を設定.
    const setEnvMainSqsAwsId = function (awsid) {
        // 空セットの場合.
        if (awsid == null || awsid == undefined ||
            awsid.length == 0) {
            ENV_AWS_ID = "MAIN_SQS_AWS_ID";
        } else {
            ENV_AWS_ID = awsid;
        }
    }

    // デフォルトリージョン(東京).
    let DEF_REGIN = "ap-northeast-1";

    // デフォルトリージョンをセット.
    const setRegion = function (region) {
        if (typeof (region) == "string") {
            DEF_REGIN = region;
        } else {
            // 設定なしの場合はデフォルトリージョン(東京).
            DEF_REGIN = "ap-northeast-1";
        }
    }

    // リージョンを取得.
    // region 対象のregionを設定します.
    // 戻り値: リージョンが返却されます.
    const getRegion = function (region) {
        if (region == undefined || region == null) {
            // 存在しない場合はデフォルトリージョン.
            region = DEF_REGIN;
        }
        return region;
    }

    // デフォルトのAWSID.
    let DEF_AWS_ID = null;

    // デフォルトAWSIDをセット.
    const setAwsId = function (awsId) {
        if (typeof (awsId) == "string") {
            DEF_AWS_ID = awsId;
        } else {
            DEF_AWS_ID = null;
        }
    }

    // AWSIDを取得.
    // awsId 対象のAWSIDを設定します.
    // 戻り値: AWSIDが返却されます.
    const getAwsId = function (awsid) {
        // 空セットの場合.
        if (awsid == null || awsid == undefined ||
            awsid.length == 0) {
            // 環境変数から取得.
            awsid = process.env[ENV_AWS_ID];
            if (awsid == null || awsid == undefined ||
                awsid.length == 0) {
                // 環境変数に存在しない場合はデフォルトAWSID.
                awsid = DEF_AWS_ID;
            }
        }
        return awsid;
    }


    // sqs-sendMessage用のHostとPathを取得.
    // queueName sqsのキュー名を設定(string).
    // awsId 対象SQSが存在するAwsIdを設定(string).
    // region 対象のregionを設定(string).
    // 戻り値: {host, path}
    //          - host: host名が返却されます.
    //          - path: path名が返却されます.
    const createHostAndPath = function (queueName, awsId, region) {
        // host名: sqs.{region}.amazonaws.com
        // path: {awsId}/{queueName}
        return {
            "host": SERVICE + "." + region + ".amazonaws.com",
            "path": awsId + "/" + queueName
        };
    }

    // リクエストヘッダを作成.
    // amzTarget AWSヘッダターゲットを設定します.
    // host 接続先のホスト名を設定します.
    // headers その他必要なヘッダ群を設定します.
    // 戻り値: リクエストヘッダ(object)が返却されます.
    const createRequestHeader = function (amzTarget, host, headers) {
        // x-amz-date はasv4.jsで付与されるので、
        // ここでは設定しない(400エラーになる)
        const ret = {
            "Host": host,
            "X-Amz-Target": amzTarget
        };
        if (headers != undefined && headers != null) {
            for (let k in headers) {
                ret[k] = headers[k];
            }
        }
        return ret;
    }

    // メッセージ送信用JSONを生成.
    const createSendMessageJson = function (url, msg) {
        if (!url.endsWith("/")) {
            url = url + "/";
        }
        return JSON.stringify({
            "MessageBody": msg,
            "QueueUrl": url
        });
    }

    // [sqs.sendMessage]"X-Amz-Target"
    const PUT_MSG_TARGET = "AmazonSQS.SendMessage";

    // [sqs.sendMessage]ヘッダ内容.
    const PUT_MSG_ADD_HEADERS = {
        "Content-Type": "application/x-amz-json-1.0"
    }

    // [sqs.sendMessage]メソッド名.
    const PUT_MSG_METHOD = "POST";

    // sqsキューメッセージを送信.
    // 現状は通常キューに対しての最低限の条件でメッセージ送信する仕組みと
    // なっています.
    // params: {credential, region, awsId, name, message}
    //   - credential {accessKey: string, secretAccessKey: string,
    //       sessionToken: string}
    //     - accessKey アクセスキーが返却されます.
    //     - secretAccessKey シークレットアクセスキーが返却されます.
    //     - sessionToken セッショントークンが返却されます.
    //                  状況によっては空の場合があります.
    //   - region 対象のリージョンを設定します.
    //   - awsId 対象SQSのAWSIDを設定します.
    //   - name 対象SQS名を設定します.
    //   - message 対象メッセージを設定します.
    //             string設定の場合はそのまま送信します.
    //             それ以外はJSON変換された文字列がメッセージとして出力されます.
    // 戻り値: response情報が返却されます.
    //         {status, headers, result}
    //          - status HTTPレスポンスステータスが返却されます.
    //          - headers HTTPレスポンスヘッダ群が返却されます.
    //          - result UrlFetchApp.fetch返却のHTTPレスポンス情報が返却されます.
    const putMessage = async function (params) {
        const credential = params.credential;
        const region = getRegion(params.region);
        const awsId = getAwsId(params.awsId);
        if (awsId == undefined || awsId == null) {
            throw new Error("The AWSID required for sqs is not set.");
        }
        let queueName = params.name || params.queueName;
        if (queueName == undefined || queueName == null) {
            throw new Error("The required QueueName is not set in sqs.");
        }
        let msg = params.message;
        if (msg == undefined || msg == null) {
            throw new Error("sqs required send message not set.");
        }
        if (typeof (msg) != "string") {
            // メッセージが文字列以外の場合はJSON文字列変換.
            msg = JSON.stringify(msg);
        }
        // URLを生成.
        const urlInfo = createHostAndPath(queueName, awsId, region);
        // リクエストヘッダを生成.
        const headers = createRequestHeader(PUT_MSG_TARGET, urlInfo.host, PUT_MSG_ADD_HEADERS);
        // URLを生成.
        const url = "https://" + urlInfo.host + "/" + urlInfo.path;
        // bodyを生成.
        const body = createSendMessageJson(url, msg);
        // シグニチャーを生成.
        asv4.setSignature(SERVICE, credential, region, urlInfo.path,
            PUT_MSG_METHOD, headers, null, body);
        const response = {};
        // HTTPSクライアント問い合わせ.
        await asv4.request(urlInfo.host, urlInfo.path, {
            method: PUT_MSG_METHOD,
            headers: headers,
            body: body,
            response: response
        });
        return response;
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.setEnvMainSqsAwsId = setEnvMainSqsAwsId;
    exports.setRegion = setRegion;
    exports.setAwsId = setAwsId;
    exports.putMessage = putMessage;

})(this);