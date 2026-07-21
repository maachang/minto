/**
 * [GAS専用]
 * この機能はGAS上で作成して.gsファイルとして展開する必要が
 * あります.
 * 
 * 内容としては以下を提供します.
 *  - GASを使ったoAuth機能を提供します.
 * 
 * あと以下の２つのスクリプトプロパティをGASで設定する必要があります.
 *  - ALLOW_AUTH_KEY_CODE
 *    Auth用KeyCode定義.
 *  - ALLOW_MAIL_DOMAINS
 *    許可するメールアドレスのドメイン名群.
 *    GASのスクリプトプロパティに "xxx, yyy, zzz" のように設定します.
 *  - GLOG_FOLDER_ID
 *    GLOG出力先のフォルダIDが設定されている場合はgasLogで永続化ログを出力します.
 */

// ログオブジェクト.
let Logger = null;

// --------------
// getMethod処理.
// --------------
function doGet(e) {
    Logger = createGuLog();
    try {
        return executeGAS(e);
    } finally {
        try {
            Logger.flush();
        } catch(ee) {
            Logger.error("Logger出力エラー: ", ee);
        }
    }
}

// [START]=============================.
const executeGAS = function(e) {
    const _PARAMS = e.parameter;
// ====================================.
    
    // [ENV][Token生成用]Auth用KeyCode定義.
    // 許可されたリクエストのみ利用が可能にするためのToken作成を行う
    // KeyCodeをGASのスクリプトプロパティに設定します.
    const ENV_ALLOW_AUTH_KEY_CODE = (function() {
        try {
            // スクリプトプロパティから設定情報を取得.
            return PropertiesService
                .getScriptProperties().getProperty("ALLOW_AUTH_KEY_CODE")
                .trim();
        } catch(e) {
            return undefined;
        }
    })();
    
    // [ENV関数][allow mail Domain]許可するメールアドレスのドメイン名群.
    // GASのスクリプトプロパティに "xxx, yyy, zzz" のように設定します.
    const ENV_ALLOW_MAIL_DOMAINS = function() {
        // ドメイン一覧をスクリプトプロパティから取得.
        const domains = convString(PropertiesService
            .getScriptProperties().getProperty("ALLOW_MAIL_DOMAINS"))
                .trim();
        // 何も設定されていない場合.
        if(domains.length == 0) {
            return [];
        }
        // データは"xxx, yyy, zzz"のように格納されるので、splitで
        // リスト化して、内容をそれぞれtrimする形とする.
        const list = domains.split(",");
        const ret = [];
        const len = list.length;
        for(let i = 0; i < len; i ++) {
            ret[i] = list[i].trim();
        }
        return ret;
    };
    
    // [実行パラメータ]処理タイプ.
    const PARAMS_EXECUTE_TARGET = "target";
    
    // [認証パラメータ]requestTokenKey.
    // request元がtokenを作成するに対して利用したrequestTokenKeyが
    // 格納されます.
    const PARAMS_REQUEST_TOKEN_KEY = "request-token-key";
    
    // [認証パラメータ]requestSuccessToken.
    // request側で作成した正解データ的なToken.
    const PARAMS_REQUEST_SUCCESS_TOKEN = "request-token";
    
    // [認証パラメータ]callbackURL.
    // 認証結果(mail/redirectToken等)の受け取り先(minto側)のURLが
    // 格納されます. ブラウザをここへtop.locationでリダイレクトさせる.
    const PARAMS_CALLBACK_URL = "callbackURL";

    // 文字列変換.
    const convString = function(v) {
        if(v == undefined || v == null) {
            return "";
        }
        return ("" + v).trim();
    }

    // HTMLでのtop.locationリダイレクトを返却.
    // GASのHtmlServiceレスポンスはサンドボックスiframe内に描画されるため、
    // 単なるwindow.location.hrefではなくtop.location.hrefで
    // トップレベルウィンドウ自体をリダイレクトさせる必要がある.
    // url リダイレクト先URLを設定します.
    const resultRedirect = function(url) {
        const html = "<!DOCTYPE html><html><head><base target=\"_top\">" +
            "<meta charset=\"UTF-8\"></head><body>" +
            "<script>top.location.href = " + JSON.stringify(url) + ";</script>" +
            "</body></html>";
        return HtmlService.createHtmlOutput(html);
    }

    // Googleログイン中のGoogleメールアドレスを取得.
    const getMailAddress = function() {
        return convString(Session.getActiveUser()
            .getEmail());
    }
    
    // URLパラメータを取得.
    const getParams = function() {
        return _PARAMS;
    }
    
    // hmacSHA256で変換.
    // data 対象のデータ
    // key 対象のキー
    // returnMode 何も設定しないや hex を設定した場合16進数文字列が返却されます.
    //            それ以外はbinaryの文字列が返却されます.
    // keyFormat KeyFormatを設定します.
    //            TEXT, BYTES, HEX
    // 戻り値 returnMode: に従って返却されます.
    const hmacSHA256 = function(key, message, returnMode, keyFormat = "TEXT") {
        const sha = new jsSHA("SHA-256", "TEXT");
        sha.setHMACKey(key, keyFormat);
        sha.update(message);
        if(returnMode == "hex") {
            return sha.getHash("HEX");
        }
        return sha.getHash("BYTES");
    }
    
    // tokenKeyCodeのタイムアウト値チェック.
    // tokenKeyCode: tokenKeyCodeを設定します.
    // 戻り値: タイムアウトの場合 true返却.
    const isTokenKeyCodeToTimeout = function(tokenKeyCode) {
        // base64デコード.
        tokenKeyCode = Utilities.newBlob(
            Utilities.base64Decode(
                tokenKeyCode, Utilities.Charset.UTF_8)
            ).getDataAsString();
        // tokenKeyCodeから生成時間を取得.
        const p = tokenKeyCode.lastIndexOf("_");
        if(p == -1) {
            Logger.error("expire取得失敗: " + tokenKeyCode)
            // 取得できない場合タイムアウト扱い.
            return true;
        }
        // TokenKeyCodeのexpire値を取得.
        const expireTokenKeyCode = parseInt(
            tokenKeyCode.substring(p + 1), 16);
        if(isNaN(expireTokenKeyCode)) {
            Logger.error("errorTimeoutValue: " +
                tokenKeyCode.substring(p + 1))
            // 取得できない場合タイムアウト扱い.
            return true;
        }
        Logger.log("timeout: " + (Date.now() > expireTokenKeyCode))
        // 渡されたTokenKeyCodeがexpire値を超えてる場合.
        return Date.now() > expireTokenKeyCode;
    }
    
    // token区切り文字.
    const TOKEN_DELIMIRATER = "$_$/\n";
    
    // 接続元からのアクセスが正しいかチェック.
    // 戻り値: falseの場合、アクセスは正しくないです.
    const isAuthRequestAccessToken = function() {
        // ENV_ALLOW_AUTH_KEY_CODEが未設定の場合.
        const allowAuthKeyCode = convString(ENV_ALLOW_AUTH_KEY_CODE);
        if(allowAuthKeyCode.length == 0) {
            // エラー返却.
            throw new Error(
                "Cannot process because the \"\"ENV_ALLOW_AUTH_KEY_CODE\"\" " +
                "environment variable is not set.");
        }
    
        // パラメータを取得.
        const params = getParams();
    
        // targetを取得して定義されているかチェック.
        let target = params[PARAMS_EXECUTE_TARGET];
        if(typeof(target) != "string" || target == "") {
            Logger.warn(PARAMS_EXECUTE_TARGET + " does not exist.");
            return false;
        }
        target = target.trim();
    
        // PARAMS_REQUEST_TOKEN_KEYが存在するかチェック.
        const tokenKeyCode = params[PARAMS_REQUEST_TOKEN_KEY];
        if(typeof(tokenKeyCode) != "string" || tokenKeyCode == "") {
            Logger.warn(PARAMS_REQUEST_TOKEN_KEY + " does not exist.");
            return false;
        }
    
        // PARAMS_REQUEST_TOKEN_KEYタイムアウトチェック.
        if(isTokenKeyCodeToTimeout(tokenKeyCode)) {
            // タイムアウト.
            Logger.warn(PARAMS_REQUEST_TOKEN_KEY +
              " is timed out.");
            return false;
        }
    
        // request側の正解データであるPARAMS_REQUEST_TOKENが
        // 存在するかチェック.
        const requestSuccessToken =
            params[PARAMS_REQUEST_SUCCESS_TOKEN];
        if(typeof(requestSuccessToken) != "string") {
            Logger.warn(PARAMS_REQUEST_SUCCESS_TOKEN + " does not exist.");
            return false;
        }
    
        // シグニチャを作成.
        // AIメモ: 以前はtarget別に個別のパラメータだけをsignatureに反映する
        // 実装だったが(oAuth用のsrcURLのみ、未実装のbusinessDay分岐は
        // 未定義変数参照のバグ持ちだった)、minto側(modules/auth/gasAuth.js の
        // createSendToken)は「認証管理用パラメータ以外の全パラメータを
        // key昇順でsignatureに連結する」汎用実装になっており、両者が
        // ズレていた(callbackURL等の新規パラメータ追加のたびに本ファイルの
        // 対応漏れが起きる構造だった)。minto側と全く同じ規則に合わせることで、
        // 今後addParamsに新しいキーを追加してもこちらの改修が不要になる.
        let signature = allowAuthKeyCode +
            TOKEN_DELIMIRATER + target +
            TOKEN_DELIMIRATER + tokenKeyCode;
        // 認証管理用・jsonp用パラメータ以外のキーを昇順で連結する.
        const excludeKeys = {};
        excludeKeys[PARAMS_EXECUTE_TARGET] = true;
        excludeKeys[PARAMS_REQUEST_TOKEN_KEY] = true;
        excludeKeys[PARAMS_REQUEST_SUCCESS_TOKEN] = true;
        const addKeys = [];
        for(const k in params) {
            if(!excludeKeys[k]) {
                addKeys.push(k);
            }
        }
        addKeys.sort();
        for(let i = 0; i < addKeys.length; i ++) {
            signature += TOKEN_DELIMIRATER + addKeys[i] +
                TOKEN_DELIMIRATER + convString(params[addKeys[i]]);
        }

        // signatureとrequestのtokenKeyCodeから
        // calcEqTokenを作成する.
        const calcEqToken = hmacSHA256(
            signature, tokenKeyCode, "hex"
        );
        
        // 作成したcalcEqTokenとrequestSuccessTokenを比較する.
        // trueの場合、リクエストのアクセストークンは正しい事を示す.
        if(calcEqToken == requestSuccessToken) {
            return true;
        }
        // 内容確認.
        Logger.log("# calcEqToken        : " + calcEqToken)
        Logger.log("# requestSuccessToken: " + requestSuccessToken)
    
        // 一致しない場合はsignature内容を出力.
        Logger.log("# notToken signature: " + signature);
        Logger.log("# target: " + target);
        Logger.log("# signature: " + signature);
    
        return false;
    }
    
    // メールアドレス許可されたかドメインのものかチェック.
    const isAllowMail = function(mail) {
        // メールアドレスではない.
        if(mail.indexOf("@") == -1) {
            Logger.warn("isAllowMail: 不正なメールアドレス形式のため却下: " + mail);
            return false;
        }
        const allowMailDomains = ENV_ALLOW_MAIL_DOMAINS();
        const len = allowMailDomains.length;
        // ドメインチェックが指定されていない場合.
        if(len == 0) {
            return true;
        }
        // メールアドレス許可されたかドメインのものかチェック
        for(let i = 0; i < len; i ++) {
            if(mail.endsWith("@" + allowMailDomains[i])) {
                // 一致した場合.
                return true;
            }
        }
        // 全てが不一致の場合.
        Logger.warn("isAllowMail: 許可ドメイン(" + allowMailDomains.join(", ") +
            ")に一致しないため却下: " + mail);
        return false;
    }
    
    // mailアドレスのチェックとTokenチェックを行い
    // 正しい場合、メールアドレスを返却.
    const getMailAndAuthMailAndAuthToken = function() {
        try {
            // メールアドレスを取得.
            const mail = getMailAddress();
            Logger.log("# mail: " + mail);
            const isMail = isAllowMail(mail);
            Logger.log("# isAllowMail: " + isMail);
            const isAuth = isAuthRequestAccessToken();
            Logger.log("# isAuthRequestAccessToken: " + isAuth);
            // 許可されたメールアドレスのドメイン名であり
            // tokenが正しい事場合、メールアドレスを返却.
            if(isMail && isAuth) {
                return mail;
            }
        } catch(e) {
            Logger.error("[ERROR]getMailAndAuthMailAndAuthToken: ", e);
        }
        // 失敗の場合は空を返却.
        return ""
    }
    
    // [実行パラメータ]アカウントデータの使用を許可.
    const PARAMS_TYPE_ALLOW_ACCOUNT_DATA = "allowAccountData";
    
    // [実行パラメータ]oAuth認証確認.
    const PARAMS_TYPE_OAUTH = "oAuth";
    
    // [oAuth用パラメータ]元のアクセスURL.
    // 本来アクセスしたいURLが設定されます.
    const PARAMS_SOURCE_ACCESS_URL = "srcURL";
    
    // redierctTokenごまかし的難読化テーブル.
    const REDIRECT_TOKEN_DF = {
        "0": "_Q", "1": "O", "2": "p8", "3": "~c", "4": "jE", "5z": "8_9", "6": "u", "7": "3G",
        "8": "n", "9": "E", "a": "~K", "b": "i", "c": "W6", "d": "d", "e": "=d", "f": "3E"   
    };
    
    // リダイレクト用Tokenを生成.
    // type 実行パラメータを設定します.
    // mail 認証済みメールアドレスを設定します(signatureに含めることで、
    //      redirectToken発行後にmailだけ差し替えるなりすましを防ぐ).
    const createRedirectToken = function(type, mail) {
        const requestTokenKey = getParams()[
            PARAMS_REQUEST_TOKEN_KEY];
        // 指定requestTokenKeyとtypeとmailを融合する.
        let len = requestTokenKey.length;
        const signature =
            "~=$_" +
            requestTokenKey.substring(len >> 1) +
            TOKEN_DELIMIRATER +
            type + "=_~!~" +
            requestTokenKey.substring(0, len >> 1) +
            TOKEN_DELIMIRATER +
            mail;
        // tokenを生成.
        const token = hmacSHA256(
            ENV_ALLOW_AUTH_KEY_CODE, signature, "hex");
        // 対象Tokenに対して、ごまかし的難読化する.
        len = token.length;
        let ret = "";
        for(let i = 0; i < len; i ++) {
            ret += REDIRECT_TOKEN_DF[token[i]];
        }
        return ret;
    }
    
    /**
     * [HTML返却]GoogleAppScript(以降GAS)を会社で契約している場合に使える便利機能処理.
     * 
     * この内容をGASに登録した後にそこで払い出されたURLを元にこの機能を使って
     * 擬似的なoAuthを実現します.
     * 
     * GASが会社で契約されている場合、GoogleWorkspace内の利用は契約した
     * GoogleWorkspace内でのアクセスが許可され、その時のログイン中のメアドが
     * 取得できるので、利用者の情報を取得する事ができます.
     * 
     * この機能を使って、このプログラムを使って他のアクセスに対して簡易的な
     * OAuth的なことをできるようにします.
     * 
     * 今回はLFUが実行形態であるLambdaFunctionURLとの連携のような、ドメインが無いと
     * OAuthできないそのような環境において、GASを挟んでこのGASでログイン中の
     * メールアドレスを取得してユーザー情報を取得する形とします.
     * 
     * あと、元のrequestTokenとredirectTokenを元にredirectが正しく行われた事を
     * 保証する条件を返却して、oauthの認可が正しいものかを設定します.
     */
    // callbackURLにクエリパラメータを追加する.
    const appendParam = function(url, key, value) {
        return url + (url.indexOf("?") != -1 ? "&" : "?") +
            encodeURIComponent(key) + "=" + encodeURIComponent(value);
    }

    const executeOAuth = function() {
        const params = getParams();
        const callbackURL = convString(params[PARAMS_CALLBACK_URL]);
        try {
            if(callbackURL == "") {
                throw new Error("callbackURL is not set.");
            }
            // 許可されたメールアドレスのドメインで
            // tokenも正しい場合はメールアドレスが付与されるか確認.
            const mail = getMailAndAuthMailAndAuthToken();
            if(mail == "") {
                // 認証が失敗の場合.
                throw new Error("gas login failed.");
            }
            const srcURL = convString(params[PARAMS_SOURCE_ACCESS_URL]);
            Logger.log("# srcURL: " + srcURL);

            // 認証結果をcallbackURL(minto側の検証エンドポイント)へ
            // 付与してブラウザをトップレベルでリダイレクトさせる.
            let redirectURL = callbackURL;
            redirectURL = appendParam(redirectURL, "mail", mail);
            redirectURL = appendParam(redirectURL, "type", PARAMS_TYPE_OAUTH);
            redirectURL = appendParam(redirectURL, "tokenKey", params[PARAMS_REQUEST_TOKEN_KEY]);
            redirectURL = appendParam(redirectURL, "redirectToken", createRedirectToken(PARAMS_TYPE_OAUTH, mail));
            redirectURL = appendParam(redirectURL, "srcURL", srcURL);
            // 認証成功の監査ログ(誰が・どこへ). tokenやredirectToken等の
            // 秘匿情報は出力しない.
            Logger.log("[SUCCESS]executeOAuth: mail=" + mail +
                " callbackURL=" + callbackURL + " srcURL=" + srcURL);
            return resultRedirect(redirectURL);
        } catch(e) {
            // 例外もoAuth失敗扱い.
            Logger.error("[ERROR]executeOAuth: ", e);
        }
        // oAuth失敗. callbackURLが判明していれば、そこへerror付きで
        // リダイレクトしてminto側でエラーハンドリングできるようにする
        // (callbackURL自体が不明な場合のみ、その場でエラー表示する).
        if(callbackURL != "") {
            Logger.warn("[FAILED]executeOAuth: callbackURL=" + callbackURL);
            return resultRedirect(
                appendParam(callbackURL, "error", "oAuth authentication process failed"));
        }
        Logger.error("[FAILED]executeOAuth: callbackURL is not set.");
        return HtmlService.createHtmlOutput(
            "oAuth authentication process failed: callbackURL is not set.");
    }
    
    // ゼロ返却のresult返却.
    const zeroResult = function() {
        // 空のplain/textの条件を返信.
        const ret = ContentService.createTextOutput();
        ret.setMimeType(ContentService.MimeType.TEXT);
        ret.setContent(" ");
        return ret;
    }
    
    // 実行ターゲットパラメータを取得.
    return (function() {
        // 実行ターゲットを取得.
        let target = getParams()[PARAMS_EXECUTE_TARGET];
        // パラメータが設定されている場合.
        if(typeof(target) == "string") {
            // それぞれの実行条件を選別.
            switch(target.trim()) {
                // アカウントデータの利用許可用.
                case PARAMS_TYPE_ALLOW_ACCOUNT_DATA:
                    // アクセスがあったらsuccess返却するだけ.
                    Logger.log("allowAccountData accessed: mail=" + getMailAddress());
                    const res = ContentService.createTextOutput();
                    res.setMimeType(ContentService.MimeType.TEXT);
                    res.setContent("success");
                    return res;
                // oauth実行.
                case PARAMS_TYPE_OAUTH:
                    return executeOAuth();
            }
            // 未知のtargetが指定された場合(不正アクセスの兆候調査用).
            Logger.warn("Unknown target: " + target);
        } else {
            Logger.warn("target parameter is not set.");
        }
        // 条件内容が存在しない場合の返却.
        return zeroResult();
    })();
    
// [END]===============================.
};
// ====================================.

