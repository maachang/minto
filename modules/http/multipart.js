///////////////////////////////////////////////
// multipart/form-data パーサー.
//
// public/*.mt.js から呼び出して利用する. $request().body()で
// 取得した生Buffer + content-typeヘッダーのboundaryを使って
// パースし、テキストフィールドは文字列、ファイルフィールドは
// {filename, contentType, data(Buffer)} を持つオブジェクトに
// まとめて返却する.
//
// AIメモ:
// - 方針合意済みの割り切り仕様: サイズ上限チェックは行わない
//   (呼び出し側でContent-Length等を見て制御する前提)、および
//   同名フィールドが複数ファイルを持つケース(配列)には対応しない
//   (1フィールド1ファイル想定。同名パートが複数来た場合は最後の
//   ものが上書きで残る)。
// - $request().body()は常にBufferで生バイナリを返す(GET以外)。
//   これがそのままmultipartパーサーの入力になる.
// - 【重要な制約】AWS Lambda Function URLsは同期呼び出しのため、
//   リクエスト/レスポンスペイロードは各6MB制限(AWS公式ドキュメント
//   「Invocation payload (synchronous)」参照。デプロイパッケージの
//   50MB制限とは別物なので混同しないこと)。base64エンコード
//   (isBase64Encoded:true)時はオーバーヘッド(約+33%)を差し引くため、
//   本モジュールで実質扱えるファイルサイズは目安4.5MB程度が上限。
//   これを超える大きいファイルのアップロードには対応できないため、
//   S3署名付きURL(presigned URL)でクライアントから直接S3へ
//   アップロードする方式への切替を検討すること.
///////////////////////////////////////////////
(function () {
    'use strict';

    // content-typeヘッダーからboundaryを取得します.
    // 戻り値: boundary文字列。multipart/form-data以外、または
    //         boundary未指定の場合はnull.
    const _getBoundary = function (contentType) {
        if (contentType == null ||
            contentType.toLowerCase().indexOf("multipart/form-data") < 0) {
            return null;
        }
        const m = /boundary=(?:"([^"]*)"|([^;]+))/i.exec(contentType);
        if (m == null) {
            return null;
        }
        return (m[1] != null ? m[1] : m[2]).trim();
    };

    // "key=value" または key="value" 形式のパラメータを抽出します.
    // (Content-Dispositionのname/filename取得用).
    const _extractParam = function (value, key) {
        const re = new RegExp(key + '=(?:"([^"]*)"|([^;]+))', "i");
        const m = re.exec(value);
        if (m == null) {
            return null;
        }
        return (m[1] != null ? m[1] : m[2]).trim();
    };

    // ヘッダーテキスト(複数行)を {キー(小文字): 値} に変換します.
    const _parseHeaders = function (text) {
        const ret = {};
        const lines = text.split("\r\n");
        const len = lines.length;
        for (let i = 0; i < len; i++) {
            const line = lines[i];
            const pos = line.indexOf(":");
            if (pos < 0) {
                continue;
            }
            const key = line.substring(0, pos).trim().toLowerCase();
            const value = line.substring(pos + 1).trim();
            ret[key] = value;
        }
        return ret;
    };

    // 1パート(ヘッダー+本体)をパースして result にフィールドを追加します.
    const _parsePart = function (part, result) {
        const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd < 0) {
            return;
        }
        const headers = _parseHeaders(
            part.subarray(0, headerEnd).toString("utf-8"));
        const disposition = headers["content-disposition"];
        if (disposition == null) {
            return;
        }
        const name = _extractParam(disposition, "name");
        if (name == null) {
            return;
        }
        const data = part.subarray(headerEnd + 4);
        const filename = _extractParam(disposition, "filename");
        if (filename != null) {
            result[name] = {
                filename: filename,
                contentType: headers["content-type"] || "application/octet-stream",
                data: data
            };
        } else {
            result[name] = data.toString("utf-8");
        }
    };

    // bodyをboundaryで分割し、各パートをパースします.
    const _parseBody = function (body, boundary) {
        const result = {};
        const delim = Buffer.from("--" + boundary);
        let pos = body.indexOf(delim);
        if (pos < 0) {
            return result;
        }
        pos += delim.length;
        while (true) {
            // 終端境界("--boundary--")の判定.
            if (body[pos] === 0x2d && body[pos + 1] === 0x2d) {
                break;
            }
            // 境界直後のCRLFをスキップ.
            if (body[pos] === 0x0d && body[pos + 1] === 0x0a) {
                pos += 2;
            }
            const next = body.indexOf(delim, pos);
            if (next < 0) {
                break;
            }
            // 次の境界直前のCRLFはパート本体に含めない.
            let end = next;
            if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) {
                end -= 2;
            }
            _parsePart(body.subarray(pos, end), result);
            pos = next + delim.length;
        }
        return result;
    };

    // multipart/form-dataリクエストをパースします.
    // request $request()に相当するリクエスト情報を設定します.
    // 戻り値: {フィールド名: 文字列 または {filename, contentType, data}}
    //         のオブジェクト。multipart/form-data以外、またはboundary
    //         未指定の場合は空オブジェクト{}.
    exports.parse = function (request) {
        const boundary = _getBoundary(request.header("content-type"));
        if (boundary == null) {
            return {};
        }
        const body = request.body();
        if (body == null || body.length === 0) {
            return {};
        }
        return _parseBody(body, boundary);
    };
})();
