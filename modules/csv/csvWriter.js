///////////////////////////////////////////////
// Csv書き込み用オブジェクト.
///////////////////////////////////////////////
(function (global) {
    'use strict';

    // ヘッダーキーを作成.
    // headerKeyList ヘッダキー群(["key1", "key2", "key3"....])を設定します.
    // 戻り値: {"key1": 0, "key2": 1, "key3": 2 ....} のような形で返却されます.
    const createHeaderKeys = (headerKeyList) => {
        return headerKeyList.reduce((ret, key, index) => {
            ret[key] = index;
            return ret;
        }, {});
    };

    // 出力内容によっては ダブルクォーテーション を付与する.
    // parseCode CSV区切り文字を設定します.
    // value １つのColumnValueを設定します.
    // 戻り値: 変換されたColumnValueが返却されます.
    const outValue = (parseCode, value) => {
        if (value == null) { // null と undefined を同時にチェック
            return "";
        }

        let strValue = String(value);

        // ダブルクォーテーション、区切り文字、またはタブや改行が含まれている場合
        if (strValue.includes('"') || strValue.includes(parseCode) || strValue.includes('\t') ||
            strValue.includes('\n') || strValue.includes('\r')) {
            // ["] を [""] にエスケープする
            strValue = strValue.replace(/"/g, '""');
            // 前後にダブルクォーテーションをセット
            strValue = `"${strValue}"`;
        }

        return strValue;
    };

    // デフォルトのValue変換出力.
    // value 変換元のcolumnValueを設定します.
    // 戻り値: 文字列に変換された内容が返却されます.
    const defaultConvertFunc = (value) => {
        if (value == null) {
            return "";
        }
        const type = typeof value;
        if (type === "number" || type === "boolean" || type === "string") {
            return String(value);
        } else if (value instanceof Date) {
            return value.toString();
        }
        return JSON.stringify(value);
    };

    // CsvWriterを生成.
    // headers Csvヘッダ情報をArray形式で設定します.
    // options オプションを設定します.
    //   {parseCode: string} 区切り文字を設定します. (デフォルト: ",")
    //   {lineBreak: string} 改行文字を設定します. (デフォルト: "\n")
    //   {convertFunc: function} CsvWriter.putで渡されるvalueに対してカスタムな文字変換処理が行なえます.
    const createCsvWriter = (headers, options = {}) => {
        const parseCode = options.parseCode || ",";
        const convertFunc = typeof options.convertFunc === "function" ? options.convertFunc : defaultConvertFunc;
        const lineBreak = options.lineBreak || "\n"; // 改行コードもオプション化

        const headerLength = headers.length;
        const headerKeys = createHeaderKeys(headers);

        // 1行情報.
        const oneLine = new Array(headerLength);

        // Csv書き込み結果を保持する配列 (文字列結合より高速)
        let lines = [];
        let rowCount = 0;

        // ヘッダ書き込み.
        const _writeHeader = () => {
            const headerRow = headers.map(h => outValue(parseCode, h)).join(parseCode);
            lines.push(headerRow);
        };

        _writeHeader();

        /////////////////////////////////////////////////////
        // オブジェクト群.
        /////////////////////////////////////////////////////
        const ret = {};

        // 情報クリア.
        ret.clear = () => {
            lines = [];
            rowCount = 0;
            _writeHeader();
            oneLine.fill(undefined); // 配列の中身を一括クリア
        };

        // 書き込みCSV情報を取得.
        ret.getWriteCsv = () => {
            // 元の仕様に合わせて、最終行にも改行を付与する
            return lines.join(lineBreak) + lineBreak;
        };

        // 書き込みCSV情報を取得.
        ret.toString = () => {
            return ret.getWriteCsv();
        };

        // 現在の行情報を出力.
        ret.next = () => {
            const rowStr = oneLine.map(val => outValue(parseCode, val)).join(parseCode);
            lines.push(rowStr);
            oneLine.fill(undefined); // 次の行のためにクリア
            rowCount++;
            return ret;
        };

        // １つのカラム条件をセット.
        ret.put = (key, value) => {
            const no = headerKeys[key];
            if (no === undefined) {
                throw new Error(`Specified Column(${key}) does not exist.`);
            }
            oneLine[no] = convertFunc(value);
            return ret;
        };

        // 1つの行をセット.
        ret.putRow = function (values) {
            for (let k in values) {
                ret.put(k, values[k]);
            }
        }

        // 書き込み行数を取得.
        ret.count = () => rowCount;

        // ヘッダ一覧を取得 (参照渡しを防ぐためコピーを返す)
        ret.getHeaders = () => [...headers];

        // ヘッダサイズを取得.
        ret.getHeaderLength = () => headerLength;

        return ret;
    };

    // ========================================================
    // モジュールエクスポート
    // ========================================================
    // Node.js(CommonJS)環境とブラウザ環境の両方に対応
    if (typeof exports !== 'undefined') {
        exports.createCsvWriter = createCsvWriter;
    } else {
        global.csvWriter = { createCsvWriter };
    }

})(typeof window !== 'undefined' ? window : globalThis || this);