// jsSHA.
// https://github.com/Caligatio/jsSHA?tab=readme-ov-file
!function(n,r){"object"==typeof exports&&"undefined"!=typeof module?module.exports=r():"function"==typeof define&&define.amd?define(r):(n="undefined"!=typeof globalThis?globalThis:n||self).jsSHA=r()}(this,(function(){"use strict";var n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",r="ARRAYBUFFER not supported by this environment",t="UINT8ARRAY not supported by this environment";function e(n,r,t,e){var i,o,u,f=r||[0],s=(t=t||0)>>>3,w=-1===e?3:0;for(i=0;i<n.length;i+=1)o=(u=i+s)>>>2,f.length<=o&&f.push(0),f[o]|=n[i]<<8*(w+e*(u%4));return{value:f,binLen:8*n.length+t}}function i(i,o,u){switch(o){case"UTF8":case"UTF16BE":case"UTF16LE":break;default:throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE")}switch(i){case"HEX":return function(n,r,t){return function(n,r,t,e){var i,o,u,f;if(0!=n.length%2)throw new Error("String of HEX type must be in byte increments");var s=r||[0],w=(t=t||0)>>>3,a=-1===e?3:0;for(i=0;i<n.length;i+=2){if(o=parseInt(n.substr(i,2),16),isNaN(o))throw new Error("String of HEX type contains invalid characters");for(u=(f=(i>>>1)+w)>>>2;s.length<=u;)s.push(0);s[u]|=o<<8*(a+e*(f%4))}return{value:s,binLen:4*n.length+t}}(n,r,t,u)};case"TEXT":return function(n,r,t){return function(n,r,t,e,i){var o,u,f,s,w,a,h,c,v=0,A=t||[0],E=(e=e||0)>>>3;if("UTF8"===r)for(h=-1===i?3:0,f=0;f<n.length;f+=1)for(u=[],128>(o=n.charCodeAt(f))?u.push(o):2048>o?(u.push(192|o>>>6),u.push(128|63&o)):55296>o||57344<=o?u.push(224|o>>>12,128|o>>>6&63,128|63&o):(f+=1,o=65536+((1023&o)<<10|1023&n.charCodeAt(f)),u.push(240|o>>>18,128|o>>>12&63,128|o>>>6&63,128|63&o)),s=0;s<u.length;s+=1){for(w=(a=v+E)>>>2;A.length<=w;)A.push(0);A[w]|=u[s]<<8*(h+i*(a%4)),v+=1}else for(h=-1===i?2:0,c="UTF16LE"===r&&1!==i||"UTF16LE"!==r&&1===i,f=0;f<n.length;f+=1){for(o=n.charCodeAt(f),!0===c&&(o=(s=255&o)<<8|o>>>8),w=(a=v+E)>>>2;A.length<=w;)A.push(0);A[w]|=o<<8*(h+i*(a%4)),v+=2}return{value:A,binLen:8*v+e}}(n,o,r,t,u)};case"B64":return function(r,t,e){return function(r,t,e,i){var o,u,f,s,w,a,h=0,c=t||[0],v=(e=e||0)>>>3,A=-1===i?3:0,E=r.indexOf("=");if(-1===r.search(/^[a-zA-Z0-9=+/]+$/))throw new Error("Invalid character in base-64 string");if(r=r.replace(/=/g,""),-1!==E&&E<r.length)throw new Error("Invalid '=' found in base-64 string");for(o=0;o<r.length;o+=4){for(s=r.substr(o,4),f=0,u=0;u<s.length;u+=1)f|=n.indexOf(s.charAt(u))<<18-6*u;for(u=0;u<s.length-1;u+=1){for(w=(a=h+v)>>>2;c.length<=w;)c.push(0);c[w]|=(f>>>16-8*u&255)<<8*(A+i*(a%4)),h+=1}}return{value:c,binLen:8*h+e}}(r,t,e,u)};case"BYTES":return function(n,r,t){return function(n,r,t,e){var i,o,u,f,s=r||[0],w=(t=t||0)>>>3,a=-1===e?3:0;for(o=0;o<n.length;o+=1)i=n.charCodeAt(o),u=(f=o+w)>>>2,s.length<=u&&s.push(0),s[u]|=i<<8*(a+e*(f%4));return{value:s,binLen:8*n.length+t}}(n,r,t,u)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(n){throw new Error(r)}return function(n,r,t){return function(n,r,t,i){return e(new Uint8Array(n),r,t,i)}(n,r,t,u)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(n){throw new Error(t)}return function(n,r,t){return e(n,r,t,u)};default:throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}function o(e,i,o,u){switch(e){case"HEX":return function(n){return function(n,r,t,e){var i,o,u="0123456789abcdef",f="",s=r/8,w=-1===t?3:0;for(i=0;i<s;i+=1)o=n[i>>>2]>>>8*(w+t*(i%4)),f+=u.charAt(o>>>4&15)+u.charAt(15&o);return e.outputUpper?f.toUpperCase():f}(n,i,o,u)};case"B64":return function(r){return function(r,t,e,i){var o,u,f,s,w,a="",h=t/8,c=-1===e?3:0;for(o=0;o<h;o+=3)for(s=o+1<h?r[o+1>>>2]:0,w=o+2<h?r[o+2>>>2]:0,f=(r[o>>>2]>>>8*(c+e*(o%4))&255)<<16|(s>>>8*(c+e*((o+1)%4))&255)<<8|w>>>8*(c+e*((o+2)%4))&255,u=0;u<4;u+=1)a+=8*o+6*u<=t?n.charAt(f>>>6*(3-u)&63):i.b64Pad;return a}(r,i,o,u)};case"BYTES":return function(n){return function(n,r,t){var e,i,o="",u=r/8,f=-1===t?3:0;for(e=0;e<u;e+=1)i=n[e>>>2]>>>8*(f+t*(e%4))&255,o+=String.fromCharCode(i);return o}(n,i,o)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(n){throw new Error(r)}return function(n){return function(n,r,t){var e,i=r/8,o=new ArrayBuffer(i),u=new Uint8Array(o),f=-1===t?3:0;for(e=0;e<i;e+=1)u[e]=n[e>>>2]>>>8*(f+t*(e%4))&255;return o}(n,i,o)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(n){throw new Error(t)}return function(n){return function(n,r,t){var e,i=r/8,o=-1===t?3:0,u=new Uint8Array(i);for(e=0;e<i;e+=1)u[e]=n[e>>>2]>>>8*(o+t*(e%4))&255;return u}(n,i,o)};default:throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}var u=4294967296,f=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],s=[3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428],w=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],a="Chosen SHA variant is not supported",h="Cannot set numRounds with MAC";function c(n,r){var t,e,i=n.binLen>>>3,o=r.binLen>>>3,u=i<<3,f=4-i<<3;if(i%4!=0){for(t=0;t<o;t+=4)e=i+t>>>2,n.value[e]|=r.value[t>>>2]<<u,n.value.push(0),n.value[e+1]|=r.value[t>>>2]>>>f;return(n.value.length<<2)-4>=o+i&&n.value.pop(),{value:n.value,binLen:n.binLen+r.binLen}}return{value:n.value.concat(r.value),binLen:n.binLen+r.binLen}}function v(n){var r={outputUpper:!1,b64Pad:"=",outputLen:-1},t=n||{},e="Output length must be a multiple of 8";if(r.outputUpper=t.outputUpper||!1,t.b64Pad&&(r.b64Pad=t.b64Pad),t.outputLen){if(t.outputLen%8!=0)throw new Error(e);r.outputLen=t.outputLen}else if(t.shakeLen){if(t.shakeLen%8!=0)throw new Error(e);r.outputLen=t.shakeLen}if("boolean"!=typeof r.outputUpper)throw new Error("Invalid outputUpper formatting option");if("string"!=typeof r.b64Pad)throw new Error("Invalid b64Pad formatting option");return r}function A(n,r,t,e){var o=n+" must include a value and format";if(!r){if(!e)throw new Error(o);return e}if(void 0===r.value||!r.format)throw new Error(o);return i(r.format,r.encoding||"UTF8",t)(r.value)}var E=function(){function n(n,r,t){var e=t||{};if(this.t=r,this.i=e.encoding||"UTF8",this.numRounds=e.numRounds||1,isNaN(this.numRounds)||this.numRounds!==parseInt(this.numRounds,10)||1>this.numRounds)throw new Error("numRounds must a integer >= 1");this.o=n,this.u=[],this.h=0,this.v=!1,this.A=0,this.l=!1,this.S=[],this.H=[]}return n.prototype.update=function(n){var r,t=0,e=this.p>>>5,i=this.m(n,this.u,this.h),o=i.binLen,u=i.value,f=o>>>5;for(r=0;r<f;r+=e)t+this.p<=o&&(this.U=this.R(u.slice(r,r+e),this.U),t+=this.p);return this.A+=t,this.u=u.slice(t>>>5),this.h=o%this.p,this.v=!0,this},n.prototype.getHash=function(n,r){var t,e,i=this.T,u=v(r);if(this.C){if(-1===u.outputLen)throw new Error("Output length must be specified in options");i=u.outputLen}var f=o(n,i,this.F,u);if(this.l&&this.K)return f(this.K(u));for(e=this.g(this.u.slice(),this.h,this.A,this.L(this.U),i),t=1;t<this.numRounds;t+=1)this.C&&i%32!=0&&(e[e.length-1]&=16777215>>>24-i%32),e=this.g(e,i,0,this.B(this.o),i);return f(e)},n.prototype.setHMACKey=function(n,r,t){if(!this.k)throw new Error("Variant does not support HMAC");if(this.v)throw new Error("Cannot set MAC key after calling update");var e=i(r,(t||{}).encoding||"UTF8",this.F);this.Y(e(n))},n.prototype.Y=function(n){var r,t=this.p>>>3,e=t/4-1;if(1!==this.numRounds)throw new Error(h);if(this.l)throw new Error("MAC key already set");for(t<n.binLen/8&&(n.value=this.g(n.value,n.binLen,0,this.B(this.o),this.T));n.value.length<=e;)n.value.push(0);for(r=0;r<=e;r+=1)this.S[r]=909522486^n.value[r],this.H[r]=1549556828^n.value[r];this.U=this.R(this.S,this.U),this.A=this.p,this.l=!0},n.prototype.getHMAC=function(n,r){var t=v(r);return o(n,this.T,this.F,t)(this.N())},n.prototype.N=function(){var n;if(!this.l)throw new Error("Cannot call getHMAC without first setting MAC key");var r=this.g(this.u.slice(),this.h,this.A,this.L(this.U),this.T);return n=this.R(this.H,this.B(this.o)),n=this.g(r,this.T,this.p,n,this.T)},n}(),l=function(n,r){return l=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(n,r){n.__proto__=r}||function(n,r){for(var t in r)Object.prototype.hasOwnProperty.call(r,t)&&(n[t]=r[t])},l(n,r)};function b(n,r){if("function"!=typeof r&&null!==r)throw new TypeError("Class extends value "+String(r)+" is not a constructor or null");function t(){this.constructor=n}l(n,r),n.prototype=null===r?Object.create(r):(t.prototype=r.prototype,new t)}function S(n,r){return n<<r|n>>>32-r}function H(n,r){return n>>>r|n<<32-r}function d(n,r){return n>>>r}function p(n,r,t){return n^r^t}function y(n,r,t){return n&r^~n&t}function m(n,r,t){return n&r^n&t^r&t}function U(n){return H(n,2)^H(n,13)^H(n,22)}function R(n,r){var t=(65535&n)+(65535&r);return(65535&(n>>>16)+(r>>>16)+(t>>>16))<<16|65535&t}function T(n,r,t,e){var i=(65535&n)+(65535&r)+(65535&t)+(65535&e);return(65535&(n>>>16)+(r>>>16)+(t>>>16)+(e>>>16)+(i>>>16))<<16|65535&i}function C(n,r,t,e,i){var o=(65535&n)+(65535&r)+(65535&t)+(65535&e)+(65535&i);return(65535&(n>>>16)+(r>>>16)+(t>>>16)+(e>>>16)+(i>>>16)+(o>>>16))<<16|65535&o}function F(n){return H(n,7)^H(n,18)^d(n,3)}function K(n){return H(n,6)^H(n,11)^H(n,25)}function g(n){return[1732584193,4023233417,2562383102,271733878,3285377520]}function L(n,r){var t,e,i,o,u,f,s,w=[];for(t=r[0],e=r[1],i=r[2],o=r[3],u=r[4],s=0;s<80;s+=1)w[s]=s<16?n[s]:S(w[s-3]^w[s-8]^w[s-14]^w[s-16],1),f=s<20?C(S(t,5),y(e,i,o),u,1518500249,w[s]):s<40?C(S(t,5),p(e,i,o),u,1859775393,w[s]):s<60?C(S(t,5),m(e,i,o),u,2400959708,w[s]):C(S(t,5),p(e,i,o),u,3395469782,w[s]),u=o,o=i,i=S(e,30),e=t,t=f;return r[0]=R(t,r[0]),r[1]=R(e,r[1]),r[2]=R(i,r[2]),r[3]=R(o,r[3]),r[4]=R(u,r[4]),r}function B(n,r,t,e){for(var i,o=15+(r+65>>>9<<4),f=r+t;n.length<=o;)n.push(0);for(n[r>>>5]|=128<<24-r%32,n[o]=4294967295&f,n[o-1]=f/u|0,i=0;i<n.length;i+=16)e=L(n.slice(i,i+16),e);return e}"function"==typeof SuppressedError&&SuppressedError;var k=function(n){function r(r,t,e){var o=this;if("SHA-1"!==r)throw new Error(a);var u=e||{};return(o=n.call(this,r,t,e)||this).k=!0,o.K=o.N,o.F=-1,o.m=i(o.t,o.i,o.F),o.R=L,o.L=function(n){return n.slice()},o.B=g,o.g=B,o.U=[1732584193,4023233417,2562383102,271733878,3285377520],o.p=512,o.T=160,o.C=!1,u.hmacKey&&o.Y(A("hmacKey",u.hmacKey,o.F)),o}return b(r,n),r}(E);function Y(n){return"SHA-224"==n?s.slice():w.slice()}function N(n,r){var t,e,i,o,u,s,w,a,h,c,v,A,E=[];for(t=r[0],e=r[1],i=r[2],o=r[3],u=r[4],s=r[5],w=r[6],a=r[7],v=0;v<64;v+=1)E[v]=v<16?n[v]:T(H(A=E[v-2],17)^H(A,19)^d(A,10),E[v-7],F(E[v-15]),E[v-16]),h=C(a,K(u),y(u,s,w),f[v],E[v]),c=R(U(t),m(t,e,i)),a=w,w=s,s=u,u=R(o,h),o=i,i=e,e=t,t=R(h,c);return r[0]=R(t,r[0]),r[1]=R(e,r[1]),r[2]=R(i,r[2]),r[3]=R(o,r[3]),r[4]=R(u,r[4]),r[5]=R(s,r[5]),r[6]=R(w,r[6]),r[7]=R(a,r[7]),r}var I=function(n){function r(r,t,e){var o=this;if("SHA-224"!==r&&"SHA-256"!==r)throw new Error(a);var f=e||{};return(o=n.call(this,r,t,e)||this).K=o.N,o.k=!0,o.F=-1,o.m=i(o.t,o.i,o.F),o.R=N,o.L=function(n){return n.slice()},o.B=Y,o.g=function(n,t,e,i){return function(n,r,t,e,i){for(var o,f=15+(r+65>>>9<<4),s=r+t;n.length<=f;)n.push(0);for(n[r>>>5]|=128<<24-r%32,n[f]=4294967295&s,n[f-1]=s/u|0,o=0;o<n.length;o+=16)e=N(n.slice(o,o+16),e);return"SHA-224"===i?[e[0],e[1],e[2],e[3],e[4],e[5],e[6]]:e}(n,t,e,i,r)},o.U=Y(r),o.p=512,o.T="SHA-224"===r?224:256,o.C=!1,f.hmacKey&&o.Y(A("hmacKey",f.hmacKey,o.F)),o}return b(r,n),r}(E),M=function(n,r){this.I=n,this.M=r};function X(n,r){var t;return r>32?(t=64-r,new M(n.M<<r|n.I>>>t,n.I<<r|n.M>>>t)):0!==r?(t=32-r,new M(n.I<<r|n.M>>>t,n.M<<r|n.I>>>t)):n}function z(n,r){var t;return r<32?(t=32-r,new M(n.I>>>r|n.M<<t,n.M>>>r|n.I<<t)):(t=64-r,new M(n.M>>>r|n.I<<t,n.I>>>r|n.M<<t))}function O(n,r){return new M(n.I>>>r,n.M>>>r|n.I<<32-r)}function j(n,r,t){return new M(n.I&r.I^~n.I&t.I,n.M&r.M^~n.M&t.M)}function _(n,r,t){return new M(n.I&r.I^n.I&t.I^r.I&t.I,n.M&r.M^n.M&t.M^r.M&t.M)}function x(n){var r=z(n,28),t=z(n,34),e=z(n,39);return new M(r.I^t.I^e.I,r.M^t.M^e.M)}function P(n,r){var t,e;t=(65535&n.M)+(65535&r.M);var i=(65535&(e=(n.M>>>16)+(r.M>>>16)+(t>>>16)))<<16|65535&t;return t=(65535&n.I)+(65535&r.I)+(e>>>16),e=(n.I>>>16)+(r.I>>>16)+(t>>>16),new M((65535&e)<<16|65535&t,i)}function V(n,r,t,e){var i,o;i=(65535&n.M)+(65535&r.M)+(65535&t.M)+(65535&e.M);var u=(65535&(o=(n.M>>>16)+(r.M>>>16)+(t.M>>>16)+(e.M>>>16)+(i>>>16)))<<16|65535&i;return i=(65535&n.I)+(65535&r.I)+(65535&t.I)+(65535&e.I)+(o>>>16),o=(n.I>>>16)+(r.I>>>16)+(t.I>>>16)+(e.I>>>16)+(i>>>16),new M((65535&o)<<16|65535&i,u)}function Z(n,r,t,e,i){var o,u;o=(65535&n.M)+(65535&r.M)+(65535&t.M)+(65535&e.M)+(65535&i.M);var f=(65535&(u=(n.M>>>16)+(r.M>>>16)+(t.M>>>16)+(e.M>>>16)+(i.M>>>16)+(o>>>16)))<<16|65535&o;return o=(65535&n.I)+(65535&r.I)+(65535&t.I)+(65535&e.I)+(65535&i.I)+(u>>>16),u=(n.I>>>16)+(r.I>>>16)+(t.I>>>16)+(e.I>>>16)+(i.I>>>16)+(o>>>16),new M((65535&u)<<16|65535&o,f)}function q(n,r){return new M(n.I^r.I,n.M^r.M)}function D(n){var r=z(n,1),t=z(n,8),e=O(n,7);return new M(r.I^t.I^e.I,r.M^t.M^e.M)}function G(n){var r=z(n,14),t=z(n,18),e=z(n,41);return new M(r.I^t.I^e.I,r.M^t.M^e.M)}var J=[new M(f[0],3609767458),new M(f[1],602891725),new M(f[2],3964484399),new M(f[3],2173295548),new M(f[4],4081628472),new M(f[5],3053834265),new M(f[6],2937671579),new M(f[7],3664609560),new M(f[8],2734883394),new M(f[9],1164996542),new M(f[10],1323610764),new M(f[11],3590304994),new M(f[12],4068182383),new M(f[13],991336113),new M(f[14],633803317),new M(f[15],3479774868),new M(f[16],2666613458),new M(f[17],944711139),new M(f[18],2341262773),new M(f[19],2007800933),new M(f[20],1495990901),new M(f[21],1856431235),new M(f[22],3175218132),new M(f[23],2198950837),new M(f[24],3999719339),new M(f[25],766784016),new M(f[26],2566594879),new M(f[27],3203337956),new M(f[28],1034457026),new M(f[29],2466948901),new M(f[30],3758326383),new M(f[31],168717936),new M(f[32],1188179964),new M(f[33],1546045734),new M(f[34],1522805485),new M(f[35],2643833823),new M(f[36],2343527390),new M(f[37],1014477480),new M(f[38],1206759142),new M(f[39],344077627),new M(f[40],1290863460),new M(f[41],3158454273),new M(f[42],3505952657),new M(f[43],106217008),new M(f[44],3606008344),new M(f[45],1432725776),new M(f[46],1467031594),new M(f[47],851169720),new M(f[48],3100823752),new M(f[49],1363258195),new M(f[50],3750685593),new M(f[51],3785050280),new M(f[52],3318307427),new M(f[53],3812723403),new M(f[54],2003034995),new M(f[55],3602036899),new M(f[56],1575990012),new M(f[57],1125592928),new M(f[58],2716904306),new M(f[59],442776044),new M(f[60],593698344),new M(f[61],3733110249),new M(f[62],2999351573),new M(f[63],3815920427),new M(3391569614,3928383900),new M(3515267271,566280711),new M(3940187606,3454069534),new M(4118630271,4000239992),new M(116418474,1914138554),new M(174292421,2731055270),new M(289380356,3203993006),new M(460393269,320620315),new M(685471733,587496836),new M(852142971,1086792851),new M(1017036298,365543100),new M(1126000580,2618297676),new M(1288033470,3409855158),new M(1501505948,4234509866),new M(1607167915,987167468),new M(1816402316,1246189591)];function Q(n){return"SHA-384"===n?[new M(3418070365,s[0]),new M(1654270250,s[1]),new M(2438529370,s[2]),new M(355462360,s[3]),new M(1731405415,s[4]),new M(41048885895,s[5]),new M(3675008525,s[6]),new M(1203062813,s[7])]:[new M(w[0],4089235720),new M(w[1],2227873595),new M(w[2],4271175723),new M(w[3],1595750129),new M(w[4],2917565137),new M(w[5],725511199),new M(w[6],4215389547),new M(w[7],327033209)]}function W(n,r){var t,e,i,o,u,f,s,w,a,h,c,v,A,E,l,b,S=[];for(t=r[0],e=r[1],i=r[2],o=r[3],u=r[4],f=r[5],s=r[6],w=r[7],c=0;c<80;c+=1)c<16?(v=2*c,S[c]=new M(n[v],n[v+1])):S[c]=V((A=S[c-2],E=void 0,l=void 0,b=void 0,E=z(A,19),l=z(A,61),b=O(A,6),new M(E.I^l.I^b.I,E.M^l.M^b.M)),S[c-7],D(S[c-15]),S[c-16]),a=Z(w,G(u),j(u,f,s),J[c],S[c]),h=P(x(t),_(t,e,i)),w=s,s=f,f=u,u=P(o,a),o=i,i=e,e=t,t=P(a,h);return r[0]=P(t,r[0]),r[1]=P(e,r[1]),r[2]=P(i,r[2]),r[3]=P(o,r[3]),r[4]=P(u,r[4]),r[5]=P(f,r[5]),r[6]=P(s,r[6]),r[7]=P(w,r[7]),r}var $=function(n){function r(r,t,e){var o=this;if("SHA-384"!==r&&"SHA-512"!==r)throw new Error(a);var f=e||{};return(o=n.call(this,r,t,e)||this).K=o.N,o.k=!0,o.F=-1,o.m=i(o.t,o.i,o.F),o.R=W,o.L=function(n){return n.slice()},o.B=Q,o.g=function(n,t,e,i){return function(n,r,t,e,i){for(var o,f=31+(r+129>>>10<<5),s=r+t;n.length<=f;)n.push(0);for(n[r>>>5]|=128<<24-r%32,n[f]=4294967295&s,n[f-1]=s/u|0,o=0;o<n.length;o+=32)e=W(n.slice(o,o+32),e);return"SHA-384"===i?[e[0].I,e[0].M,e[1].I,e[1].M,e[2].I,e[2].M,e[3].I,e[3].M,e[4].I,e[4].M,e[5].I,e[5].M]:[e[0].I,e[0].M,e[1].I,e[1].M,e[2].I,e[2].M,e[3].I,e[3].M,e[4].I,e[4].M,e[5].I,e[5].M,e[6].I,e[6].M,e[7].I,e[7].M]}(n,t,e,i,r)},o.U=Q(r),o.p=1024,o.T="SHA-384"===r?384:512,o.C=!1,f.hmacKey&&o.Y(A("hmacKey",f.hmacKey,o.F)),o}return b(r,n),r}(E),nn=[new M(0,1),new M(0,32898),new M(2147483648,32906),new M(2147483648,2147516416),new M(0,32907),new M(0,2147483649),new M(2147483648,2147516545),new M(2147483648,32777),new M(0,138),new M(0,136),new M(0,2147516425),new M(0,2147483658),new M(0,2147516555),new M(2147483648,139),new M(2147483648,32905),new M(2147483648,32771),new M(2147483648,32770),new M(2147483648,128),new M(0,32778),new M(2147483648,2147483658),new M(2147483648,2147516545),new M(2147483648,32896),new M(0,2147483649),new M(2147483648,2147516424)],rn=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];function tn(n){var r,t=[];for(r=0;r<5;r+=1)t[r]=[new M(0,0),new M(0,0),new M(0,0),new M(0,0),new M(0,0)];return t}function en(n){var r,t=[];for(r=0;r<5;r+=1)t[r]=n[r].slice();return t}function on(n,r){var t,e,i,o,u,f,s,w,a,h=[],c=[];if(null!==n)for(e=0;e<n.length;e+=2)r[(e>>>1)%5][(e>>>1)/5|0]=q(r[(e>>>1)%5][(e>>>1)/5|0],new M(n[e+1],n[e]));for(t=0;t<24;t+=1){for(o=tn(),e=0;e<5;e+=1)h[e]=(u=r[e][0],f=r[e][1],s=r[e][2],w=r[e][3],a=r[e][4],new M(u.I^f.I^s.I^w.I^a.I,u.M^f.M^s.M^w.M^a.M));for(e=0;e<5;e+=1)c[e]=q(h[(e+4)%5],X(h[(e+1)%5],1));for(e=0;e<5;e+=1)for(i=0;i<5;i+=1)r[e][i]=q(r[e][i],c[e]);for(e=0;e<5;e+=1)for(i=0;i<5;i+=1)o[i][(2*e+3*i)%5]=X(r[e][i],rn[e][i]);for(e=0;e<5;e+=1)for(i=0;i<5;i+=1)r[e][i]=q(o[e][i],new M(~o[(e+1)%5][i].I&o[(e+2)%5][i].I,~o[(e+1)%5][i].M&o[(e+2)%5][i].M));r[0][0]=q(r[0][0],nn[t])}return r}function un(n){var r,t,e=0,i=[0,0],o=[4294967295&n,n/u&2097151];for(r=6;r>=0;r--)0===(t=o[r>>2]>>>8*r&255)&&0===e||(i[e+1>>2]|=t<<8*(e+1),e+=1);return e=0!==e?e:1,i[0]|=e,{value:e+1>4?i:[i[0]],binLen:8+8*e}}function fn(n){return c(un(n.binLen),n)}function sn(n,r){var t,e=un(r),i=r>>>2,o=(i-(e=c(e,n)).value.length%i)%i;for(t=0;t<o;t++)e.value.push(0);return e.value}var wn=function(n){function r(r,t,e){var o=this,u=6,f=0,s=e||{};if(1!==(o=n.call(this,r,t,e)||this).numRounds){if(s.kmacKey||s.hmacKey)throw new Error(h);if("CSHAKE128"===o.o||"CSHAKE256"===o.o)throw new Error("Cannot set numRounds for CSHAKE variants")}switch(o.F=1,o.m=i(o.t,o.i,o.F),o.R=on,o.L=en,o.B=tn,o.U=tn(),o.C=!1,r){case"SHA3-224":o.p=f=1152,o.T=224,o.k=!0,o.K=o.N;break;case"SHA3-256":o.p=f=1088,o.T=256,o.k=!0,o.K=o.N;break;case"SHA3-384":o.p=f=832,o.T=384,o.k=!0,o.K=o.N;break;case"SHA3-512":o.p=f=576,o.T=512,o.k=!0,o.K=o.N;break;case"SHAKE128":u=31,o.p=f=1344,o.T=-1,o.C=!0,o.k=!1,o.K=null;break;case"SHAKE256":u=31,o.p=f=1088,o.T=-1,o.C=!0,o.k=!1,o.K=null;break;case"KMAC128":u=4,o.p=f=1344,o.X(e),o.T=-1,o.C=!0,o.k=!1,o.K=o.O;break;case"KMAC256":u=4,o.p=f=1088,o.X(e),o.T=-1,o.C=!0,o.k=!1,o.K=o.O;break;case"CSHAKE128":o.p=f=1344,u=o.j(e),o.T=-1,o.C=!0,o.k=!1,o.K=null;break;case"CSHAKE256":o.p=f=1088,u=o.j(e),o.T=-1,o.C=!0,o.k=!1,o.K=null;break;default:throw new Error(a)}return o.g=function(n,r,t,e,i){return function(n,r,t,e,i,o,u){var f,s,w=0,a=[],h=i>>>5,c=r>>>5;for(f=0;f<c&&r>=i;f+=h)e=on(n.slice(f,f+h),e),r-=i;for(n=n.slice(f),r%=i;n.length<h;)n.push(0);for(n[(f=r>>>3)>>2]^=o<<f%4*8,n[h-1]^=2147483648,e=on(n,e);32*a.length<u&&(s=e[w%5][w/5|0],a.push(s.M),!(32*a.length>=u));)a.push(s.I),0==64*(w+=1)%i&&(on(null,e),w=0);return a}(n,r,0,e,f,u,i)},s.hmacKey&&o.Y(A("hmacKey",s.hmacKey,o.F)),o}return b(r,n),r.prototype.j=function(n,r){var t=function(n){var r=n||{};return{funcName:A("funcName",r.funcName,1,{value:[],binLen:0}),customization:A("Customization",r.customization,1,{value:[],binLen:0})}}(n||{});r&&(t.funcName=r);var e=c(fn(t.funcName),fn(t.customization));if(0!==t.customization.binLen||0!==t.funcName.binLen){for(var i=sn(e,this.p>>>3),o=0;o<i.length;o+=this.p>>>5)this.U=this.R(i.slice(o,o+(this.p>>>5)),this.U),this.A+=this.p;return 4}return 31},r.prototype.X=function(n){var r=function(n){var r=n||{};return{kmacKey:A("kmacKey",r.kmacKey,1),funcName:{value:[1128353099],binLen:32},customization:A("Customization",r.customization,1,{value:[],binLen:0})}}(n||{});this.j(n,r.funcName);for(var t=sn(fn(r.kmacKey),this.p>>>3),e=0;e<t.length;e+=this.p>>>5)this.U=this.R(t.slice(e,e+(this.p>>>5)),this.U),this.A+=this.p;this.l=!0},r.prototype.O=function(n){var r=c({value:this.u.slice(),binLen:this.h},function(n){var r,t,e=0,i=[0,0],o=[4294967295&n,n/u&2097151];for(r=6;r>=0;r--)0==(t=o[r>>2]>>>8*r&255)&&0===e||(i[e>>2]|=t<<8*e,e+=1);return i[(e=0!==e?e:1)>>2]|=e<<8*e,{value:e+1>4?i:[i[0]],binLen:8+8*e}}(n.outputLen));return this.g(r.value,r.binLen,this.A,this.L(this.U),n.outputLen)},r}(E);return function(){function n(n,r,t){if("SHA-1"==n)this._=new k(n,r,t);else if("SHA-224"==n||"SHA-256"==n)this._=new I(n,r,t);else if("SHA-384"==n||"SHA-512"==n)this._=new $(n,r,t);else{if("SHA3-224"!=n&&"SHA3-256"!=n&&"SHA3-384"!=n&&"SHA3-512"!=n&&"SHAKE128"!=n&&"SHAKE256"!=n&&"CSHAKE128"!=n&&"CSHAKE256"!=n&&"KMAC128"!=n&&"KMAC256"!=n)throw new Error(a);this._=new wn(n,r,t)}}return n.prototype.update=function(n){return this._.update(n),this},n.prototype.getHash=function(n,r){return this._.getHash(n,r)},n.prototype.setHMACKey=function(n,r,t){this._.setHMACKey(n,r,t)},n.prototype.getHMAC=function(n,r){return this._.getHMAC(n,r)},n}()}));
//# sourceMappingURL=sha.js.map

