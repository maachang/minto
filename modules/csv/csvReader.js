///////////////////////////////////////////////
// Csv読み込み用オブジェクト.
///////////////////////////////////////////////
(function (global) {
    "use strict";

    // 行単位でCsv読み込み文字列を分解.
    const parseEnter = function (s, pc) {
        let n;
        let b = 0;
        let inQuote = false;

        // Windowsなどの改行コード(\r\n, \r)を \n に統一して正規化
        s = s.replace(/\r\n|\r/g, "\n").trim() + "\n";

        const len = s.length;
        const ret = [];

        for (let i = 0; i < len; i++) {
            n = s[i];

            if (inQuote) {
                if (n === '"') {
                    // "" はエスケープなのでスキップしてクォート状態を維持
                    if (i + 1 < len && s[i + 1] === '"') {
                        i++;
                    } else {
                        inQuote = false;
                    }
                }
                // クォート内では改行・区切り文字を分割対象にしない
            } else {
                if (n === '"') {
                    inQuote = true;
                } else if (n === "\n") {
                    ret.push(s.substring(b, i + 1).trim() + pc);
                    b = i + 1;
                }
            }
        }
        return ret;
    };

    // 文字列を置き換える.
    const changeString = function (base, src, dest) {
        base = String(base);
        return base.split(src).join(dest);
    };

    // 行単位でCsv読み込み文字列をパース.
    const parseCsv = function (rawString, parseCode) {
        if (parseCode === undefined) {
            parseCode = ",";
        }
        rawString = rawString.trim();
        const len = rawString.length;
        const ret = [];
        let b = 0;
        let inQuote = false;

        for (let i = 0; i < len; i++) {
            const n = rawString[i];

            if (inQuote) {
                if (n === '"') {
                    // "" はエスケープなのでスキップしてクォート状態を維持
                    if (i + 1 < len && rawString[i + 1] === '"') {
                        i++;
                    } else {
                        inQuote = false;
                    }
                }
                // クォート内では区切り文字を分割対象にしない
            } else {
                if (n === '"') {
                    inQuote = true;
                } else if (n === parseCode) {
                    let m = rawString.substring(b, i).trim();
                    // クォーテーションで囲まれている場合は外して "" → " に変換
                    if (m.startsWith('"') && m.endsWith('"')) {
                        m = m.substring(1, m.length - 1);
                        m = changeString(m, '""', '"');
                    }
                    ret.push(m);
                    b = i + 1;
                }
            }
        }

        // 最後のセルを取得
        const last = rawString.substring(b, len).trim();
        if (last.length > 0 || rawString.endsWith(parseCode)) {
            let m = last;
            if (m.startsWith('"') && m.endsWith('"')) {
                m = m.substring(1, m.length - 1);
                m = changeString(m, '""', '"');
            }
            ret.push(m);
        }

        return ret;
    };

    // ヘッダーキーを作成.
    const createHeaderKeys = function (out, headerKeyList) {
        const len = headerKeyList.length;
        for (let i = 0; i < len; i++) {
            out[headerKeyList[i]] = i;
        }
    };

    // デフォルトのColumnタイプ単位の変換処理を行う.
    const defaultConvertFunc = function (type, value) {
        switch (type) {
            case "number":
                return parseFloat(value);
            case "string":
                return String(value);
            case "boolean":
                value = String(value).trim().toLowerCase();
                return value === "true" || value === "on" || value === "t";
            case "date":
                return new Date(String(value).trim());
        }
        try {
            return JSON.parse(String(value).trim());
        } catch (e) {
            return String(value);
        }
    };

    // CsvRowを生成.
    const createCsvRow = function (columnHeader, convertFunc) {
        let list = null;

        if (typeof convertFunc !== "function") {
            convertFunc = defaultConvertFunc;
        }

        const _get = function (n) {
            let ret;
            if (typeof n === "number") {
                ret = list[n];
            } else {
                let keyNo = columnHeader[String(n)];
                if (keyNo === undefined) {
                    return undefined;
                }
                ret = list[keyNo];
            }
            return ret;
        };

        const ret = {};

        ret.next = function (c) {
            list = c;
            return ret;
        };

        ret.contains = function (name) {
            return _get(name) !== undefined;
        };

        ret.getString = function (name) {
            let val = _get(name);
            return val === undefined ? undefined : convertFunc("string", val);
        };

        ret.getNumber = function (name) {
            let val = _get(name);
            return val === undefined ? undefined : convertFunc("number", val);
        };

        ret.getBoolean = function (name) {
            let val = _get(name);
            return val === undefined ? undefined : convertFunc("boolean", val);
        };

        ret.getDate = function (name) {
            let val = _get(name);
            return val === undefined ? undefined : convertFunc("date", val);
        };

        ret.getJSON = function (name) {
            let val = _get(name);
            return val === undefined ? undefined : convertFunc("json", val);
        };

        ret.length = function () {
            return list ? list.length : 0;
        };

        ret.toJSON = function () {
            const out = {};
            for (let k in columnHeader) {
                out[k] = _get(k);
            }
            return out;
        };

        return ret;
    };

    // CsvReaderを生成.
    const createCsvReader = function (csvString, options) {
        let parseCode = ",";
        let convertFunc = undefined;
        let defaultHeaderKeyArray = undefined;
        let jsIterator = false;

        if (options != null) {
            if (options.parseCode !== undefined) parseCode = options.parseCode;
            if (options.convertFunc !== undefined)
                convertFunc = options.convertFunc;
            if (options.headerKeyArray !== undefined)
                defaultHeaderKeyArray = options.headerKeyArray;
            if (options.jsIterator !== undefined)
                jsIterator = options.jsIterator === true;
        }

        let nowLine = 0;
        let resetLine = 0;
        let headerKeys = {};

        const srcCsv = parseEnter(csvString, parseCode);
        let headers = null;

        if (Array.isArray(defaultHeaderKeyArray)) {
            headers = defaultHeaderKeyArray;
            createHeaderKeys(headerKeys, headers);
        } else if (srcCsv.length > 0) {
            headers = parseCsv(srcCsv[0], parseCode);
            createHeaderKeys(headerKeys, headers);
            nowLine = 1;
            resetLine = 1;
        } else {
            headers = [];
        }

        const csvRow = createCsvRow(headerKeys, convertFunc);
        headerKeys = null;

        const ret = {};

        if (jsIterator) {
            ret.next = function () {
                if (nowLine >= srcCsv.length) {
                    return { value: null, done: true };
                }
                return {
                    value: csvRow.next(parseCsv(srcCsv[nowLine++], parseCode)),
                    done: false,
                };
            };
        } else {
            ret.hasNext = function () {
                return nowLine < srcCsv.length;
            };
            ret.next = function () {
                if (nowLine >= srcCsv.length) {
                    throw new Error("CsvReader: Reading past EOF.");
                }
                return csvRow.next(parseCsv(srcCsv[nowLine++], parseCode));
            };
        }

        ret.isJsIterator = function () {
            return jsIterator;
        };

        ret.resetPosition = function () {
            nowLine = resetLine;
            return ret;
        };

        ret.getHeaders = function () {
            return headers;
        };

        return ret;
    };

    // csv文字列からcsv情報(json)を取得.
    const readCsv = function (value, options) {
        if (options !== undefined && options.jsIterator === true) {
            options.jsIterator = false;
        }
        const csv = createCsvReader(value, options);
        const ret = [];

        while (csv.hasNext()) {
            ret.push(csv.next().toJSON());
        }

        return {
            headers: csv.getHeaders(),
            rows: ret,
        };
    };

    // ========================================================
    // モジュールエクスポート
    // ========================================================
    // Node.js(CommonJS)環境とブラウザ環境の両方に対応
    if (typeof exports !== "undefined") {
        exports.createCsvReader = createCsvReader;
        exports.readCsv = readCsv;
    } else {
        global.CsvReader = { createCsvReader, readCsv };
    }
})(typeof window !== "undefined" ? window : globalThis || this);
