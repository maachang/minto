///////////////////////////////////////////////
// slackメッセージ送信実装.
//
// SlackAppを利用したSlackメッセージ送信処理.
///////////////////////////////////////////////
(function () {
    'use strict';

    // signatureVersion4.
    // request(httpClient)だけを利用する.
    const { request } = require("./asv4.js");

    // SlackAppメッセージ送信URL.
    const BASE_URI = "slack.com";
    const BASE_API_PATH = "api/";

    // [ENV]SlackAPPトークン.
    let ENV_MAIN_SLACK_TOKEN = "SLACK_TOKEN";

    // SlackTokenの環境変数名を設定.
    const setEnvMainSlackToken = function (token) {
        // 空セットの場合.
        if (token == null || token == undefined ||
            token.length == 0) {
            ENV_MAIN_SLACK_TOKEN = "SLACK_TOKEN";
        } else {
            ENV_MAIN_SLACK_TOKEN = token;
        }
    }

    // 環境変数からslackTokenを取得.
    const getEnvSlackToken = function (access_token) {
        if (access_token == null || access_token == undefined ||
            access_token.length <= 0) {
            access_token = process.env[ENV_MAIN_SLACK_TOKEN];
        }
        return access_token;
    }

    // (await)postメッセージ送信.
    const sendPost = async function (rpcMethod, access_token, body, option) {
        body = body || {};
        option = option || {};
        option.headers = option.headers || {}
        if (body["channel"] == undefined) {
            throw new Error("The channel setting is required.")
        }
        access_token = getEnvSlackToken(access_token);
        if (access_token == null || access_token == undefined || access_token.length <= 0) {
            throw new Error("no credential access_token.");
        }
        // body送信.
        option.method = "POST";
        // resultType = json返却.
        option["resultType"] = "json";
        // json変換(text).
        option.body = JSON.stringify(body);
        option.headers["content-type"] = "application/json";
        // tokenセット.
        body.token = access_token;
        option.headers["authorization"] = "Bearer " + access_token;
        const res = await request(BASE_URI, BASE_API_PATH + rpcMethod, option);
        // 処理結果を返却.
        return res;
    }

    // (await)メッセージText送信.
    // channel [必須]:送信先チャンネルを設定します.
    // message [必須]送信メッセージを設定します.
    // userName slackユーザ名を設定します.
    //          これを有効にするには oauth 権限設定で `chat:write.customize` が必須です.
    // icon slackアイコン名を設定します.
    //          これを有効にするには oauth 権限設定で `chat:write.customize` が必須です.
    // options その他装飾等を行う場合は、ここに設定します.
    //         この辺は https://qiita.com/ik-fib/items/b4a502d173a22b3947a0
    //         などを参照してください.
    // access_token SlackAppのAccessTokenを直接設定する場合は、ここに設定します.
    // 戻り値: await: {ok:true} で正しく送信されました.
    const sendMessage = function (
        channel, message, userName, icon, options, access_token) {
        options = options || {}
        // Array形式の場合は、改行をセットして文字列化.
        if (Array.isArray(message)) {
            let n = "";
            const len = message.length;
            for (let i = 0; i < len; i++) {
                if (i != 0) {
                    n += "\n";
                }
                n += message[i];
            }
            message = n;
        }
        // 基本送信データ.
        options["text"] = message;
        // 送信先チャンネルが設定されている場合は、optionsにセット.
        if (typeof (channel) == "string" && channel.length > 0) {
            // slackチャンネル名に変換.
            if (!channel.startsWith("#")) {
                channel = "#" + channel;
            }
            options["channel"] = channel;
        }
        // 書き込みユーザ名(userName)を設定.
        if (typeof (userName) == "string" && userName.length > 0) {
            options["username"] = userName;
        }
        // 書き込みアイコン(icon_emoji)を設定.
        if (typeof (icon) == "string" && icon.length > 0) {
            // slackアイコン名に変換.
            if (!icon.startsWith(":")) {
                icon = ":" + icon;
            }
            if (!icon.endsWith(":")) {
                icon = icon + ":";
            }
            options["icon_emoji"] = icon;
        }
        return sendPost("chat.postMessage", access_token, options);
    }

    // (await)メッセージJSON送信.
    // channel 送信先チャンネルを設定します.
    // json 送信JSONを設定します.
    // access_token SlackAppのAccessTokenを直接設定する場合は、ここに設定します.
    // 戻り値: await: {ok:true} で正しく送信されました.
    const sendJSON = function (channel, json, access_token) {
        json = json || {};
        if (json["channel"] == undefined) {
            json["channel"] = channel;
        }
        return sendPost("chat.postMessage", access_token, json);
    }

    // 複数メッセージを１度のSlack送信メッセージで作成する用のオブジェクトを取得.
    // ここでは、１つのSlackメッセージ出力で、複数の処理結果のメッセージを送信する
    // ためのオブジェクトを生成します.
    // channel [必須]:送信先チャンネルを設定します.
    // userName slackユーザ名を設定します.
    //          これを有効にするには oauth 権限設定で `chat:write.customize` が必須です.
    // icon slackアイコン名を設定します.
    //          これを有効にするには oauth 権限設定で `chat:write.customize` が必須です.
    // options その他装飾等を行う場合は、ここに設定します.
    //         この辺は https://qiita.com/ik-fib/items/b4a502d173a22b3947a0
    //         などを参照してください.
    // access_token SlackAppのAccessTokenを直接設定する場合は、ここに設定します.
    // 戻り値: {clear, setMessage, getMessage, useMessage, flush}
    //           clear: メッセージバッファをクリアします.
    //           setMessage: メッセージバッファにメッセージを設定します.
    //             ("a", "b", "c") のように設定が出来て、この場合 "a\nb\nc\n" となります.
    //           getMessage: メッセージバッファ内容を取得します.
    //           useMessage: true の場合送信対象情報が存在します.
    //           (await)flush: メッセージバッファ内容を slackに出力します.
    const send = function (channel, userName, icon, options, access_token) {
        options = options || {}
        let msgBuffer = "";
        const ret = {};
        // メッセージクリア.
        ret.clear = function () {
            msgBuffer = "";
            return ret;
        }
        // メッセージセット.
        ret.setMessage = function () {
            const args = arguments;
            const len = args.length;
            for (let i = 0; i < len; i++) {
                if (msgBuffer.length > 0) {
                    msgBuffer += "\n";
                }
                msgBuffer += args[i];
            }
            return ret;
        }
        // メッセージ取得.
        ret.getMessage = function () {
            return msgBuffer;
        }
        // メッセージが存在するかチェックする.
        ret.useMessage = function () {
            return msgBuffer.length > 0;
        }
        // ユーザ名を変更.
        ret.setUserName = function (name) {
            userName = name;
            return ret;
        }
        // (await)slackに出力.
        ret.flush = function () {
            // 送信メッセージが存在しない場合は送信しない.
            if (msgBuffer.length <= 0) {
                return { ok: false };
            }
            // options の内容をコピー.
            const opt = {};
            for (let k in options) {
                opt[k] = options[k];
            }
            // メッセージバッファを送信する.
            const message = msgBuffer;
            msgBuffer = "";
            return sendMessage(
                channel, message, userName, icon, opt, access_token);
        }
        return ret;
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.setEnvMainSlackToken = setEnvMainSlackToken;
    exports.message = sendMessage;
    exports.json = sendJSON;
    exports.multi = send

})();