// AWS-KMS接続(aws-sdk-v3).
// エンベロープ暗号化によるencrypt/decryptが利用できる.
//
// AIメモ:
// - KMSのEncrypt/Decrypt APIを直接使う方式は対象データが最大4096バイトまで
//   という制限があり、s3IndexTable.js/s3MasterTable.jsの行データ(json型カラム
//   など可変長データ)には不向きなため、エンベロープ暗号化方式を採用している.
//   (1) GenerateDataKeyでデータキー(平文+KMSによる暗号化済みブロブ)を取得.
//   (2) 平文データキーでローカルにAES-256-GCM暗号化(データ本体はKMSに送らない).
//   (3) 暗号化済みデータキーのみを暗号文と一緒に保存し、復号時はDecryptで
//       データキーを復元してからローカル復号する.
// - llrtのnode:cryptoはcreateCipheriv/createDecipherivを未サポートのため、
//   ローカルのAES-256-GCM暗号化/復号には globalThis.crypto.subtle(WebCrypto)
//   を利用している(node:cryptoのrandomBytes等ではなくWebCrypto系で統一).
// - WebCryptoのAES-GCM暗号化結果は「暗号文+認証タグ(16Byte)」が1つの
//   ArrayBufferとして連結返却されるため、authTagを別項目として持たず
//   ciphertextにそのまま含めている.
//
(function () {
    'use strict';

    // KMS-Client.
    const {
        KMSClient,
        GenerateDataKeyCommand,
        DecryptCommand
    } = require("@aws-sdk/client-kms")

    // 基本リージョン.
    const _DEF_REGION = "ap-northeast-1";

    // AESのIV長(GCM推奨: 12Byte).
    const _IV_LEN = 12;

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

    // リージョン毎のKMSClient.
    const _KMS_CLIENT = {};

    // KMSClientオブジェクトを取得.
    const _getKmsClient = function (region, credentials) {
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
            if (_KMS_CLIENT[region] == undefined) {
                _KMS_CLIENT[region] = new KMSClient({
                    region: region
                });
            }
            return _KMS_CLIENT[region];
        }
        // KMSClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_KMS_CLIENT[key] == undefined) {
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
            _KMS_CLIENT[key] = new KMSClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _KMS_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 平文データキーをWebCryptoのCryptoKeyにimport.
    const _importAesKey = async function (rawKey, usage) {
        return await globalThis.crypto.subtle.importKey(
            "raw", rawKey, { name: "AES-GCM" }, false, [usage]
        );
    }

    // 指定KMSキーで対象データをエンベロープ暗号化.
    // keyId 対象のKMSキーID(キーARN/エイリアス可)を設定します.
    // plaintext 暗号化対象の文字列を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         encryptionContext: KMSの暗号化コンテキスト(文字列連想配列)を
    //                            設定します(decrypt時にも同じ内容が必要).
    // 戻り値: { keyId, encryptedDataKey, iv, ciphertext }(いずれもbase64文字列)
    //         が返却されます(失敗時はnull).
    exports.encrypt = async function (keyId, plaintext, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            const client = _getKmsClient(options.region, options.credentials);
            const genRes = await client.send(
                new GenerateDataKeyCommand({
                    KeyId: keyId,
                    KeySpec: "AES_256",
                    EncryptionContext: options.encryptionContext
                })
            )
            const rawKey = genRes.Plaintext;
            const aesKey = await _importAesKey(rawKey, "encrypt");
            const iv = globalThis.crypto.getRandomValues(new Uint8Array(_IV_LEN));
            const plainBuf = Buffer.from(String(plaintext), "utf-8");
            const cipherBuf = await globalThis.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv }, aesKey, plainBuf
            );
            return {
                keyId: keyId,
                encryptedDataKey: Buffer.from(genRes.CiphertextBlob).toString("base64"),
                iv: Buffer.from(iv).toString("base64"),
                ciphertext: Buffer.from(cipherBuf).toString("base64")
            };
        } catch (e) {
            console.warn("[KMS.ENCRYPT]keyId: " + keyId +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }

    // encryptで暗号化した内容を復号.
    // encrypted encryptが返却した{ keyId, encryptedDataKey, iv, ciphertext }を
    //           設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         encryptionContext: encrypt時に設定したものと同じ内容を設定します.
    // 戻り値: 復号された平文文字列が返却されます(失敗時はnull).
    exports.decrypt = async function (encrypted, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            const client = _getKmsClient(options.region, options.credentials);
            const decRes = await client.send(
                new DecryptCommand({
                    CiphertextBlob: Buffer.from(encrypted.encryptedDataKey, "base64"),
                    KeyId: encrypted.keyId,
                    EncryptionContext: options.encryptionContext
                })
            )
            const rawKey = decRes.Plaintext;
            const aesKey = await _importAesKey(rawKey, "decrypt");
            const iv = Buffer.from(encrypted.iv, "base64");
            const cipherBuf = Buffer.from(encrypted.ciphertext, "base64");
            const plainBuf = await globalThis.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv }, aesKey, cipherBuf
            );
            return Buffer.from(plainBuf).toString("utf-8");
        } catch (e) {
            console.warn("[KMS.DECRYPT]keyId: " + encrypted.keyId +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }
})();
