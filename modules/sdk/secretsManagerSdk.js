// AWS-SecretsManager接続(aws-sdk-v3).
// 最低限のシークレット取得(get)操作が利用できる.
//
// AIメモ:
// - Lambdaは同一実行環境(コンテナ)がリクエスト毎に再利用されるケースが
//   あるため、取得結果をモジュール内メモリにTTL付きキャッシュし、
//   同一コンテナ内での再取得コスト・API呼び出し回数を削減している.
// - キャッシュキーは secretId + region の組み合わせ.
// - シークレット作成/更新/削除はIaC(CloudFormation/CDK等)側の責務とみなし、
//   本モジュールでは対象外にしている.
//
(function () {
    'use strict';

    // SecretsManager-Client.
    const {
        SecretsManagerClient,
        GetSecretValueCommand
    } = require("@aws-sdk/client-secrets-manager")

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

    // リージョン毎のSecretsManagerClient.
    const _SECRETS_CLIENT = {};

    // SecretsManagerClientオブジェクトを取得.
    const _getSecretsClient = function (region, credentials) {
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
            if (_SECRETS_CLIENT[region] == undefined) {
                _SECRETS_CLIENT[region] = new SecretsManagerClient({
                    region: region
                });
            }
            return _SECRETS_CLIENT[region];
        }
        // SecretsManagerClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_SECRETS_CLIENT[key] == undefined) {
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
            _SECRETS_CLIENT[key] = new SecretsManagerClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _SECRETS_CLIENT[key];
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

    // 指定シークレットIDの値を取得(TTLキャッシュ付き).
    // secretId 対象のシークレットID(名前 or ARN)を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         ttl: キャッシュTTL(ミリ秒)を設定します(デフォルト: 60000=60秒).
    //              0を設定するとキャッシュを利用せず毎回APIを呼び出します.
    //         forceRefresh: true の場合キャッシュを無視して再取得します.
    // 戻り値: シークレット値(文字列、SecretString)が返却されます
    //         (取得できない場合はnull).
    exports.get = async function (secretId, options) {
        if (options == undefined) {
            options = {};
        }
        const region = options.region == undefined ? _DEF_REGION : options.region;
        const ttl = options.ttl == undefined ? _DEF_TTL_MS : parseInt(options.ttl);
        const cacheKey = secretId + "_" + region;
        const now = Date.now();
        // キャッシュ有効かつ強制再取得でない場合.
        if (options.forceRefresh != true && ttl > 0) {
            const cached = _CACHE[cacheKey];
            if (cached != undefined && cached.expireAt > now) {
                return cached.value;
            }
        }
        try {
            const res = await _getSecretsClient(options.region, options.credentials).send(
                new GetSecretValueCommand({
                    SecretId: secretId
                })
            )
            const value = res.SecretString != undefined ? res.SecretString : null;
            if (ttl > 0) {
                _CACHE[cacheKey] = {
                    value: value,
                    expireAt: now + ttl
                }
            }
            return value;
        } catch (e) {
            console.warn("[SECRETS.GET]secretId: " + secretId +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }
})();
