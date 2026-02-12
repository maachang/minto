// ************************************************************
// lib/s3client.js
// S3操作 共通モジュール
// ************************************************************

(function () {
    'use strict';

    const { S3Client, GetObjectCommand, PutObjectCommand,
        DeleteObjectCommand, ListObjectsV2Command
    } = $require("@aws-sdk/client-s3");

    const _conf = $loadConf("app.json");
    const _BUCKET = _conf.s3Bucket;
    const _REGION = _conf.region || "ap-northeast-1";
    const _s3 = new S3Client({ region: _REGION });

    // StreamをStringに変換.
    const _streamToString = async function (stream) {
        // TypeError: not a function at _streamToString エラーになる
        // ので、恐らく llrt が この構文非対応の可能性がある.
        // ここの for await 部分を書き換える.
        /*const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString("utf-8");*/
        return await stream.transformToString("urf-8");
    };

    // S3からJSON取得.
    exports.getJson = async function (key) {
        try {
            const res = await _s3.send(new GetObjectCommand({
                Bucket: _BUCKET, Key: key
            }));
            const body = await _streamToString(res.Body);
            return JSON.parse(body);
        } catch (e) {
            if (e.name === "NoSuchKey" ||
                e.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw e;
        }
    };

    // S3にJSON保存.
    exports.putJson = async function (key, data) {
        await _s3.send(new PutObjectCommand({
            Bucket: _BUCKET, Key: key,
            Body: JSON.stringify(data),
            ContentType: "application/json"
        }));
    };

    // S3オブジェクト削除.
    exports.remove = async function (key) {
        try {
            await _s3.send(new DeleteObjectCommand({
                Bucket: _BUCKET, Key: key
            }));
        } catch (e) { }
    };

    // S3キー一覧取得.
    exports.listKeys = async function (prefix) {
        const keys = [];
        let token = undefined;
        do {
            const res = await _s3.send(new ListObjectsV2Command({
                Bucket: _BUCKET, Prefix: prefix,
                ContinuationToken: token
            }));
            if (res.Contents) {
                for (let i = 0; i < res.Contents.length; i++) {
                    keys.push(res.Contents[i].Key);
                }
            }
            token = res.IsTruncated
                ? res.NextContinuationToken : undefined;
        } while (token);
        return keys;
    };

    exports.getBucket = function () { return _BUCKET; };
})();
