/**
 * メモリテーブルオブジェクト
 * 指定されたグローバルオブジェクトに対して `memoryTable` 関数を公開.
 */
(function (global) {
    "use strict"; // 潜在的なエラーを防ぐためStrictモードを有効化.

    // メモリーテーブル全体のデフォルトUTC（世界時間)定義.
    let _DEFAULT_UTC = false;

    /**
     * 空のテーブルデータを管理する内部オブジェクトを作成します。
     * @param {Object} table - 初期化対象のテーブルオブジェクトを設定.
     * @param {Array} columns - 対象のカラム名群（文字列の配列）
     */
    const _createTable = function (table, columns) {
        // [[columns, ...]] の形で引数設定がされている場合.
        if (columns.length == 1 && Array.isArray(columns[0])) {
            // [columns, ...] に変換.
            columns = columns[0];
        }
        const cms = Object.create(null);
        const len = columns.length;
        // カラム名をキー、そのインデックス番号（配列内の位置）を値としてハッシュマップを作成
        // 例: ['id', 'name'] -> { id: 0, name: 1 }
        for (let i = 0; i < len; i++) {
            columns[i] = columns[i].trim();
            cms[columns[i]] = i;
        }
        table["columns"] = cms; // カラム名とインデックスの対応表
        table["columnNames"] = columns; // カラム名群(Array).
        table["columnLength"] = len; // カラムの総数.
        table["columnTypes"] = null; // カラムタイプ群(Array).
        table["rows"] = []; // 実際のデータ（行）を格納する2次元配列
        table["indexs"] = Object.create(null); // インデックス情報を格納するオブジェクト
        table["utc"] = _DEFAULT_UTC; // 日付変換でUTC出力の場合 true.
    };

    /**
     * カラム名変更.
     * カラム名変更をおこなった場合、対象のインデックス名も変更されます.
     * @param {object} table - 対象のテーブル内部データ
     * @param {object} changeNames {変更元カラム名: 変更先カラム名, ... }
     *                             この条件を設定します.
     */
    const _changeColumnsName = function (table, changeNames) {
        let k, cnt, em;
        const cms = table.columns;
        // changeNamesが元のカラム名に存在しない場合はエラーとする.
        for (k in changeNames) {
            if (cms[k] === undefined) {
                return false;
            }
        }
        // 変更処理.
        const newCms = Object.create(null);
        // changeNamesの変更対象カラムを追加.
        for (k in changeNames) {
            newCms[changeNames[k]] = cms[k];
        }
        // 変更しないカラムを追加.
        for (k in cms) {
            if (changeNames[k] === undefined) {
                newCms[k] = cms[k];
            }
        }
        // 変更前と変更後が同じ数のカラムか確認.
        // これが一致しない場合は、changeNamesと変更しない
        // カラム名がバッティングしている可能性がある.
        cnt = 0;
        for (k in newCms) {
            cnt++;
        }
        if (cnt != table.columnLength) {
            return false;
        }
        // 次にインデックス名を置き換える.
        const srcIndex = table.indexs;
        const newIndexs = Object.create(null);
        // changeNamesの変更対象カラムを追加.
        for (k in changeNames) {
            if ((em = srcIndex[k]) !== undefined) {
                newIndexs[changeNames[k]] = em;
            }
        }
        // 変更しないカラムを追加.
        for (k in srcIndex) {
            if (changeNames[k] === undefined) {
                newIndexs[k] = srcIndex[k];
            }
        }

        // 変更結果を反映する.
        const newColumns = [];
        for (k in newCms) {
            newColumns[newCms[k]] = k;
        }
        table.columns = newCms;
        table.columnNames = newColumns;
        table.indexs = newIndexs;
        return true;
    };

    // カラムタイプ: 文字列.
    const TYPE_STR = "STR";
    // カラムタイプ: 数字.
    const TYPE_NUM = "NUM";
    // カラムタイプ: boolean.
    const TYPE_BOL = "BOL";
    // カラムタイプ: yyyyMMdd(number).
    const TYPE_DAT = "DAT";
    // カラムタイプ: yyyyMMddHHmmss(number).
    const TYPE_TMS = "TMS";
    // カラムタイプ: JSON.
    const TYPE_JSN = "JSN";

    /**
     * カラムタイプ群を設定.
     * @param {object} table - 対象のテーブル内部データ
     * @param {Array} columnArray - [key, value, ....] を設定します.
     *                              - key: カラム名
     *                              - value: カラムタイプ.
     */
    const _setColumnTypes = function (table, columnArray) {
        // string, str, s: 文字列.
        // number, num, n: 数字(整数 or 浮動小数点).
        // boolean, bool, b: boolean型.
        // date, d: date型(yyyyMMddの数字).
        // timestamp, tms, t: timestamp型(yyyyMMddHHmmssの数字).
        // json, jsn, j: JSON形式.
        let key, value, i, len, n;
        len = table.columnLength;
        // カラム別のタイプ定義の初期値(string)をセット.
        const types = Array(len);
        for (i = 0; i < len; i++) {
            // 定義なしの場合は文字列.
            types[i] = TYPE_STR;
        }
        // 指定カラムタイプをセットする.
        len = columnArray.length;
        const cms = table.columns;
        for (i = 0; i < len; i += 2) {
            key = columnArray[i].trim();
            value = columnArray[i + 1].trim().toLowerCase();
            // カラム名に存在しない場合は処理しない.
            n = cms[key];
            if (n === undefined) {
                continue;
            }
            if (value == "number" || value == "num" || value == "n") {
                // 数字.
                types[n] = TYPE_NUM;
            } else if (value == "boolean" || value == "bool" || value == "b") {
                // boolean.
                types[n] = TYPE_BOL;
            } else if (value == "date" || value == "d") {
                // yyyyMMdd(number).
                types[n] = TYPE_DAT;
            } else if (value == "timestamp" || value == "tms" || value == "t") {
                // yyyyMMddHHmmss(number).
                types[n] = TYPE_TMS;
            } else if (
                value == "json" ||
                value == "jsn" ||
                value == "j" ||
                value == "object" ||
                value == "obj" ||
                value == "o"
            ) {
                // JSON.
                types[n] = TYPE_JSN;
            }
        }
        // カラムタイプを設定.
        table.columnTypes = types;
    };

    /**
     * 設定されているカラムタイプを取得.
     * @param {object} table - 対象のテーブル内部データ.
     * @return {object} カラムタイプ {column: type, ....} が返却されます.
     *                  null 返却の場合定義されていません.
     */
    const _getColumnTypes = function (table) {
        if (table.columnTypes == null) {
            return null;
        }
        const ret = {};
        const cnm = table.columnNames;
        const ctp = table.columnTypes;
        const len = table.columnLength;
        for (let i = 0; i < len; i++) {
            switch (ctp[i]) {
                // カラムタイプ: 数字.
                case TYPE_NUM:
                    ret[cnm[i]] = "number";
                    break;
                // カラムタイプ: boolean.
                case TYPE_BOL:
                    ret[cnm[i]] = "boolean";
                    break;
                // カラムタイプ: yyyyMMdd(number).
                case TYPE_DAT:
                    ret[cnm[i]] = "date";
                    break;
                // カラムタイプ: yyyyMMddHHmmss(number).
                case TYPE_TMS:
                    ret[cnm[i]] = "timestamp";
                    break;
                // カラムタイプ: JSON.
                case TYPE_JSN:
                    ret[cnm[i]] = "json";
                    break;
                default:
                    // それ以外: 文字列.
                    ret[cnm[i]] = "string";
                    break;
            }
        }
        return ret;
    };

    /**
     * １つの要素をColumnTypeで変換処理.
     * @param {string} type 対象の変換タイプ名を設定します.
     * @param {string} column カラム名を設定します.
     * @param {Object} value 対象の要素を設定します.
     * @param {boolean} utc true の場合、Date型の場合UTCで出力します.
     * @return {object} ColumnTypeに従った内容が返却されます.
     */
    const _convColumnTypeToElement = function (type, column, value, utc) {
        // 情報が存在しない場合.
        if (value === undefined || value === null) {
            // null返却.
            return null;
        }
        // オブジェクトタイプをセット.
        const t = typeof value;
        // オブジェクトが対応できない情報の場合.
        // - function
        // - Error
        if (t == "function" || value instanceof Error) {
            // null返却.
            return null;
        }
        switch (type) {
            // カラムタイプ: 数字.
            case TYPE_NUM:
                if (t == "number") {
                    return value;
                } else if (t == "string") {
                    const v = value.trim();
                    if (_isNumeric(v)) {
                        return Number(v);
                    }
                }
                // 数字が設定されていない場合.
                throw new Error(
                    "The specified column name is not a number: " +
                        column +
                        "/" +
                        value,
                );
            // カラムタイプ: boolean.
            case TYPE_BOL:
                if (t == "boolean") {
                    return value;
                } else if (t == "string") {
                    const v = value.trim();
                    // boolean変換.
                    const b = _isBoolean(v);
                    // booleanである場合.
                    if (b != null) {
                        return b;
                    }
                }
                // booleanが設定されていない場合.
                throw new Error(
                    "The specified column name is not a boolean: " +
                        column +
                        "/" +
                        value,
                );
            // カラムタイプ: yyyyMMdd(date).
            case TYPE_DAT:
                if ((value = _convDate(t, value)) != null) {
                    return value;
                }
                // Dateが設定されていない場合.
                throw new Error(
                    "The specified column name is not a Date: " +
                        column +
                        "/" +
                        value,
                );
            // カラムタイプ: yyyyMMddHHmmss(timestamp).
            case TYPE_TMS:
                if ((value = _convTimestamp(t, value)) != null) {
                    return value;
                }
                // Dateが設定されていない場合.
                throw new Error(
                    "The specified column name is not a Timestamp: " +
                        column +
                        "/" +
                        value,
                );
            // カラムタイプ: JSON.
            case TYPE_JSN:
                // 文字列でJSON形式の場合.
                if (t == "string") {
                    const v = value.trim();
                    // json形式の可能性の場合はJSON.parseする.
                    if (
                        (v.startsWith("[") && v.endsWith("]")) ||
                        (v.startsWith("{") && v.endsWith("}"))
                    ) {
                        return JSON.parse(value);
                    }
                }
                // それ以外はそのまま返却.
                return value;
            // その他カラムタイプ: 文字列.
            default:
                if (t == "string") {
                    // 文字列の場合はそのまま返却.
                    return value;
                } else if (t == "object") {
                    // Dateオブジェクトの場合は文字列返却.
                    if (value instanceof Date) {
                        return _convDateToString(value, utc);
                    }
                    // オブジェクトはJSON文字列返却.
                    return JSON.stringify(value);
                }
                // それ以外は文字列変換返却.
                return String(value);
        }
    };

    /**
     * カラムタイプが対応しているか確認.
     * @param {object} table - 対象のテーブル内部データ.
     * @return {boolean} - true の場合、対応しています.
     */
    const _isColumnTypes = function (table) {
        return table.columnTypes != null;
    };

    /**
     * Dateオブジェクトの文字変換を UTC変換で出力の場合.
     * @param {object} table - 対象のテーブル内部データ
     * @param {boolean} utc - UTCで出力の場合 true.
     */
    const _setUtc = function (table, utc) {
        table.utc = utc == true;
    };

    /**
     * UTC変換を行うか確認.
     * @param {object} table - 対象のテーブル内部データ.
     * @return {boolean} true の場合UTC変換を行います.
     */
    const _isUtc = function (table) {
        return table.utc;
    };

    /**
     * 文字列の長さを取得.
     * @param {Object} value 文字列の長さを返却します.
     * @return {number} 文字列の長さが返却されます.
     */
    const _stringLength = function (value) {
        if (value === undefined || value === null) {
            return 0;
        }
        return String(value).length;
    };

    /**
     * テーブルの全行数を取得します。
     * @param {Object} table - 対象のテーブル内部データ
     * @returns {number} 行数
     */
    const _rowLength = function (table) {
        return table.rows.length;
    };

    /**
     * 数値チェック.
     * num : チェック対象の情報を設定します.
     * 戻り値 : [true]の場合数字文字列です.
     */
    const _isNumeric = function (value) {
        if (typeof value == "string" && value.length == 0) {
            return false;
        }
        return !isNaN(Number(value));
    };

    /**
     * booleanチェック.
     * @param {String} value 文字列を設定します.
     * @return {boolean} true or false 返却で booleanです.
     *                   null が返却された場合は booleanではありません.
     */
    const _isBoolean = function (value) {
        if (value == "true" || value == "t") {
            return true;
        } else if (value == "false" || value == "f") {
            return false;
        }
        return null;
    };

    /**
     * Dateオブジェクトを文字列変換.
     * @param {Object} value 対象のDate要素を設定します.
     * @param {boolean} utc true の場合、Date型の場合UTCで出力します.
     * @return {string} 文字列が返却されます.
     */
    const _convDateToString = function (value, utc) {
        if (utc == true) {
            // yyyy-MM-ddTHH:mm:ssZ(ISO 8601)
            const y = "" + value.getUTCFullYear();
            const M = "" + (value.getUTCMonth() + 1);
            const d = "" + value.getUTCDate();
            const H = "" + value.getUTCHours();
            const m = "" + value.getUTCMinutes();
            const s = "" + value.getUTCSeconds();
            return (
                y +
                "-" +
                "00".substring(M.length) +
                M +
                "-" +
                "00".substring(d.length) +
                d +
                "T" +
                "00".substring(H.length) +
                H +
                ":" +
                "00".substring(m.length) +
                m +
                ":" +
                "00".substring(s.length) +
                s +
                "Z"
            );
        }
        // yyyy-MM-dd HH:mm:ss(JST)
        const y = "" + value.getFullYear();
        const M = "" + (value.getMonth() + 1);
        const d = "" + value.getDate();
        const H = "" + value.getHours();
        const m = "" + value.getMinutes();
        const s = "" + value.getSeconds();
        return (
            y +
            "-" +
            "00".substring(M.length) +
            M +
            "-" +
            "00".substring(d.length) +
            d +
            " " +
            "00".substring(H.length) +
            H +
            ":" +
            "00".substring(m.length) +
            m +
            ":" +
            "00".substring(s.length) +
            s
        );
    };

    /**
     * 指定valueをDate(yyyy/MM/dd)に変換してgetTime()を返却.
     * @param {string} type typeof(value)の内容を設定します.
     * @param {object} value value情報を設定します.
     * @return {number} date.getTime()が返却されます.
     *                  変換失敗の場合は null.
     */
    const _convDate = function (type, value) {
        if (
            type == "string" ||
            type == "number" ||
            (type == "object" && value instanceof Date)
        ) {
            let d = value;
            if (type == "string" || type == "number") {
                d = new Date(d);
            }
            if (!isNaN(d)) {
                return new Date(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                ).getTime();
            }
        }
        return null;
    };

    /**
     * 指定valueをTimestamp(Dateオブジェクト)に変換してgetTime()を返却.
     * @param {string} type typeof(value)の内容を設定します.
     * @param {object} value value情報を設定します.
     * @return {number} date.getTime()が返却されます.
     *                  変換失敗の場合は null.
     */
    const _convTimestamp = function (type, value) {
        if (value instanceof Date) {
            return value.getTime();
        } else if (type == "string" || type == "number") {
            value = new Date(value);
            if (!isNaN(value)) {
                return value.getTime();
            }
        }
        return null;
    };

    /**
     * 対象文字列からDate(yyyyMMdd)の数字に変換.
     * @param {String} value 日付文字列を設定します.
     * @return {number} yyyyMMddの数字が返却されます.
     *                  変換に失敗した場合は null が返却されます.
     */
    const _stringToDate = function (value) {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d)) {
            return null;
        }
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    };

    /**
     * 対象文字列からTimestamp(yyyyMMddHHmmss)の数字に変換.
     * @param {String} value 日付文字列を設定します.
     * @return {number} yyyyMMddHHmmssの数字が返却されます.
     *                  変換に失敗した場合は null が返却されます.
     */
    const _stringToTimestamp = function (value) {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d)) {
            return null;
        }
        return (
            d.getFullYear() * 10000000000 +
            (d.getMonth() + 1) * 100000000 +
            d.getDate() * 1000000 +
            d.getHours() * 10000 +
            d.getMinutes() * 100 +
            d.getSeconds()
        );
    };

    /**
     * １つの要素をカラムタイプなしで変換処理.
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - カラム名を設定します.
     * @param {object} value - 変換要素条件を設定します.
     * @param {boolean} utc true の場合、Date型の場合UTCで出力します.
     * @param {boolean} getMode - true の場合、getモードで処理されます.
     * @return {object} 変換結果内容が返却されます.
     */
    const _convNoCTypeElement = function (table, name, value, utc, getMode) {
        // カラム名が存在しない場合エラー返却.
        if (table.columns[name] === undefined) {
            throw new Error("The target column name does not exist: " + name);
        }
        // getモードの場合、何も処理しない.
        if (getMode == true) {
            return value;
        }
        // undefined or null の場合は空文字を返却.
        if (value === undefined || value === null) {
            return "";
        }
        const t = typeof value;
        if (t == "number" || t == "boolean") {
            // 数字、booleanの場合は、そのまま返却.
            return value;
        } else if (t == "object") {
            // Dateオブジェクトの場合は文字列で返却.
            if (value instanceof Date) {
                // 文字列変換.
                return _convDateToString(value, utc);
            }
            // JSON変換で文字列で保持する.
            return JSON.stringify(value);
        } else if (t == "string") {
            // 文字列で格納されている場合.
            const v = value.trim();
            // 数字系は数字変換する.
            if (_isNumeric(v)) {
                // 数字返却.
                return Number(v);
            } else {
                // boolean変換.
                const b = _isBoolean(v);
                // booleanである場合.
                if (b != null) {
                    return b;
                }
            }
            // 文字列返却.
            return value;
        }
        return "";
    };

    /**
     * １つの要素をカラムタイプありで変換処理.
     * _isColumnTypes() == true の時実行されます.
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - カラム名を設定します.
     * @param {object} value - 変換要素条件を設定します.
     * @param {boolean} getMode - true の場合、getモードで処理されます.
     * @returns {object} 変換結果が返却されます.
     */
    const _convCTypeElement = function (table, name, value, getMode) {
        if (table.columns[name] === undefined) {
            throw new Error("The target column name does not exist: " + name);
        }
        const type = table.columnTypes[table.columns[name]];
        // getModeの場合.
        if (getMode == true) {
            // Date返却の場合.
            // value はmemoryTableからの取得条件なので、
            // 変換は不要だが、Date返却は必要となる.

            // 対象タイプが Date or Timestampで
            // 戻り値が null 以外の場合.
            if (
                value != null &&
                typeof value == "number" &&
                (type == TYPE_DAT || type == TYPE_TMS)
            ) {
                return new Date(value);
            }
            // 変換なしで返却.
            return value;
        }
        // カラムタイプに従って返却.
        return _convColumnTypeToElement(
            type, // カラムタイプ.
            name, // カラム名.
            value, // カラム要素.
            table.utc, // UTC変換.
        );
    };

    /**
     * 要素を変換.
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - カラム名を設定します.
     * @param {object} value - 変換要素条件を設定します.
     * @param {boolean} getMode - true の場合、getモードで処理されます.
     * @returns { object } 変換結果が返却されます.
     */
    const _convElement = function (table, name, value, getMode) {
        // カラムタイプが設定されていない場合.
        if (!_isColumnTypes(table)) {
            // カラムタイプなしで変換処理.
            return _convNoCTypeElement(table, name, value, table.utc, getMode);
        }
        // カラムタイプありで変換処理.
        return _convCTypeElement(table, name, value, getMode);
    };

    /**
     * 指定した行番号のデータを連想配列（オブジェクト）形式で取得します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {number} rowNo - 取得したい行番号
     * @param {Array} columns - 出力対象のカラム名群を設定します.
     * @returns {Object|null} { カラム名: 値, ... } の形式。存在しない行なら null
     */
    const _getRow = function (table, rowNo, columns) {
        // ビットOR演算で確実に整数化.
        const row = table.rows[rowNo | 0];
        if (row === undefined) {
            return null;
        }
        let idx;
        const ret = Object.create(null);
        columns = columns || table.columnNames;
        const cms = table.columns;
        const len = columns.length;
        for (let i = 0; i < len; i++) {
            idx = cms[columns[i]];
            if (idx === undefined) {
                continue;
            }
            // _convElement(getMmode)で返却する.
            ret[columns[i]] = _convElement(table, columns[i], row[idx], true);
        }
        return ret;
    };

    /**
     * 指定カラムに対する空のインデックスの「枠」を生成します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - インデックス対象のカラム名
     * @returns {boolean} カラムが存在し、生成に成功した場合は true
     */
    const _createIndex = function (table, name) {
        name = name.trim();
        const no = table.columns[name];
        if (no === undefined) {
            return false; // カラムが存在しない
        }
        // 再作成フラグを true にした空のインデックス構造を準備
        table.indexs[name] = {
            reCreateFlag: true,
            index: Object.create(null),
        };
        return true;
    };

    /**
     * データに変更があった際、既存のすべてのインデックスの再作成フラグをONにします。
     * 次回の検索時に自動的に最新状態に作り直されます。
     * @param {Object} table - 対象のテーブル内部データ
     */
    const _indexReCreateFlag = function (table) {
        const idx = table.indexs;
        for (let k in idx) {
            idx[k].reCreateFlag = true;
        }
    };

    /**
     * 指定カラムのインデックスデータを実際に構築します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - インデックス対象のカラム名
     * @returns {boolean} 成功した場合は true
     */
    const _makeIndex = function (table, name) {
        name = name.trim();
        const no = table.columns[name];
        if (no === undefined) {
            return false;
        }

        const rows = table.rows;
        const len = rows.length;
        const idx = Object.create(null); // 値をキー、該当する行番号の配列を値とするマップ

        // 全行を走査してインデックスマップを作成
        for (let i = 0; i < len; i++) {
            const value = rows[i][no];
            let em = idx[value];
            // その値を持つ行が初めて出現した場合は配列を初期化
            if (em === undefined) {
                em = [];
                idx[value] = em;
            }
            // 該当する行番号を追加
            em.push(i);
        }

        table.indexs[name] = {
            reCreateFlag: false, // 作成完了したのでフラグを下ろす
            index: idx,
        };
        return true;
    };

    /**
     * 指定したカラムにインデックスが設定されているか確認します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - カラム名
     * @returns {boolean} インデックスが存在する場合は true
     */
    const _isIndex = function (table, name) {
        // 【修正点】table.index ではなく table.indexs にアクセス
        const idx = table.indexs[name.trim()];
        return idx !== undefined;
    };

    /**
     * インデックスを利用して、特定の値に一致する（または一致しない）行番号群を高速に取得します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {string} name - カラム名
     * @param {any} value - 検索値
     * @param {boolean} notFlag - true の場合、反転（不一致）の行番号を取得します
     * @returns {Array} 該当する行番号の配列（一致なしは空配列）
     */
    const _getIndex = function (table, name, value, notFlag) {
        name = name.trim();
        // 【修正点】table.index ではなく table.indexs にアクセス
        let idx = table.indexs[name];
        if (idx === undefined) {
            return null; // インデックスが存在しない
        }

        // データが更新されてインデックスが古い場合は再作成
        if (idx.reCreateFlag) {
            _makeIndex(table, name);
            idx = table.indexs[name]; // 再作成された最新状態を再取得
        }

        // 検索値に完全に一致する行番号の配列を取得
        const list = idx.index[value];

        // 値が存在しなかった場合の処理
        if (list === undefined) {
            if (notFlag === true) {
                // 不一致(not)を求めていて該当なしなら、全行が「不一致」となる
                const len = table.rows.length;
                const ret = Array(len);
                for (let i = 0; i < len; i++) {
                    ret[i] = i;
                }
                return ret;
            }
            return []; // 通常の一致検索なら該当なしで空配列を返す
        }

        // 不一致(not)条件の処理
        if (notFlag === true) {
            const listLen = list.length;
            const keys = Object.create(null);
            // 一致した行番号を記録
            for (let i = 0; i < listLen; i++) {
                keys[list[i]] = true;
            }

            const ret = [];
            const rowsLen = table.rows.length;
            // 全行を舐めて、一致した行以外を抽出
            for (let i = 0; i < rowsLen; i++) {
                if (keys[i] === true) {
                    continue; // 一致しているものはスキップ
                }
                ret.push(i);
            }
            return ret;
        }

        // 通常の一致検索なら、ヒットした行番号の配列をディープコピーして返却
        // （元の配列への破壊的操作を防ぐため）
        return [...list];
    };

    /**
     * 1行分の配列に対し、指定されたオブジェクト（連想配列）の値を上書き設定します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {Array} row - 書き換え対象の行（配列）
     * @param {Object} values - { カラム名: 値, ... } 形式の更新データ
     * @returns {boolean} 1つ以上のカラムが設定できた場合は true
     */
    const _settingRow = function (table, row, values) {
        let no,
            cnt = 0;
        const cms = table.columns;
        for (let k in values) {
            // カラム名の位置を取得.
            no = cms[(k = k.trim())];
            if (no === undefined) {
                continue; // 存在しないカラム名は無視
            }
            row[no] = _convElement(table, k, values[k]);
            cnt++;
        }
        return cnt > 0;
    };

    /**
     * テーブルに新しい行を追加します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {Object} values - 追加するデータ
     * @returns {boolean} 追加成功時は true
     */
    const _insertTable = function (table, values) {
        // カラム数分の空配列を生成
        const row = Array(table.columnLength);

        // values の内容を配列の正しい位置にセット
        if (_settingRow(table, row, values)) {
            table.rows.push(row);
            _indexReCreateFlag(table); // インデックスを無効化
            return true;
        }
        return false;
    };

    /**
     * テーブルの既存行のデータを更新します。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {number} rowNo - 更新対象の行番号
     * @param {Object} values - 更新するデータ
     * @returns {boolean} 更新成功時は true
     */
    const _updateTable = function (table, rowNo, values) {
        rowNo = rowNo | 0;
        // 【修正点】values[rowNo] ではなく、table.rows[rowNo] を取得するように修正
        const row = table.rows[rowNo];
        if (row === undefined) {
            return false; // 行が存在しない
        }

        if (_settingRow(table, row, values)) {
            _indexReCreateFlag(table);
            return true;
        }
        return false;
    };

    /**
     * テーブルから指定した行を削除します。
     * 注意：削除すると行番号（配列のインデックス）が前倒しにズレます。
     * @param {Object} table - 対象のテーブル内部データ
     * @param {number} rowNo - 削除対象の行番号
     * @returns {boolean} 削除成功時は true
     */
    const _deleteRow = function (table, rowNo) {
        rowNo = rowNo | 0;
        // splice関数で配列から要素を1つ取り除く
        if (table.rows.splice(rowNo, 1).length === 1) {
            _indexReCreateFlag(table);
            return true;
        }
        return false;
    };

    /**
     * 複数条件の AND 検索（積集合）。すべての配列に含まれる行番号のみを残します。
     * @param {Array} args - [[行番号配列1], [行番号配列2], ...] の形式
     * @returns {Array} 全てに共通する行番号の配列
     */
    const _and = function (args) {
        if (!args || args.length === 0) return [];

        // 最初の配列をSetにする
        let currentSet = new Set(args[0]);

        const len = args.length;
        for (let i = 1; i < len; i++) {
            const nextSet = new Set(args[i]);
            const intersection = new Set();
            // 両方に存在する要素だけを残す
            for (const val of currentSet) {
                if (nextSet.has(val)) {
                    intersection.add(val);
                }
            }
            currentSet = intersection;
            if (currentSet.size === 0) break; // 空になったら早期リターン
        }
        return Array.from(currentSet);
    };

    /**
     * 複数条件の OR 検索（和集合）。いずれかの配列に含まれる行番号を重複なくまとめます。
     * @param {Array} args - [[行番号配列1], [行番号配列2], ...] の形式
     * @returns {Array} ユニークマージされた行番号の配列
     */
    const _or = function (args) {
        let i, j, lenJ;
        const set = new Set();
        const len = args.length;
        for (i = 0; i < len; i++) {
            const em = args[i];
            lenJ = em.length;
            for (j = 0; j < lenJ; j++) {
                set.add(em[j]);
            }
        }
        return Array.from(set);
    };

    /**
     * not条件を返却。
     * 内容的には、複数条件の OR 検索（和集合）。
     * いずれかの配列に含まれる行番号を重複なくまとめます。
     * @param {Object} table - テーブルオブジェクトを設定.
     * @param {Array} args - [[行番号配列1], [行番号配列2], ...] の形式
     * @returns {Array} ユニークマージされた行番号の配列を逆転したNOT結果を取得.
     */
    const _not = function (table, args) {
        // or でargs をまとめる.
        let list = _or(args);
        let i,
            len = list.length;
        // or 結果の有行行番号群をSetに追加.
        const set = new Set();
        for (i = 0; i < len; i++) {
            set.add(list[i]);
        }
        // set 内容に一致しない行数を返却する.
        // これで or 結果の行数以外の内容返却になる.
        len = table.rows.length;
        list = [];
        for (i = 0; i < len; i++) {
            if (!set.has(i)) {
                list[list.length] = i;
            }
        }
        return list;
    };

    /**
     * 逐次検索（フルスキャンまたは対象行のみのスキャン）を実行します。
     * @param {Array|null} targetRowNos - 検索対象の行番号配列。null なら全行を検索
     * @param {Object} table - 対象テーブル情報
     * @param {string} name - 検索対象のカラム名
     * @param {any} value - 比較する値
     * @param {Function} call - 比較関数。call(行の値, 検索値) が true を返せば一致
     * @param {boolean} noConvValue - true以外の場合 _convElement で変換します.
     * @returns {Array} 検索結果の行番号配列
     */
    const _find = function (
        targetRowNos,
        table,
        name,
        value,
        call,
        noConvValue,
    ) {
        name = name.trim();
        // JSONカラム検索の場合.
        if (name.startsWith("#")) {
            // jsonカラム検索.
            return _find_json(targetRowNos, table, name, value, call);
        }
        // 通常検索の場合.
        const no = table.columns[name];
        if (no === undefined) return []; // 存在しないカラムなら空配列

        const rows = table.rows;
        const ret = [];

        // value変換.
        if (noConvValue != true) {
            // value を _convElementで変換.
            value = _convElement(table, name, value);
        }

        // 前段の絞り込みが無い場合（全件検索）
        if (targetRowNos == null) {
            const len = rows.length;
            for (let i = 0; i < len; i++) {
                if (call(rows[i][no], value)) {
                    ret.push(i);
                }
            }
        }
        // 既に絞り込まれた行番号群がある場合（AND検索の続きなど）
        else {
            const len = targetRowNos.length;
            for (let i = 0; i < len; i++) {
                const targetIdx = targetRowNos[i];
                if (call(rows[targetIdx][no], value)) {
                    ret.push(targetIdx);
                }
            }
        }
        return ret;
    };

    /**
     * json検索カラム名を解析.
     * "a.*.[].c.[1].d" のように設定した場合
     *  - a => * => [] => c => [1] => d
     * この順番でJSONを検索します.
     *  - a, c, d: これは固有のJSONカラムです.
     *  - *: 全てのカラム名を対象とします.
     *  - []: 配列として全体を対象とします.
     *  - [1]: 指定配列を対象とします.
     * @param {string} name json検索カラム名 を設定します.
     * @return {Array} 解析検索条件が返却されます.
     */
    const _parse_json_columns = function (name) {
        name = name.trim();
        // 最初のjson検索文字列が設定されている場合.
        if (name.startsWith("#")) {
            name = name.substring(1).trim();
        }
        let n, x;
        const list = name.split(".");
        const len = list.length;
        const ret = Array(list.length);
        // 先頭は、対象カラム名.
        ret[0] = list[0].trim();
        // 先頭以降がJSON対象条件.
        for (let i = 1; i < len; i++) {
            n = list[i].trim();
            if (n == "*") {
                // この階層の全カラムをチェックする.
                ret[i] = 10;
            } else if (n == "[]") {
                // この階層の全リストをチェックする.
                ret[i] = 11;
            } else if (n.startsWith("[") && n.endsWith("]")) {
                // 指定配列位置の条件をチェックする.
                x = n.substring(1, n.length - 1).trim() | 0;
                ret[i] = [2, x];
            } else {
                // 指定カラム名をチェックする.
                ret[i] = [1, n];
            }
        }
        return ret;
    };

    /**
     * json一致検索.
     * @param {Array} pjc _parse_json_columns でパースしたJSON検索条件を設定.
     * @param {Object} src 各行の評価条件(json)を設定します.
     * @param {Object} dest  比較する値を設定します.
     * @param {Function} call 比較関数。call(行の値, 検索値) が true を返せば一致
     * @param {number} current チェック対象のカレント位置.
     */
    const _is_json_columns = function (pjc, src, dest, call, current) {
        // src の条件が存在しない場合.
        if (src === undefined || src === null) {
            return false;
        }
        // 一番最初はカラム名が入ってる.
        current = current !== undefined && current !== null ? current : 1;
        const maxLen = pjc.length;
        const em = pjc[current];
        // 長さが２つの条件.
        //  - カラム名設定.
        //  - 配列項番を設定.
        if (Array.isArray(em)) {
            if (em[0] == 1) {
                // 対象カラム名がターゲット.
                src = src[em[1]];
                if (src === undefined) {
                    return false;
                }
            } else if (em[0] == 2) {
                // リスト指定.
                src = src[em[1]];
                if (src === undefined) {
                    return false;
                }
            }
            // 一番最後の指定.
            if (current + 1 >= maxLen) {
                return call(src, dest);
            }
            // 最後じゃない場合は、次の内容を見に行く.
            return _is_json_columns(pjc, src, dest, call, current + 1);
        }
        // 全カラムを対象とする場合.
        else if (em == 10) {
            // 一番最後の場合 true.
            if (current + 1 >= maxLen) {
                for (let k in src) {
                    // 一番最後の場合で、一致条件が存在する場合.
                    if (call(src[k], dest)) {
                        return true;
                    }
                }
            }
            // 次の内容を見に行く.
            else {
                for (let k in src) {
                    // 最後じゃない場合は、次の内容を見に行く.
                    if (
                        _is_json_columns(pjc, src[k], dest, call, current + 1)
                    ) {
                        return true;
                    }
                }
            }
        }
        // 全リストを対象とする場合.
        else if (em == 11) {
            const len = src.length;
            // 一番最後の場合 true.
            if (current + 1 >= maxLen) {
                for (let i = 0; i < len; i++) {
                    // 一番最後の場合で、一致条件が存在する場合.
                    if (call(src[i], dest)) {
                        return true;
                    }
                }
            }
            // 次の内容を見に行く.
            else {
                for (let i = 0; i < len; i++) {
                    // 最後じゃない場合は、次の内容を見に行く.
                    if (
                        _is_json_columns(pjc, src[i], dest, call, current + 1)
                    ) {
                        return true;
                    }
                }
            }
        }
        // 一致しない場合.
        return false;
    };

    /**
     * jsonカラム検索を実行します.
     * @param {Array|null} targetRowNos - 検索対象の行番号配列。null なら全行を検索
     * @param {Object} table - 対象テーブル情報
     * @param {string} name - 検索対象のjson検索用カラム名
     * @param {any} value - 比較する値
     * @param {Function} call - 比較関数。call(行の値, 検索値) が true を返せば一致
     * @returns {Array} 検索結果の行番号配列
     */
    const _find_json = function (targetRowNos, table, name, value, call) {
        // カラムタイプが対応していない場合はエラー.
        if (!_isColumnTypes(table)) {
            throw new Error("Column type has not been set.");
        }
        // json検索用カラム名をパース.
        const pjc = _parse_json_columns(name);

        // 通常検索の場合.
        const no = table.columns[pjc[0]];
        if (no === undefined) return []; // 存在しないカラムなら空配列

        const rows = table.rows;
        const ret = [];

        // 前段の絞り込みが無い場合（全件検索）
        if (targetRowNos == null) {
            const len = rows.length;
            for (let i = 0; i < len; i++) {
                if (_is_json_columns(pjc, rows[i][no], value, call)) {
                    ret.push(i);
                }
            }
        }
        // 既に絞り込まれた行番号群がある場合（AND検索の続きなど）
        else {
            const len = targetRowNos.length;
            for (let i = 0; i < len; i++) {
                const targetIdx = targetRowNos[i];
                if (_is_json_columns(pjc, rows[targetIdx][no], value, call)) {
                    ret.push(targetIdx);
                }
            }
        }
        return ret;
    };

    // --- 検索用の比較関数群（_find関数にコールバックとして渡される） ---

    // a と b の比較系.
    const _fcall_eq = function (a, b) {
        return a == b;
    };
    const _fcall_ne = function (a, b) {
        return a != b;
    };
    const _fcall_gt = function (a, b) {
        return a > b;
    };
    const _fcall_ge = function (a, b) {
        return a >= b;
    };
    const _fcall_lt = function (a, b) {
        return a < b;
    };
    const _fcall_le = function (a, b) {
        return a <= b;
    };

    // b が配列ならその中に a が含まれるか
    const _fcall_in = function (a, b) {
        if (Array.isArray(b)) {
            const len = b.length;
            for (let i = 0; i < len; i++) {
                if (a == b[i]) return true;
            }
            return false;
        }
        return a == b;
    };

    // b が配列ならその中に a が全て含まれないか
    const _fcall_ni = function (a, b) {
        if (Array.isArray(b)) {
            const len = b.length;
            for (let i = 0; i < len; i++) {
                if (a == b[i]) return false;
            }
            return true;
        }
        return a != b;
    };

    // b が要素数2の配列なら、b[0] と b[1] の間に a が含まれるか
    const _fcall_between = function (a, b) {
        if (Array.isArray(b) && b.length >= 2) {
            return a >= b[0] && a <= b[1];
        }
        return false;
    };

    // b が正規表現オブジェクトなら、a をテストする
    const _fcall_regexp = function (a, b) {
        if (b instanceof RegExp) {
            return b.test(String(a));
        }
        return false;
    };

    // a が文字列の場合、長さで判別系.
    const _fcall_leq = function (a, b) {
        return _fcall_eq(_stringLength(a), b);
    };
    const _fcall_lne = function (a, b) {
        return _fcall_ne(_stringLength(a), b);
    };
    const _fcall_lgt = function (a, b) {
        return _fcall_gt(_stringLength(a), b);
    };
    const _fcall_lge = function (a, b) {
        return _fcall_ge(_stringLength(a), b);
    };
    const _fcall_llt = function (a, b) {
        return _fcall_lt(_stringLength(a), b);
    };
    const _fcall_lle = function (a, b) {
        return _fcall_le(_stringLength(a), b);
    };
    const _fcall_lin = function (a, b) {
        return _fcall_in(_stringLength(a), b);
    };
    const _fcall_lni = function (a, b) {
        return _fcall_ni(_stringLength(a), b);
    };
    const _fcall_lbetween = function (a, b) {
        return _fcall_between(_stringLength(a), b);
    };

    // a を Date(yyyy-MM-dd) で b と評価.
    const _fcall_deq = function (a, b) {
        return _fcall_eq(_stringToDate(a), b);
    };
    const _fcall_dne = function (a, b) {
        return _fcall_ne(_stringToDate(a), b);
    };
    const _fcall_dgt = function (a, b) {
        return _fcall_gt(_stringToDate(a), b);
    };
    const _fcall_dge = function (a, b) {
        return _fcall_ge(_stringToDate(a), b);
    };
    const _fcall_dlt = function (a, b) {
        return _fcall_lt(_stringToDate(a), b);
    };
    const _fcall_dle = function (a, b) {
        return _fcall_le(_stringToDate(a), b);
    };
    const _fcall_din = function (a, b) {
        return _fcall_in(_stringToDate(a), b);
    };
    const _fcall_dni = function (a, b) {
        return _fcall_ni(_stringToDate(a), b);
    };
    const _fcall_dbetween = function (a, b) {
        return _fcall_between(_stringToDate(a), b);
    };

    // a を Timestamp(yyyy-MM-dd HH:mm:ss) で b と評価.
    const _fcall_teq = function (a, b) {
        return _fcall_eq(_stringToTimestamp(a), b);
    };
    const _fcall_tne = function (a, b) {
        return _fcall_ne(_stringToTimestamp(a), b);
    };
    const _fcall_tgt = function (a, b) {
        return _fcall_gt(_stringToTimestamp(a), b);
    };
    const _fcall_tge = function (a, b) {
        return _fcall_ge(_stringToTimestamp(a), b);
    };
    const _fcall_tlt = function (a, b) {
        return _fcall_lt(_stringToTimestamp(a), b);
    };
    const _fcall_tle = function (a, b) {
        return _fcall_le(_stringToTimestamp(a), b);
    };
    const _fcall_tin = function (a, b) {
        return _fcall_in(_stringToTimestamp(a), b);
    };
    const _fcall_tni = function (a, b) {
        return _fcall_ni(_stringToTimestamp(a), b);
    };
    const _fcall_tbetween = function (a, b) {
        return _fcall_between(_stringToTimestamp(a), b);
    };

    /**
     * 結果をソート処理.
     * @param {Array} rows 出力結果の行情報=[{columns: value, ...}].
     * @param {Object} sortColumns ソート対象のカラム名を設定.
     * @param {Object} sortDesc 降順ソートの場合は true.
     */
    const _sort = function (rows, sortColumns, sortDesc) {
        const cols = Array.isArray(sortColumns) ? sortColumns : [sortColumns];
        const descs = Array.isArray(sortDesc) ? sortDesc : [sortDesc];

        return rows.sort(function (a, b) {
            for (let i = 0; i < cols.length; i++) {
                const name = cols[i];
                const isDesc = descs[i] === true; // デフォルトは昇順(false)とする
                const valA = a[name];
                const valB = b[name];

                if (valA > valB) return isDesc ? -1 : 1;
                if (valA < valB) return isDesc ? 1 : -1;
                // 値が同じ場合は次のカラムの比較へ進む
            }
            return 0;
        });
    };

    // =========================================================
    // メモリーテーブル公開API
    // =========================================================

    /**
     * メモリテーブルを生成するコンストラクタ関数
     * 引数に渡された文字列をカラム名としてテーブルを初期化します。
     * 例: const tbl = memoryTable("id", "name", "age");
     *   または
     *     const tbl = memoryTable(["id", "name", "age"]);
     */
    const memoryTable = function () {
        const _THIS = {};
        // 引数が正しく設定されている場合.
        if (arguments.length > 0) {
            // arguments（引数オブジェクト）を配列風に渡して内部テーブルを作成
            _createTable(_THIS, Array.from(arguments));
        }

        // テーブル操作APIを提供する公開オブジェクト
        const o = {
            toString: function () {
                return "memoryTable";
            },
            _$THIS: _THIS,
        };

        /**
         * カラム名を変更する.
         */
        o.changeColumnsName = function (columnsNames) {
            return _changeColumnsName(_THIS, columnsNames);
        };

        /**
         * カラムタイプを設定.
         */
        o.setColumnTypes = function () {
            _setColumnTypes(_THIS, arguments);
            return o;
        };

        /**
         * カラムタイプを取得.
         */
        o.getColumnTypes = function () {
            return _getColumnTypes(_THIS);
        };

        o.isColumnTypes = function () {
            return _isColumnTypes(_THIS);
        };

        /**
         * Dateオブジェクトを文字変換する場合UTCで出力するか設定.
         */
        o.setUtc = function (utc) {
            _setUtc(_THIS, utc);
            return o;
        };

        /**
         * UTCで出力するか確認.
         */
        o.isUtc = function () {
            return _isUtc(_THIS);
        };

        /**
         * ヘッダ情報群を取得.
         */
        o.getHeaders = function () {
            return _THIS.columnNames;
        };

        /**
         * インデックスを生成.
         */
        o.createIndex = function (name) {
            return _createIndex(_THIS, name);
        };

        /**
         * インデックス名群を取得.
         */
        o.getIndexColumns = function () {
            const ret = [];
            const names = _THIS.indexs;
            for (let k in names) {
                ret[ret.length] = k;
            }
            return ret;
        };

        /**
         * チェーンメソッドを利用可能な検索オブジェクト（Query Builder）を生成します。
         */
        o.find = function () {
            // 現在の絞り込まれた行番号群。初回実行時は null
            let _findTargetRowNos = null;

            const fo = {
                toString: function () {
                    return "findObject";
                },
            };

            // 汎用的な検索実行の内部処理.
            // name: カラム名を設定します.
            // value: 比較対象の要素を設定します.
            // call: call(a, b) のfunctionを定義する事で、独自の判別条件が設定出来ます.
            //         - a: 検索中の name カラム名の対象行内容がセットされます.
            //         - b: value の内容が設定されます.
            //           戻り値: true を返却することで、対象行が検索結果対象となります.
            // noConvValue: true以外の場合 _convElement で変換します.
            const _f = function (name, value, call, noConvValue) {
                _findTargetRowNos = _find(
                    _findTargetRowNos,
                    _THIS,
                    name,
                    value,
                    call,
                    noConvValue,
                );
                return fo; // メソッドチェーン用に自身を返す
            };
            fo.f = _f;

            // 検索中の情報をリセット.
            fo.reset = function () {
                _findTargetRowNos = null;
                return fo; // メソッドチェーン用に自身を返す
            };

            // [=] 一致検索
            fo.eq = function (name, value) {
                // インデックスが利用可能か.
                if (_isIndex(_THIS, name)) {
                    // インデックスで検索.
                    const res = _getIndex(_THIS, name, value, false);
                    if (_findTargetRowNos === null) {
                        _findTargetRowNos = res;
                    } else {
                        _findTargetRowNos = _and([_findTargetRowNos, res]);
                    }
                    return fo; // メソッドチェーン用に自身を返す
                }
                return _f(name, value, _fcall_eq);
            };

            // [!=] 不一致検索
            fo.ne = function (name, value) {
                // インデックスが利用可能か.
                if (_isIndex(_THIS, name)) {
                    // インデックスで検索.
                    const res = _getIndex(_THIS, name, value, true);
                    if (_findTargetRowNos === null) {
                        _findTargetRowNos = res;
                    } else {
                        _findTargetRowNos = _and([_findTargetRowNos, res]);
                    }
                    return fo; // メソッドチェーン用に自身を返す
                }
                return _f(name, value, _fcall_ne);
            };

            // 各種比較検索
            fo.gt = function (name, value) {
                return _f(name, value, _fcall_gt);
            };
            fo.ge = function (name, value) {
                return _f(name, value, _fcall_ge);
            };
            fo.lt = function (name, value) {
                return _f(name, value, _fcall_lt);
            };
            fo.le = function (name, value) {
                return _f(name, value, _fcall_le);
            };
            fo.in = function (name, value) {
                return _f(name, value, _fcall_in);
            };
            fo.ni = function (name, value) {
                return _f(name, value, _fcall_ni);
            };
            fo.between = function (name, value) {
                return _f(name, value, _fcall_between);
            };
            fo.regexp = function (name, value) {
                return _f(name, value, _fcall_regexp);
            };

            // 長さ比較検索
            fo.leq = function (name, value) {
                return _f(name, value, _fcall_leq, true);
            };
            fo.lne = function (name, value) {
                return _f(name, value, _fcall_lne, true);
            };
            fo.lgt = function (name, value) {
                return _f(name, value, _fcall_lgt, true);
            };
            fo.lge = function (name, value) {
                return _f(name, value, _fcall_lge, true);
            };
            fo.llt = function (name, value) {
                return _f(name, value, _fcall_llt, true);
            };
            fo.lle = function (name, value) {
                return _f(name, value, _fcall_lle, true);
            };
            fo.lin = function (name, value) {
                return _f(name, value, _fcall_lin, true);
            };
            fo.lni = function (name, value) {
                return _f(name, value, _fcall_lni, true);
            };
            fo.lbetween = function (name, value) {
                return _f(name, value, _fcall_lbetween, true);
            };

            // Date(yyyy-MM-dd)比較で検索.
            fo.deq = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_deq, true);
            };
            fo.dne = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dne, true);
            };
            fo.dgt = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dgt, true);
            };
            fo.dge = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dge, true);
            };
            fo.dlt = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dlt, true);
            };
            fo.dle = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dle, true);
            };
            fo.din = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_din, true);
            };
            fo.dni = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dni, true);
            };
            fo.dbetween = function (name, value) {
                return _f(name, _stringToDate(value), _fcall_dbetween, true);
            };

            // Timestamp(yyyy-MM-dd HH:mm:ss)比較で検索.
            fo.teq = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_teq, true);
            };
            fo.tne = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tne, true);
            };
            fo.tgt = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tgt, true);
            };
            fo.tge = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tge, true);
            };
            fo.tlt = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tlt, true);
            };
            fo.tle = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tle, true);
            };
            fo.tin = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tin, true);
            };
            fo.tni = function (name, value) {
                return _f(name, _stringToTimestamp(value), _fcall_tni, true);
            };
            fo.tbetween = function (name, value) {
                return _f(
                    name,
                    _stringToTimestamp(value),
                    _fcall_tbetween,
                    true,
                );
            };

            /**
             * 構築した検索条件を実行し、結果の行番号配列を返します。
             */
            fo.result = function () {
                const ret = _findTargetRowNos || []; // nullの場合は空配列を返す
                _findTargetRowNos = null; // 状態リセット
                return ret;
            };
            fo.r = fo.result;

            return fo;
        };

        /**
         * 複数の検索結果（または行番号の配列）を AND 条件で統合します。
         */
        o.and = function () {
            const list = [];
            for (let i = 0; i < arguments.length; i++) {
                const em = arguments[i];
                // findObjectが渡された場合は、result()を呼び出して配列化する
                list.push(
                    em && em.toString() === "findObject" ? em.result() : em,
                );
            }
            return _and(list);
        };

        /**
         * 複数の検索結果（または行番号の配列）を OR 条件で統合します。
         */
        o.or = function () {
            const list = [];
            for (let i = 0; i < arguments.length; i++) {
                const em = arguments[i];
                list.push(
                    em && em.toString() === "findObject" ? em.result() : em,
                );
            }
            return _or(list);
        };

        /**
         * 複数の検索結果（または行番号の配列）を NOT 条件で統合します。
         */
        o.not = function () {
            const list = [];
            for (let i = 0; i < arguments.length; i++) {
                const em = arguments[i];
                list.push(
                    em && em.toString() === "findObject" ? em.result() : em,
                );
            }
            return _not(_THIS, list);
        };

        /**
         * 複数行を追加.
         */
        o.insertList = function (list) {
            let ret = false;
            const len = list.length;
            for (let i = 0; i < len; i++) {
                if (_insertTable(_THIS, list[i])) {
                    ret = true;
                }
            }
            return ret;
        };

        /**
         * １行追加.
         */
        o.insert = function (values) {
            return _insertTable(_THIS, values);
        };

        /**
         * 行更新.
         */
        o.update = function (find, values) {
            // findが設定されていない場合(全件更新).
            if (find === undefined || find === null || find < 0) {
                let ret = false;
                const len = _THIS.rows.length;
                for (let i = 0; i < len; i++) {
                    if (_updateTable(_THIS, i, values)) {
                        ret = true;
                    }
                }
                return ret;
            }
            // findObjectの場合は実行して配列を取得
            if (find && find.toString() === "findObject") {
                find = find.result();
            }
            // 行番号の配列が渡された場合、ループして全て更新
            if (Array.isArray(find)) {
                let ret = false;
                const len = find.length;
                for (let i = 0; i < len; i++) {
                    if (_updateTable(_THIS, find[i], values)) {
                        ret = true;
                    }
                }
                return ret;
            }
            // 単体の行番号指定の場合
            return _updateTable(_THIS, find, values);
        };

        /**
         * Upsert (Insert or Update)
         * 指定したカラム（主キー）の値が一致する行があれば更新、なければ新規追加します。
         */
        o.upsert = function (keyColumn, values) {
            const keyValue = values[keyColumn];
            if (keyValue === undefined) return false;

            // 既存データがあるか検索
            const targetRows = o.find().eq(keyColumn, keyValue).result();
            if (targetRows.length > 0) {
                // 存在すれば更新
                return o.update(targetRows, values);
            } else {
                // 存在しなければ新規追加
                return o.insert(values);
            }
        };

        /**
         * 行削除.
         */
        o.delete = function (find) {
            // 1. 全件削除の場合
            if (find === undefined || find === null || find < 0) {
                _THIS.rows = [];
                const indexs = _THIS.indexs;
                for (let k in indexs) {
                    _createIndex(_THIS, k);
                }
                return true;
            }

            // 検索結果オブジェクトが渡された場合
            if (find && find.toString() === "findObject") {
                find = find.result();
            }

            // 配列（複数行指定）の場合
            if (Array.isArray(find)) {
                if (find.length === 0) return false;

                const deleteCount = find.length;
                const totalRows = _THIS.rows.length;

                // 削除件数が 10件以上、または全体行数の 5% 以上なら「配列再構築」
                if (deleteCount >= 10 || deleteCount >= totalRows * 0.05) {
                    const deleteSet = new Set(find);
                    const newRows = [];
                    for (let i = 0; i < totalRows; i++) {
                        if (!deleteSet.has(i)) {
                            newRows.push(_THIS.rows[i]); // 削除対象でなければ新しい配列に積む
                        }
                    }
                    _THIS.rows = newRows; // 新しい配列で上書き
                    _indexReCreateFlag(_THIS); // インデックス再構築フラグ
                    return true;
                } else {
                    // 従来ルート（件数が少ないので splice で十分速い）
                    // 数値昇順ソートして、後ろから消す
                    find.sort(function (a, b) {
                        return a - b;
                    });
                    let ret = false;
                    for (let i = find.length - 1; i >= 0; i--) {
                        if (_deleteRow(_THIS, find[i])) {
                            ret = true;
                        }
                    }
                    return ret;
                }
            }

            // 単体行番号指定の場合（1件だけなので splice ルート）
            return _deleteRow(_THIS, find);
        };

        /**
         * 行取得.
         */
        o.select = function (find, sortColumns, sortDesc, columns) {
            let len, em, ret;
            // 出力カラム群が設定されていない場合は、全てが対象.
            columns = columns || _THIS.columnNames;
            // findが設定されていない場合(全件取得).
            if (find === undefined || find === null) {
                ret = [];
                len = _THIS.rows.length;
                for (let i = 0; i < len; i++) {
                    em = _getRow(_THIS, i, columns);
                    if (em !== null) {
                        ret.push(em);
                    }
                }
            }
            // 検索結果が設定されている場合.
            else {
                if (find && find.toString() === "findObject") {
                    find = find.result();
                }
                // 配列の場合は配列内容の行情報群を取得.
                if (Array.isArray(find)) {
                    ret = [];
                    len = find.length;
                    for (let i = 0; i < len; i++) {
                        em = _getRow(_THIS, find[i], columns);
                        if (em !== null) {
                            ret.push(em);
                        }
                    }
                } else {
                    // 単体行指定の場合は、指定行番号の内容を取得.
                    em = _getRow(_THIS, find, columns);
                    ret = em === null ? [] : [em];
                }
            }

            // ソートカラム設定が存在する場合.
            if (
                ret.length > 1 &&
                sortColumns !== undefined &&
                sortColumns !== null
            ) {
                // ソート処理.
                _sort(ret, sortColumns, sortDesc);
            }
            return ret;
        };

        /**
         * 行数を取得.
         */
        o.count = function (find) {
            // 検索結果が設定されている場合.
            if (find && find.toString() === "findObject") {
                find = find.result();
            }
            // 配列の場合は配列数を返却.
            if (Array.isArray(find)) {
                return find.length;
            }
            // テーブル全体の件数を返却.
            return _rowLength(_THIS);
        };

        /**
         * 行番号を指定して内容を取得.
         * 行番号を直接指定なので、 count() で値を取ってループ処理で
         * 内容を取得できる.
         */
        o.row = function (no, columns) {
            return _getRow(_THIS, no, columns);
        };

        /**
         * 指定カラムを設定して内容を取得.
         * 単純に１つのカラム名と１つの条件を設定して取得する場合はこちらを利用.
         * また sortDesc == undefined or null の場合、ソート処理は行わずに返却します.
         */
        o.search = function (name, value, columns, sortDesc) {
            if (sortDesc === undefined || sortDesc === null) {
                return o.select(o.find().eq(name, value), null, null, columns);
            }
            return o.select(
                o.find().eq(name, value),
                name,
                sortDesc == true,
                columns,
            );
        };

        /**
         * テーブルデータを保存用オブジェクトとして出力します.
         * これらを JSON変換するか、jsonbモジュールで保存します.
         * @param {boolean} [cloneFlag] - true の場合ディープコピーして返却.
         *                                false または省略の場合は参照共有となります.
         * @returns {object} 保存用オブジェクト.
         */
        o.save = function (cloneFlag) {
            /*
              "columnNames": カラム名群(Array).
              "columnTypes": カラムタイプ群(Array).
              "rows":  実際のデータ（行）を格納する2次元配列'array,array)
              "indexs: インデックスカラム名群(array).
              "utc": true の場合 UTCで設定(boolean).
            */
            // thisをクローン.
            const table = _THIS;
            // 戻り値:
            const ret = {};
            // 共通.
            // インデックスカラム名を保存.
            ret["indexs"] = o.getIndexColumns();
            // UTC条件をセット.
            ret["utc"] = table["utc"];
            // クローン化しない場合.
            if (cloneFlag != true) {
                // こちらの方が早いが、その後変更がある場合反映される危険性がある.
                // 呼び出した後に即時保存する場合はこちらで対応はOK.
                ret["columnNames"] = table["columnNames"];
                ret["columnTypes"] = table["columnTypes"];
                ret["rows"] = table["rows"];
                return ret;
            }
            // clone実行.
            // こちらの方が安全だが、速度的に遅くなる.
            ret["columnNames"] = JSON.parse(
                JSON.stringify(table["columnNames"]),
            );
            ret["columnTypes"] =
                table["columnTypes"] == null
                    ? null
                    : JSON.parse(JSON.stringify(table["columnTypes"]));
            ret["rows"] = JSON.parse(JSON.stringify(table["rows"]));
            return ret;
        };
        return o;
    };

    /**
     * メモリテーブルのデフォルトのUTC設定.
     * @param {boolean} utc true を設定した場合 UTC で出力します.
     */
    const setMemoryTableToUtc = function (utc) {
        _DEFAULT_UTC = utc == true;
    };

    /**
     * メモリテーブルのデフォルトのUTC取得.
     * @return {boolean} true の場合 UTC で出力します.
     */
    const getMemoryTableToUtc = function () {
        return _DEFAULT_UTC;
    };

    /**
     * memoryTable.create を save した jsonを設定する事で
     * memoryTableをローディングします.
     * @param {object} json memoryTable.create を export した
     *                 オブジェクトを設定します.
     * @return {object} memoryTableオブジェクトが返却されます.
     */
    const open = function (json) {
        /*
          "columnNames": カラム名群(Array).
          "columnTypes": カラムタイプ群(Array).
          "rows":  実際のデータ（行）を格納する2次元配列'array,array)
          "indexs: インデックスカラム名群(array).
          "utc": true の場合 UTCで設定(boolean).
        */
        // 空のメモリテーブルオブジェクトを生成.
        const o = memoryTable();
        const table = o["_$THIS"];

        // オリジナルでオブジェクトの初期設定.
        _createTable(table, json["columnNames"]);
        // カラムタイプをセット.
        table["columnTypes"] = json["columnTypes"];
        // テーブル行情報をセット.
        table["rows"] = json["rows"];
        // utcをセット.
        table["utc"] = json["utc"];
        // インデックスをセット.
        const list = json["indexs"];
        const len = list.length;
        for (let i = 0; i < len; i++) {
            o.createIndex(list[i]);
        }
        return o;
    };

    // ========================================================
    // モジュールエクスポート
    // ========================================================
    // Node.js(CommonJS)環境とブラウザ環境の両方に対応
    if (typeof exports !== "undefined") {
        exports.create = memoryTable;
        exports.open = open;
        exports.setMemoryTableToUtc = setMemoryTableToUtc;
        exports.getMemoryTableToUtc = getMemoryTableToUtc;
    } else {
        global.memoryTable = {
            create: memoryTable,
            open: open,
            setMemoryTableToUtc: setMemoryTableToUtc,
            getMemoryTableToUtc: getMemoryTableToUtc,
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
