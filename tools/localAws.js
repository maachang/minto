///////////////////////////////////////////////
// (node専用)ローカルAWSエミュレータ(S3 + SQS).
//
// modules/s3table/s3sdk.js・modules/s3table/s3Lock.js が利用する
// @aws-sdk/client-s3(S3Client)、および modules/sdk/sqsSdk.js が
// 利用する @aws-sdk/client-sqs(SQSClient)の接続先(endpoint)を
// このサーバーに向けることで、実際のAWSへ接続せずにローカルで
// 動作確認ができるようにするもの.
//
// 本物のS3 REST APIの必要最小限(PutObject/GetObject/DeleteObject/
// ListObjectsV2、条件付き書き込みIf-None-Match)、および本物のSQS
// (AWS JSON 1.0 protocol)の必要最小限(SendMessage/ReceiveMessage/
// DeleteMessage)のみをサポートする。ローカル専用のためSigV4署名
// 検証は行わない.
//
// 利用側(s3sdk.js/s3Lock.js)は環境変数 MINTO_LOCAL_S3_ENDPOINT が、
// sqsSdk.js は環境変数 MINTO_LOCAL_SQS_ENDPOINT が設定されている
// 場合、自動的にこのサーバーをendpointとして利用する
// (S3側は forcePathStyle: true)。両方とも同じこのサーバー(同一
// ポート)を指定して問題ない(リクエストヘッダで種別を判定するため).
///////////////////////////////////////////////
(function () {
    'use strict';

    const http = require("http");
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const args = require("./args.js");

    // デフォルトバインドポート.
    const _DEF_PORT = 9911;

    // デフォルトストレージルートディレクトリ.
    const _DEF_ROOT = "./.localS3";

    // ListObjectsV2のデフォルトmaxKeys.
    const _DEF_MAX_KEYS = 1000;

    // 起動パラメータ取得(-p/--port, -d/--dir).
    const _port = args.getNumber("-p", "--port") || _DEF_PORT;
    const _root = path.resolve(args.get("-d", "--dir") || _DEF_ROOT);

    // XML特殊文字のエスケープ.
    const _escapeXml = function (s) {
        return ("" + s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    };

    // S3互換のエラーXMLを生成.
    const _errorXml = function (code, message) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<Error><Code>" + code + "</Code><Message>" +
            _escapeXml(message) + "</Message></Error>";
    };

    // URLパスを {bucket, key} に分解します.
    // 先頭・末尾の "/" を除去した上で、最初のセグメントをbucket、
    // 残りをkey(スラッシュ区切りのまま)として扱う.
    const _parsePath = function (pathname) {
        let p = decodeURIComponent(pathname);
        if (p.startsWith("/")) {
            p = p.substring(1);
        }
        const idx = p.indexOf("/");
        if (idx === -1) {
            return { bucket: p, key: "" };
        }
        return { bucket: p.substring(0, idx), key: p.substring(idx + 1) };
    };

    // bucket+keyから実ファイルパスを算出します(ディレクトリトラバーサル対策込み).
    const _resolveFilePath = function (bucket, key) {
        const bucketDir = path.join(_root, bucket);
        const target = path.join(bucketDir, key);
        if (target !== bucketDir && !target.startsWith(bucketDir + path.sep)) {
            throw new Error("Invalid key(path traversal): " + key);
        }
        return target;
    };

    // リクエストボディを読み込みBufferとして返却.
    const _readBody = function (req) {
        return new Promise(function (resolve, reject) {
            const chunks = [];
            req.on("data", function (chunk) {
                chunks.push(chunk);
            });
            req.on("end", function () {
                resolve(Buffer.concat(chunks));
            });
            req.on("error", reject);
        });
    };

    // ディレクトリ配下の全ファイルを相対パス(スラッシュ区切り)一覧で再帰取得.
    const _listAllFiles = function (dir, baseDir, ret) {
        ret = ret || [];
        if (!fs.existsSync(dir)) {
            return ret;
        }
        const names = fs.readdirSync(dir, { withFileTypes: true });
        const len = names.length;
        for (let i = 0; i < len; i++) {
            const full = path.join(dir, names[i].name);
            if (names[i].isDirectory()) {
                _listAllFiles(full, baseDir, ret);
            } else {
                ret.push(path.relative(baseDir, full).split(path.sep).join("/"));
            }
        }
        return ret;
    };

    // PutObject(条件付きIf-None-Match対応)処理.
    const _handlePut = async function (req, res, bucket, key) {
        const filePath = _resolveFilePath(bucket, key);
        if (req.headers["if-none-match"] === "*" && fs.existsSync(filePath)) {
            const body = _errorXml("PreconditionFailed",
                "At least one of the pre-conditions you specified did not hold.");
            res.writeHead(412, { "content-type": "application/xml" });
            res.end(body);
            return;
        }
        const body = await _readBody(req);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body);
        const etag = crypto.createHash("md5").update(body).digest("hex");
        res.writeHead(200, { "etag": "\"" + etag + "\"" });
        res.end();
    };

    // GetObject処理.
    const _handleGet = function (req, res, bucket, key) {
        const filePath = _resolveFilePath(bucket, key);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { "content-type": "application/xml" });
            res.end(_errorXml("NoSuchKey", "The specified key does not exist."));
            return;
        }
        const body = fs.readFileSync(filePath);
        const etag = crypto.createHash("md5").update(body).digest("hex");
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": body.length,
            "etag": "\"" + etag + "\"",
            "last-modified": stat.mtime.toUTCString()
        });
        res.end(body);
    };

    // DeleteObject処理(S3同様、存在しなくても成功扱い=冪等).
    const _handleDelete = function (req, res, bucket, key) {
        const filePath = _resolveFilePath(bucket, key);
        if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
            fs.unlinkSync(filePath);
        }
        res.writeHead(204);
        res.end();
    };

    // ListObjectsV2処理.
    const _handleList = function (req, res, bucket, query) {
        const bucketDir = path.join(_root, bucket);
        const prefix = query.get("prefix") || "";
        const delimiter = query.get("delimiter") || null;
        const maxKeys = parseInt(query.get("max-keys")) || _DEF_MAX_KEYS;
        const startAfter = query.get("start-after") || null;
        // continuation-tokenは前回応答のNextContinuationToken(=最後に返したkey)を
        // そのまま引き継ぐ簡易実装(本物のS3のような不透明トークンではない).
        const continuationToken = query.get("continuation-token") || null;
        const afterKey = continuationToken || startAfter;

        let allKeys = _listAllFiles(bucketDir, bucketDir)
            .filter(function (k) { return k.startsWith(prefix); })
            .sort();
        if (afterKey != null) {
            allKeys = allKeys.filter(function (k) { return k > afterKey; });
        }

        const contents = [];
        const commonPrefixes = [];
        const seenPrefixes = {};
        let truncated = false;
        const len = allKeys.length;
        for (let i = 0; i < len; i++) {
            if (contents.length + commonPrefixes.length >= maxKeys) {
                truncated = true;
                break;
            }
            const key = allKeys[i];
            if (delimiter != null) {
                const rest = key.substring(prefix.length);
                const dIdx = rest.indexOf(delimiter);
                if (dIdx !== -1) {
                    const cp = prefix + rest.substring(0, dIdx + delimiter.length);
                    if (!seenPrefixes[cp]) {
                        seenPrefixes[cp] = true;
                        commonPrefixes.push(cp);
                    }
                    continue;
                }
            }
            const filePath = path.join(bucketDir, key);
            const stat = fs.statSync(filePath);
            contents.push({ key: key, size: stat.size, mtime: stat.mtime });
        }

        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">" +
            "<Name>" + _escapeXml(bucket) + "</Name>" +
            "<Prefix>" + _escapeXml(prefix) + "</Prefix>" +
            "<KeyCount>" + (contents.length + commonPrefixes.length) + "</KeyCount>" +
            "<MaxKeys>" + maxKeys + "</MaxKeys>" +
            "<IsTruncated>" + (truncated ? "true" : "false") + "</IsTruncated>";
        const clen = contents.length;
        for (let i = 0; i < clen; i++) {
            const c = contents[i];
            xml += "<Contents><Key>" + _escapeXml(c.key) + "</Key>" +
                "<LastModified>" + c.mtime.toISOString() + "</LastModified>" +
                "<Size>" + c.size + "</Size>" +
                "<StorageClass>STANDARD</StorageClass></Contents>";
        }
        const plen = commonPrefixes.length;
        for (let i = 0; i < plen; i++) {
            xml += "<CommonPrefixes><Prefix>" + _escapeXml(commonPrefixes[i]) +
                "</Prefix></CommonPrefixes>";
        }
        if (truncated) {
            const lastKey = contents.length > 0 ?
                contents[contents.length - 1].key :
                commonPrefixes[commonPrefixes.length - 1];
            xml += "<NextContinuationToken>" + _escapeXml(lastKey) + "</NextContinuationToken>";
        }
        xml += "</ListBucketResult>";

        res.writeHead(200, { "content-type": "application/xml" });
        res.end(xml);
    };

    /////////////////////////
    // SQSエミュレーション.
    /////////////////////////

    // キュー名毎のメッセージ配列({ messageId, receiptHandle, body, visibleAt }).
    // visibleAtを過ぎるまでは受信済み(他のReceiveMessageからは見えない)扱い.
    const _sqsQueues = {};

    // デフォルトの可視性タイムアウト(秒).
    const _DEF_VISIBILITY_TIMEOUT = 30;

    // QueueUrlの末尾セグメントをキュー名として扱う.
    const _queueName = function (queueUrl) {
        const p = ("" + queueUrl).replace(/\/+$/, "");
        return p.substring(p.lastIndexOf("/") + 1);
    };

    // 指定キューを取得(未作成なら生成).
    const _getQueue = function (name) {
        if (_sqsQueues[name] == undefined) {
            _sqsQueues[name] = [];
        }
        return _sqsQueues[name];
    };

    // SendMessage処理.
    const _sqsSendMessage = function (input) {
        const name = _queueName(input.QueueUrl);
        const queue = _getQueue(name);
        const delaySeconds = input.DelaySeconds != undefined ? parseInt(input.DelaySeconds) : 0;
        const messageId = crypto.randomUUID();
        queue.push({
            messageId: messageId,
            receiptHandle: null,
            body: input.MessageBody,
            visibleAt: Date.now() + (delaySeconds * 1000)
        });
        return {
            MessageId: messageId,
            MD5OfMessageBody: crypto.createHash("md5").update("" + input.MessageBody).digest("hex")
        };
    };

    // ReceiveMessage処理.
    const _sqsReceiveMessage = function (input) {
        const name = _queueName(input.QueueUrl);
        const queue = _getQueue(name);
        const maxMessages = input.MaxNumberOfMessages != undefined ?
            parseInt(input.MaxNumberOfMessages) : 1;
        const visibilityTimeout = input.VisibilityTimeout != undefined ?
            parseInt(input.VisibilityTimeout) : _DEF_VISIBILITY_TIMEOUT;
        const now = Date.now();
        const messages = [];
        const len = queue.length;
        for (let i = 0; i < len && messages.length < maxMessages; i++) {
            const m = queue[i];
            if (m.visibleAt <= now) {
                // 受信の都度receiptHandleを発行し直す(実SQSと同様).
                m.receiptHandle = crypto.randomUUID();
                m.visibleAt = now + (visibilityTimeout * 1000);
                messages.push({
                    MessageId: m.messageId,
                    ReceiptHandle: m.receiptHandle,
                    Body: m.body,
                    MD5OfBody: crypto.createHash("md5").update("" + m.body).digest("hex")
                });
            }
        }
        return { Messages: messages };
    };

    // DeleteMessage処理.
    const _sqsDeleteMessage = function (input) {
        const name = _queueName(input.QueueUrl);
        const queue = _getQueue(name);
        const idx = queue.findIndex(function (m) { return m.receiptHandle === input.ReceiptHandle; });
        if (idx !== -1) {
            queue.splice(idx, 1);
        }
        return {};
    };

    // SQS(AWS JSON 1.0 protocol)リクエストの振り分け.
    // x-amz-targetヘッダ(例: "AmazonSQS.SendMessage")のアクション名で判定する.
    const _handleSqs = async function (req, res, action) {
        const body = await _readBody(req);
        const input = body.length > 0 ? JSON.parse(body.toString("utf8")) : {};
        let result;
        switch (action) {
            case "SendMessage":
                result = _sqsSendMessage(input);
                break;
            case "ReceiveMessage":
                result = _sqsReceiveMessage(input);
                break;
            case "DeleteMessage":
                result = _sqsDeleteMessage(input);
                break;
            default:
                res.writeHead(400, { "content-type": "application/x-amz-json-1.0" });
                res.end(JSON.stringify({ __type: "UnknownOperationException", message: action }));
                return;
        }
        res.writeHead(200, { "content-type": "application/x-amz-json-1.0" });
        res.end(JSON.stringify(result));
    };

    const _server = http.createServer(async function (req, res) {
        try {
            // SQS(AWS JSON 1.0 protocol)判定: x-amz-targetヘッダに"AmazonSQS."が
            // 付与されている場合はSQSリクエストとして扱う(S3のREST APIとは
            // 別プロトコルのため、同一サーバー・同一ポートでも共存できる).
            const amzTarget = req.headers["x-amz-target"];
            if (amzTarget != undefined && amzTarget.indexOf("AmazonSQS.") === 0) {
                await _handleSqs(req, res, amzTarget.substring("AmazonSQS.".length));
                return;
            }
            const url = new URL(req.url, "http://localhost");
            const { bucket, key } = _parsePath(url.pathname);
            if (bucket === "") {
                res.writeHead(400, { "content-type": "application/xml" });
                res.end(_errorXml("InvalidBucketName", "Bucket name is required."));
                return;
            }
            if (req.method === "GET" && url.searchParams.has("list-type")) {
                _handleList(req, res, bucket, url.searchParams);
                return;
            }
            switch (req.method) {
                case "PUT":
                    await _handlePut(req, res, bucket, key);
                    break;
                case "GET":
                    _handleGet(req, res, bucket, key);
                    break;
                case "DELETE":
                    _handleDelete(req, res, bucket, key);
                    break;
                default:
                    res.writeHead(405, { "content-type": "application/xml" });
                    res.end(_errorXml("MethodNotAllowed", "Method not allowed: " + req.method));
            }
        } catch (e) {
            console.error("[localAws] error", e);
            res.writeHead(500, { "content-type": "application/xml" });
            res.end(_errorXml("InternalError", "" + (e.message || e)));
        }
    });

    fs.mkdirSync(_root, { recursive: true });
    _server.listen(_port, function () {
        console.log("[localAws] listening on http://localhost:" + _port +
            " (storage root: " + _root + ", S3+SQS emulator)");
    });
})();
