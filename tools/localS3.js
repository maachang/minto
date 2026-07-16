///////////////////////////////////////////////
// (node専用)ローカルS3エミュレータ.
//
// modules/s3table/s3sdk.js・modules/s3table/s3Lock.js が利用する
// @aws-sdk/client-s3(S3Client)の接続先(endpoint)をこのサーバーに
// 向けることで、実際のAWS S3へ接続せずにファイル/ディレクトリを
// バックエンドにしたローカル動作確認ができるようにするもの.
//
// 本物のS3 REST APIの必要最小限(PutObject/GetObject/DeleteObject/
// ListObjectsV2、条件付き書き込みIf-None-Match)のみをサポートする。
// ローカル専用のためSigV4署名検証は行わない.
//
// 利用側(s3sdk.js/s3Lock.js)は環境変数 MINTO_LOCAL_S3_ENDPOINT が
// 設定されている場合、自動的にこのサーバーをendpointとして利用する
// (forcePathStyle: true)。
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

    const _server = http.createServer(async function (req, res) {
        try {
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
            console.error("[localS3] error", e);
            res.writeHead(500, { "content-type": "application/xml" });
            res.end(_errorXml("InternalError", "" + (e.message || e)));
        }
    });

    fs.mkdirSync(_root, { recursive: true });
    _server.listen(_port, function () {
        console.log("[localS3] listening on http://localhost:" + _port +
            " (storage root: " + _root + ")");
    });
})();