// jsSHA256.
!function(r,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):(r="undefined"!=typeof globalThis?globalThis:r||self).jsSHA=t()}(this,(function(){"use strict";var r=function(t,n){return r=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(r,t){r.__proto__=t}||function(r,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(r[n]=t[n])},r(t,n)};"function"==typeof SuppressedError&&SuppressedError;var t="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",n="ARRAYBUFFER not supported by this environment",i="UINT8ARRAY not supported by this environment";function e(r,t,n,i){var e,o,u,s=t||[0],f=(n=n||0)>>>3,h=-1===i?3:0;for(e=0;e<r.length;e+=1)o=(u=e+f)>>>2,s.length<=o&&s.push(0),s[o]|=r[e]<<8*(h+i*(u%4));return{value:s,binLen:8*r.length+n}}function o(r,o,u){switch(o){case"UTF8":case"UTF16BE":case"UTF16LE":break;default:throw new Error("encoding must be UTF8, UTF16BE, or UTF16LE")}switch(r){case"HEX":return function(r,t,n){return function(r,t,n,i){var e,o,u,s;if(0!=r.length%2)throw new Error("String of HEX type must be in byte increments");var f=t||[0],h=(n=n||0)>>>3,a=-1===i?3:0;for(e=0;e<r.length;e+=2){if(o=parseInt(r.substr(e,2),16),isNaN(o))throw new Error("String of HEX type contains invalid characters");for(u=(s=(e>>>1)+h)>>>2;f.length<=u;)f.push(0);f[u]|=o<<8*(a+i*(s%4))}return{value:f,binLen:4*r.length+n}}(r,t,n,u)};case"TEXT":return function(r,t,n){return function(r,t,n,i,e){var o,u,s,f,h,a,c,w,E=0,v=n||[0],l=(i=i||0)>>>3;if("UTF8"===t)for(c=-1===e?3:0,s=0;s<r.length;s+=1)for(u=[],128>(o=r.charCodeAt(s))?u.push(o):2048>o?(u.push(192|o>>>6),u.push(128|63&o)):55296>o||57344<=o?u.push(224|o>>>12,128|o>>>6&63,128|63&o):(s+=1,o=65536+((1023&o)<<10|1023&r.charCodeAt(s)),u.push(240|o>>>18,128|o>>>12&63,128|o>>>6&63,128|63&o)),f=0;f<u.length;f+=1){for(h=(a=E+l)>>>2;v.length<=h;)v.push(0);v[h]|=u[f]<<8*(c+e*(a%4)),E+=1}else for(c=-1===e?2:0,w="UTF16LE"===t&&1!==e||"UTF16LE"!==t&&1===e,s=0;s<r.length;s+=1){for(o=r.charCodeAt(s),!0===w&&(o=(f=255&o)<<8|o>>>8),h=(a=E+l)>>>2;v.length<=h;)v.push(0);v[h]|=o<<8*(c+e*(a%4)),E+=2}return{value:v,binLen:8*E+i}}(r,o,t,n,u)};case"B64":return function(r,n,i){return function(r,n,i,e){var o,u,s,f,h,a,c=0,w=n||[0],E=(i=i||0)>>>3,v=-1===e?3:0,l=r.indexOf("=");if(-1===r.search(/^[a-zA-Z0-9=+/]+$/))throw new Error("Invalid character in base-64 string");if(r=r.replace(/=/g,""),-1!==l&&l<r.length)throw new Error("Invalid '=' found in base-64 string");for(o=0;o<r.length;o+=4){for(f=r.substr(o,4),s=0,u=0;u<f.length;u+=1)s|=t.indexOf(f.charAt(u))<<18-6*u;for(u=0;u<f.length-1;u+=1){for(h=(a=c+E)>>>2;w.length<=h;)w.push(0);w[h]|=(s>>>16-8*u&255)<<8*(v+e*(a%4)),c+=1}}return{value:w,binLen:8*c+i}}(r,n,i,u)};case"BYTES":return function(r,t,n){return function(r,t,n,i){var e,o,u,s,f=t||[0],h=(n=n||0)>>>3,a=-1===i?3:0;for(o=0;o<r.length;o+=1)e=r.charCodeAt(o),u=(s=o+h)>>>2,f.length<=u&&f.push(0),f[u]|=e<<8*(a+i*(s%4));return{value:f,binLen:8*r.length+n}}(r,t,n,u)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(r){throw new Error(n)}return function(r,t,n){return function(r,t,n,i){return e(new Uint8Array(r),t,n,i)}(r,t,n,u)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(r){throw new Error(i)}return function(r,t,n){return e(r,t,n,u)};default:throw new Error("format must be HEX, TEXT, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}function u(r,e,o,u){switch(r){case"HEX":return function(r){return function(r,t,n,i){var e,o,u="0123456789abcdef",s="",f=t/8,h=-1===n?3:0;for(e=0;e<f;e+=1)o=r[e>>>2]>>>8*(h+n*(e%4)),s+=u.charAt(o>>>4&15)+u.charAt(15&o);return i.outputUpper?s.toUpperCase():s}(r,e,o,u)};case"B64":return function(r){return function(r,n,i,e){var o,u,s,f,h,a="",c=n/8,w=-1===i?3:0;for(o=0;o<c;o+=3)for(f=o+1<c?r[o+1>>>2]:0,h=o+2<c?r[o+2>>>2]:0,s=(r[o>>>2]>>>8*(w+i*(o%4))&255)<<16|(f>>>8*(w+i*((o+1)%4))&255)<<8|h>>>8*(w+i*((o+2)%4))&255,u=0;u<4;u+=1)a+=8*o+6*u<=n?t.charAt(s>>>6*(3-u)&63):e.b64Pad;return a}(r,e,o,u)};case"BYTES":return function(r){return function(r,t,n){var i,e,o="",u=t/8,s=-1===n?3:0;for(i=0;i<u;i+=1)e=r[i>>>2]>>>8*(s+n*(i%4))&255,o+=String.fromCharCode(e);return o}(r,e,o)};case"ARRAYBUFFER":try{new ArrayBuffer(0)}catch(r){throw new Error(n)}return function(r){return function(r,t,n){var i,e=t/8,o=new ArrayBuffer(e),u=new Uint8Array(o),s=-1===n?3:0;for(i=0;i<e;i+=1)u[i]=r[i>>>2]>>>8*(s+n*(i%4))&255;return o}(r,e,o)};case"UINT8ARRAY":try{new Uint8Array(0)}catch(r){throw new Error(i)}return function(r){return function(r,t,n){var i,e=t/8,o=-1===n?3:0,u=new Uint8Array(e);for(i=0;i<e;i+=1)u[i]=r[i>>>2]>>>8*(o+n*(i%4))&255;return u}(r,e,o)};default:throw new Error("format must be HEX, B64, BYTES, ARRAYBUFFER, or UINT8ARRAY")}}var s=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],f=[3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428],h=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];function a(r){var t={outputUpper:!1,b64Pad:"=",outputLen:-1},n=r||{},i="Output length must be a multiple of 8";if(t.outputUpper=n.outputUpper||!1,n.b64Pad&&(t.b64Pad=n.b64Pad),n.outputLen){if(n.outputLen%8!=0)throw new Error(i);t.outputLen=n.outputLen}else if(n.shakeLen){if(n.shakeLen%8!=0)throw new Error(i);t.outputLen=n.shakeLen}if("boolean"!=typeof t.outputUpper)throw new Error("Invalid outputUpper formatting option");if("string"!=typeof t.b64Pad)throw new Error("Invalid b64Pad formatting option");return t}function c(r,t){return r>>>t|r<<32-t}function w(r,t){return r>>>t}function E(r,t,n){return r&t^~r&n}function v(r,t,n){return r&t^r&n^t&n}function l(r){return c(r,2)^c(r,13)^c(r,22)}function p(r,t){var n=(65535&r)+(65535&t);return(65535&(r>>>16)+(t>>>16)+(n>>>16))<<16|65535&n}function A(r,t,n,i){var e=(65535&r)+(65535&t)+(65535&n)+(65535&i);return(65535&(r>>>16)+(t>>>16)+(n>>>16)+(i>>>16)+(e>>>16))<<16|65535&e}function d(r,t,n,i,e){var o=(65535&r)+(65535&t)+(65535&n)+(65535&i)+(65535&e);return(65535&(r>>>16)+(t>>>16)+(n>>>16)+(i>>>16)+(e>>>16)+(o>>>16))<<16|65535&o}function y(r){return c(r,7)^c(r,18)^w(r,3)}function U(r){return c(r,6)^c(r,11)^c(r,25)}function T(r){return"SHA-224"==r?f.slice():h.slice()}function b(r,t){var n,i,e,o,u,f,h,a,T,b,R,m,F=[];for(n=t[0],i=t[1],e=t[2],o=t[3],u=t[4],f=t[5],h=t[6],a=t[7],R=0;R<64;R+=1)F[R]=R<16?r[R]:A(c(m=F[R-2],17)^c(m,19)^w(m,10),F[R-7],y(F[R-15]),F[R-16]),T=d(a,U(u),E(u,f,h),s[R],F[R]),b=p(l(n),v(n,i,e)),a=h,h=f,f=u,u=p(o,T),o=e,e=i,i=n,n=p(T,b);return t[0]=p(n,t[0]),t[1]=p(i,t[1]),t[2]=p(e,t[2]),t[3]=p(o,t[3]),t[4]=p(u,t[4]),t[5]=p(f,t[5]),t[6]=p(h,t[6]),t[7]=p(a,t[7]),t}return function(t){function n(r,n,i){var e=this;if("SHA-224"!==r&&"SHA-256"!==r)throw new Error("Chosen SHA variant is not supported");var u=i||{};return(e=t.call(this,r,n,i)||this).t=e.i,e.o=!0,e.u=-1,e.h=o(e.v,e.l,e.u),e.p=b,e.A=function(r){return r.slice()},e.U=T,e.T=function(t,n,i,e){return function(r,t,n,i,e){for(var o,u=15+(t+65>>>9<<4),s=t+n;r.length<=u;)r.push(0);for(r[t>>>5]|=128<<24-t%32,r[u]=4294967295&s,r[u-1]=s/4294967296|0,o=0;o<r.length;o+=16)i=b(r.slice(o,o+16),i);return"SHA-224"===e?[i[0],i[1],i[2],i[3],i[4],i[5],i[6]]:i}(t,n,i,e,r)},e.R=T(r),e.m=512,e.F="SHA-224"===r?224:256,e.g=!1,u.hmacKey&&e.B(function(r,t,n,i){var e=r+" must include a value and format";if(!t){if(!i)throw new Error(e);return i}if(void 0===t.value||!t.format)throw new Error(e);return o(t.format,t.encoding||"UTF8",n)(t.value)}("hmacKey",u.hmacKey,e.u)),e}return function(t,n){if("function"!=typeof n&&null!==n)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");function i(){this.constructor=t}r(t,n),t.prototype=null===n?Object.create(n):(i.prototype=n.prototype,new i)}(n,t),n}(function(){function r(r,t,n){var i=n||{};if(this.v=t,this.l=i.encoding||"UTF8",this.numRounds=i.numRounds||1,isNaN(this.numRounds)||this.numRounds!==parseInt(this.numRounds,10)||1>this.numRounds)throw new Error("numRounds must a integer >= 1");this.S=r,this.H=[],this.Y=0,this.C=!1,this.I=0,this.L=!1,this.N=[],this.X=[]}return r.prototype.update=function(r){var t,n=0,i=this.m>>>5,e=this.h(r,this.H,this.Y),o=e.binLen,u=e.value,s=o>>>5;for(t=0;t<s;t+=i)n+this.m<=o&&(this.R=this.p(u.slice(t,t+i),this.R),n+=this.m);return this.I+=n,this.H=u.slice(n>>>5),this.Y=o%this.m,this.C=!0,this},r.prototype.getHash=function(r,t){var n,i,e=this.F,o=a(t);if(this.g){if(-1===o.outputLen)throw new Error("Output length must be specified in options");e=o.outputLen}var s=u(r,e,this.u,o);if(this.L&&this.t)return s(this.t(o));for(i=this.T(this.H.slice(),this.Y,this.I,this.A(this.R),e),n=1;n<this.numRounds;n+=1)this.g&&e%32!=0&&(i[i.length-1]&=16777215>>>24-e%32),i=this.T(i,e,0,this.U(this.S),e);return s(i)},r.prototype.setHMACKey=function(r,t,n){if(!this.o)throw new Error("Variant does not support HMAC");if(this.C)throw new Error("Cannot set MAC key after calling update");var i=o(t,(n||{}).encoding||"UTF8",this.u);this.B(i(r))},r.prototype.B=function(r){var t,n=this.m>>>3,i=n/4-1;if(1!==this.numRounds)throw new Error("Cannot set numRounds with MAC");if(this.L)throw new Error("MAC key already set");for(n<r.binLen/8&&(r.value=this.T(r.value,r.binLen,0,this.U(this.S),this.F));r.value.length<=i;)r.value.push(0);for(t=0;t<=i;t+=1)this.N[t]=909522486^r.value[t],this.X[t]=1549556828^r.value[t];this.R=this.p(this.N,this.R),this.I=this.m,this.L=!0},r.prototype.getHMAC=function(r,t){var n=a(t);return u(r,this.F,this.u,n)(this.i())},r.prototype.i=function(){var r;if(!this.L)throw new Error("Cannot call getHMAC without first setting MAC key");var t=this.T(this.H.slice(),this.Y,this.I,this.A(this.R),this.F);return r=this.p(this.X,this.U(this.S)),r=this.T(t,this.F,this.m,r,this.F)},r}())}));
