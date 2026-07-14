// AWS-SystemsManager ParameterStore接続(aws-sdk-v3).
// 最低限のパラメータ取得(get)操作が利用できる.
//
// AIメモ:
// - Lambdaは同一実行環境(コンテナ)がリクエスト毎に再利用されるケースが
//   あるため、取得結果をモジュール内メモリにTTL付きキャッシュし、
//   同一コンテナ内での再取得コスト・API呼び出し回数を削減している
//   (secretsManagerSdk.jsと同じ設計方針).
// - キャッシュキーは name + withDecryption + region の組み合わせ.
// - パラメータ作成/更新/削除はIaC(CloudFormation/CDK等)側の責務とみなし、
//   本モジュールでは対象外にしている.
//
(function () {
    'use strict';

    // SSM-Client.
    const {
        SSMClient,
        GetParameterCommand
    } = require("@aws-sdk/client-ssm")

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // キャッシュTTLのデフォルト値(ミリ秒): 60秒.
    const _DEF_TTL_MS = 60000;

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

    // リージョン毎のSSMClient.
    const _SSM_CLIENT = {};

    // SSMClientオブジェクトを取得.
    const _getSsmClient = function (region, credentials) {
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
            if (_SSM_CLIENT[region] == undefined) {
                _SSM_CLIENT[region] = new SSMClient({
                    region: region
                });
            }
            return _SSM_CLIENT[region];
        }
        // SSMClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_SSM_CLIENT[key] == undefined) {
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
            _SSM_CLIENT[key] = new SSMClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _SSM_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 取得結果のTTL付きキャッシュ: { key: { value, expireAt } }.
    const _CACHE = {};

    // 指定パラメータ名の値を取得(TTLキャッシュ付き).
    // name 対象のパラメータ名を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         withDecryption: true の場合SecureString型パラメータを復号して
    //                         取得します(デフォルト: false).
    //         ttl: キャッシュTTL(ミリ秒)を設定します(デフォルト: 60000=60秒).
    //              0を設定するとキャッシュを利用せず毎回APIを呼び出します.
    //         forceRefresh: true の場合キャッシュを無視して再取得します.
    // 戻り値: パラメータ値(文字列)が返却されます(取得できない場合はnull).
    exports.get = async function (name, options) {
        if (options == undefined) {
            options = {};
        }
        const region = options.region == undefined ? _DEF_REGION : options.region;
        const withDecryption = options.withDecryption == true;
        const ttl = options.ttl == undefined ? _DEF_TTL_MS : parseInt(options.ttl);
        const cacheKey = name + "_" + withDecryption + "_" + region;
        const now = Date.now();
        // キャッシュ有効かつ強制再取得でない場合.
        if (options.forceRefresh != true && ttl > 0) {
            const cached = _CACHE[cacheKey];
            if (cached != undefined && cached.expireAt > now) {
                return cached.value;
            }
        }
        try {
            const res = await _getSsmClient(options.region, options.credentials).send(
                new GetParameterCommand({
                    Name: name,
                    WithDecryption: withDecryption
                })
            )
            const value = res.Parameter != undefined ? res.Parameter.Value : null;
            if (ttl > 0) {
                _CACHE[cacheKey] = {
                    value: value,
                    expireAt: now + ttl
                }
            }
            return value;
        } catch (e) {
            console.warn("[SSM.GET]name: " + name +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }
})();
