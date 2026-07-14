// AWS-DynamoDB接続(aws-sdk-v3).
// Document Client相当(marshall/unmarshall)で、通常のJSオブジェクトの
// まま入出力できる最低限のDynamoDB I/Oが利用できる.
//
// AIメモ:
// - update は UpdateExpression を自由に組み立てる汎用対応はせず、
//   patchオブジェクトのキー全てを "SET" するだけの単純対応にしている.
//   (attribute削除やADD/REMOVEなどが必要になった場合は都度拡張する)
// - query の keyConditionExpression / filterExpression はDynamoDBの
//   式構文をそのまま文字列で受け取り、expressionAttributeValuesの値
//   (プレースホルダ:xxxに対応する値)のみ内部でmarshallする.
//
(function () {
    'use strict';

    // DynamoDB-Client.
    const {
        DynamoDBClient,
        PutItemCommand,
        GetItemCommand,
        DeleteItemCommand,
        UpdateItemCommand,
        QueryCommand
    } = require("@aws-sdk/client-dynamodb")

    // JSオブジェクト <-> DynamoDB AttributeValue 変換.
    const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb")

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

    // リージョン毎のDynamoDBClient.
    const _DYNAMO_CLIENT = {};

    // DynamoDBClientオブジェクトを取得.
    const _getDynamoClient = function (region, credentials) {
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
            if (_DYNAMO_CLIENT[region] == undefined) {
                _DYNAMO_CLIENT[region] = new DynamoDBClient({
                    region: region
                });
            }
            return _DYNAMO_CLIENT[region];
        }
        // DynamoDBClientオブジェクトキャッシュキーを生成.
        const key = credentials["access_key"] + "_" + region;
        if (_DYNAMO_CLIENT[key] == undefined) {
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
            _DYNAMO_CLIENT[key] = new DynamoDBClient({
                region: region,
                credentials: setCredentials
            });
        }
        return _DYNAMO_CLIENT[key];
    }

    // options の内容を出力.
    const _strOptions = function (options) {
        let ret = "{";
        for (let k in options) {
            ret += k + ": " + options[k] + " ";
        }
        return ret + "}";
    }

    // 指定テーブルにitemを登録(全体上書き).
    // table 対象のテーブル名を設定します.
    // item 登録対象の内容(JSオブジェクト)を設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    exports.put = async function (table, item, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            await _getDynamoClient(options.region, options.credentials).send(
                new PutItemCommand({
                    TableName: table,
                    Item: marshall(item, { removeUndefinedValues: true })
                })
            )
            return true;
        } catch (e) {
            console.warn("[DYNAMO.PUT]table: " + table +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }

    // 指定テーブルからkeyに一致する1件を取得.
    // table 対象のテーブル名を設定します.
    // key 主キー(パーティションキー[+ソートキー])のJSオブジェクトを設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    // 戻り値: 対象内容のJSオブジェクトが返却されます(存在しない場合はnull).
    exports.get = async function (table, key, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            const res = await _getDynamoClient(options.region, options.credentials).send(
                new GetItemCommand({
                    TableName: table,
                    Key: marshall(key)
                })
            )
            if (res.Item == undefined) {
                return null;
            }
            return unmarshall(res.Item);
        } catch (e) {
            console.warn("[DYNAMO.GET]table: " + table +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return null;
        }
    }

    // 指定テーブルからkeyに一致する1件を削除.
    // table 対象のテーブル名を設定します.
    // key 主キー(パーティションキー[+ソートキー])のJSオブジェクトを設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    exports.delete = async function (table, key, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            await _getDynamoClient(options.region, options.credentials).send(
                new DeleteItemCommand({
                    TableName: table,
                    Key: marshall(key)
                })
            )
            return true;
        } catch (e) {
            console.warn("[DYNAMO.DELETE]table: " + table +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }

    // 指定テーブルのkeyに一致する1件に対し、patchのキーを全てSETする.
    // table 対象のテーブル名を設定します.
    // key 主キー(パーティションキー[+ソートキー])のJSオブジェクトを設定します.
    // patch SET対象のカラム名と値のJSオブジェクトを設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    exports.update = async function (table, key, patch, options) {
        if (options == undefined) {
            options = {};
        }
        try {
            const names = {};
            const values = {};
            const sets = [];
            let no = 0;
            for (let k in patch) {
                const n = "#k" + no;
                const v = ":v" + no;
                names[n] = k;
                values[v] = patch[k];
                sets.push(n + " = " + v);
                no++;
            }
            await _getDynamoClient(options.region, options.credentials).send(
                new UpdateItemCommand({
                    TableName: table,
                    Key: marshall(key),
                    UpdateExpression: "SET " + sets.join(", "),
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true })
                })
            )
            return true;
        } catch (e) {
            console.warn("[DYNAMO.UPDATE]table: " + table +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return false;
        }
    }

    // 指定テーブルに対しQueryを実行.
    // table 対象のテーブル名を設定します.
    // keyConditionExpression DynamoDBのKeyConditionExpression文字列を
    //                         設定します(例: "pk = :pk and begins_with(sk, :sk)").
    // expressionAttributeValues keyConditionExpression / filterExpression 内の
    //                            プレースホルダ(:xxx)に対応する値のJSオブジェクトを
    //                            設定します.
    // options 任意のオプションを設定します.
    //         noError: false の場合例外返却(デフォルト: true).
    //         region: 接続先リージョンを設定します(デフォルト: 東京).
    //         credentials: access_key, secret_access_key, session_token
    //                      などを設定します.
    //         indexName: 対象のセカンダリインデックス名を設定します.
    //         expressionAttributeNames: 属性名プレースホルダ(#xxx)を設定します.
    //         filterExpression: FilterExpression文字列を設定します.
    //         limit: 取得件数上限を設定します.
    //         scanIndexForward: false でソート順を降順にします(デフォルト: true).
    //         exclusiveStartKey: 前回取得結果の{lastEvaluatedKey}を設定する事で
    //                            続きから取得します.
    // 戻り値: { items: [...], count, lastEvaluatedKey } が返却されます.
    exports.query = async function (table, keyConditionExpression, expressionAttributeValues, options) {
        if (options == undefined) {
            options = {};
        }
        const input = {
            TableName: table,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeValues: marshall(expressionAttributeValues, { removeUndefinedValues: true })
        }
        if (options.indexName != undefined) {
            input["IndexName"] = options.indexName;
        }
        if (options.expressionAttributeNames != undefined) {
            input["ExpressionAttributeNames"] = options.expressionAttributeNames;
        }
        if (options.filterExpression != undefined) {
            input["FilterExpression"] = options.filterExpression;
        }
        if (options.limit != undefined) {
            input["Limit"] = parseInt(options.limit);
        }
        if (options.scanIndexForward != undefined) {
            input["ScanIndexForward"] = options.scanIndexForward;
        }
        if (options.exclusiveStartKey != undefined) {
            input["ExclusiveStartKey"] = marshall(options.exclusiveStartKey);
        }
        try {
            const res = await _getDynamoClient(options.region, options.credentials).send(
                new QueryCommand(input)
            )
            const items = (res.Items || []).map(function (v) {
                return unmarshall(v);
            });
            const ret = {
                items: items,
                count: res.Count
            };
            if (res.LastEvaluatedKey != undefined) {
                ret["lastEvaluatedKey"] = unmarshall(res.LastEvaluatedKey);
            }
            return ret;
        } catch (e) {
            console.warn("[DYNAMO.QUERY]table: " + table +
                " options: " + _strOptions(options), e);
            if (options.noError == false) {
                throw e;
            }
            return { items: [], count: 0 };
        }
    }
})();
