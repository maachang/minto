///////////////////////////////////////////////
// SQS ユーティリティ.
//
// asw4.js(AWS Signature version4)を使って
// SQSにPushする機能を実装する.
///////////////////////////////////////////////
(function () {
    'use strict';

    // signatureVersion4.
    const asv4 = $loadLib("./asv4.js");

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
    const createSendMessageJson = function (url, noBase64, msg) {
        // base64変換を行う場合.
        if (noBase64 != true) {
            // 日本語が入ったメッセージだと403になるので
            // messageはbase64変換して渡す.
            msg = Buffer.from(msg).toString("base64");
        }
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
    //   - noBase64 messageをbase64変換しない場合は true.

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
        const noBase64 = (params.noBase64 || false) == true;
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
        const body = createSendMessageJson(url, noBase64, msg);
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

    // SQSトリガーのデータ件数を取得.
    // event: index.handler で渡される第一引数を設定します.
    // 戻り値: SQSトリガー件数が返却されます.
    //         -1 の場合SQSトリガーのデータ件数は存在しません.
    const getSqsTriggerLength = function (event) {
        if (event["Records"] != undefined) {
            return event["Records"].length;
        }
        return -1;
    }

    // SQSトリガーのメッセージを取得.
    // event: index.handler で渡される第一引数を設定します.
    // no: 取得データ位置を設定します.
    // noBase64: 返却Bodyをbase64変換しない場合は true.
    // 戻り値: SQSに渡されたメッセージ(string))が返却されます.
    const getSqsTriggerMessage = function (event, no, noBase64) {
        let ret = null;
        // sqsから渡されるBodyを取得.
        // https://qiita.com/ybsh2891/items/c137660f72007b73dbe1
        ret = event["Records"][no]["body"];
        // base64変換しない場合.
        if (noBase64 == true) {
            return ret;
        }
        // base64化されているので戻す.
        return Buffer.from(ret, "base64").toString("utf-8");
    }

    // SQSトリガーのJSON結果を取得.
    // event: index.handler で渡される第一引数を設定します.
    // no: 取得データ位置を設定します.
    // noBase64: 返却Bodyをbase64変換しない場合は true.
    // 戻り値: SQSに渡されたメッセージ(json)が返却されます.
    const getSqsTriggerJson = function (event, no, noBase64) {
        // jsonパース内容を返却.
        return JSON.parse(getSqsTriggerMessage(event, no, noBase64));
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.setEnvMainSqsAwsId = setEnvMainSqsAwsId;
    exports.setRegion = setRegion;
    exports.setAwsId = setAwsId;
    exports.putMessage = putMessage;
    exports.getSqsTriggerLength = getSqsTriggerLength;
    exports.getSqsTriggerMessage = getSqsTriggerMessage;
    exports.getSqsTriggerJson = getSqsTriggerJson;

})(this);