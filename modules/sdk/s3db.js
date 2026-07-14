///////////////////////////////////////////////
// S3全体JSON型データベース(s3db).
//
// AIメモ:
// 詳細は docs/s3db.md を参照。s3IndexTable.js(modules/sdk/s3IndexTable.js)
// と対になるモジュールで、書き込み頻度が少なく読み込み頻度が多い用途向け.
//
// - テーブル全体を1つのJSON(table/{table名}/data.json)として
//   読み込み→メモリ上でフィルタ・更新→丸ごと書き戻す方式.
//   s3IndexTable.jsのようなインデックスは持たず、全件走査で検索する
//   ため、where条件はmemoryTable.js(modules/csv/memoryTable.js)相当の
//   演算子(eq/ne/gt/gte/lt/lte/in/ni/between/regexp)をそのまま使える.
//   ※ 演算子名は memoryTable.js の ge/le ではなく、s3IndexTable.js に
//     合わせて gte/lte としている(プロジェクト内表記の統一).
// - primaryKey/unique/autoIncrementは、テーブル全体を1回の
//   読み込み→書き戻しサイクルの中で検証するため、s3IndexTable.jsとは
//   異なり提供する(s3IndexTable.jsで見送った理由は、複数の独立した
//   Lambda実行が別々の行ファイル+インデックスファイルに分散して
//   書き込むため一意性チェックがTOCTOU的に競合するからだが、本モジュールは
//   その構造ではないため同じ問題は起きない。ただし複数の書き込みが
//   同時に発生した場合、後勝ちで上書きされる可能性は既存の制約として
//   残る=書き込み頻度が少ない前提のため許容している).
// - join・transactionは不要機能として提供しない(旧実装にはあったが削除).
// - カラム型システム(string/int/float/boolean/date/json)は
//   s3IndexTable.jsと共通の考え方. date型はinsert時にDateオブジェクトを
//   受け取り、内部的にはUnixTimeミリ秒のnumberとして保存し、
//   select時に(集計されていない通常の行では)Dateオブジェクトに変換して
//   返す。where条件の比較時もDateオブジェクトを渡せるように、
//   比較前に自動的にミリ秒数へ変換している.
///////////////////////////////////////////////
(function () {
    'use strict';

    // S3の低レベル操作(put/get/delete/list).
    const s3sdk = $loadLib("s3sdk.js");

    // StreamをStringに変換.
    // (llrtでは for-await-of 構文が動作しない事例があるため
    //  transformToString() を利用する).
    const _streamToString = function (stream) {
        return stream.transformToString("utf-8");
    };

    // カラム型ごとの簡易バリデーション.
    const _TYPE_CHECK = {
        string: function (v) { return typeof v === "string"; },
        int: function (v) { return typeof v === "number"; },
        float: function (v) { return typeof v === "number"; },
        boolean: function (v) { return typeof v === "boolean"; },
        date: function (v) { return (v instanceof Date) || typeof v === "number"; },
        json: function () { return true; }
    };

    ///////////////////////////////////////////////
    // where条件の評価(memoryTable.js相当の演算子セット).
    ///////////////////////////////////////////////

    // date型カラムとの比較のため、条件側の値もDateオブジェクトなら
    // ミリ秒数値に変換する(行側は常にミリ秒数値で保持しているため).
    const _coerceForCompare = function (type, value) {
        if (type === "date" && value instanceof Date) {
            return value.getTime();
        }
        return value;
    };

    // 1カラム分の条件を評価する.
    // cond がプリミティブ値やRegExp・配列の場合はeq相当として扱う.
    // cond がオブジェクトの場合、指定された演算子を全てAND評価する
    // (例: {gte: 20, lte: 40} は範囲条件になる).
    const _evalCondition = function (type, rowValue, cond) {
        if (cond == null || typeof cond !== "object" ||
            cond instanceof RegExp || Array.isArray(cond)) {
            return rowValue === _coerceForCompare(type, cond);
        }
        let matched = true;
        if (cond.eq !== undefined) {
            matched = matched && (rowValue === _coerceForCompare(type, cond.eq));
        }
        if (cond.ne !== undefined) {
            matched = matched && (rowValue !== _coerceForCompare(type, cond.ne));
        }
        if (cond.gt !== undefined) {
            matched = matched && (rowValue > _coerceForCompare(type, cond.gt));
        }
        if (cond.gte !== undefined) {
            matched = matched && (rowValue >= _coerceForCompare(type, cond.gte));
        }
        if (cond.lt !== undefined) {
            matched = matched && (rowValue < _coerceForCompare(type, cond.lt));
        }
        if (cond.lte !== undefined) {
            matched = matched && (rowValue <= _coerceForCompare(type, cond.lte));
        }
        if (cond.in !== undefined) {
            const list = cond.in.map((v) => _coerceForCompare(type, v));
            matched = matched && (list.indexOf(rowValue) !== -1);
        }
        if (cond.ni !== undefined) {
            const list = cond.ni.map((v) => _coerceForCompare(type, v));
            matched = matched && (list.indexOf(rowValue) === -1);
        }
        if (cond.between !== undefined) {
            const lo = _coerceForCompare(type, cond.between[0]);
            const hi = _coerceForCompare(type, cond.between[1]);
            matched = matched && (rowValue >= lo && rowValue <= hi);
        }
        if (cond.regexp !== undefined) {
            const re = (cond.regexp instanceof RegExp) ?
                cond.regexp : new RegExp(cond.regexp);
            matched = matched && re.test(String(rowValue));
        }
        return matched;
    };

    // where(複数カラムの条件, AND評価)にマッチするか判定する.
    const _matchesWhere = function (schema, row, where) {
        if (where == null) {
            return true;
        }
        for (const col in where) {
            const type = schema.columns[col] ? schema.columns[col].type : undefined;
            if (!_evalCondition(type, row[col], where[col])) {
                return false;
            }
        }
        return true;
    };

    ///////////////////////////////////////////////
    // テーブル操作本体.
    ///////////////////////////////////////////////

    // s3dbオブジェクトを生成する.
    // options.bucket 対象のS3バケット名を設定します(必須).
    // options.prefix バケット内の格納先prefixを設定します(省略可).
    // options.region S3接続先リージョンを設定します.
    // options.credentials S3接続用クレデンシャルを設定します.
    exports.create = function (options) {
        options = options || {};
        if (options.bucket == null) {
            throw new Error("options.bucket is required.");
        }
        const _bucket = options.bucket;
        const _basePrefix = options.prefix
            ? (options.prefix.endsWith("/") ? options.prefix : options.prefix + "/")
            : "";
        const _s3opts = {
            region: options.region,
            credentials: options.credentials
        };

        const _schemaPrefix = function () {
            return _basePrefix + "_schema";
        };
        const _schemaKey = function (tableName) {
            return tableName + ".json";
        };
        const _dataPrefix = function (tableName) {
            return _basePrefix + "table/" + tableName;
        };
        const _dataKey = function () {
            return "data.json";
        };

        // スキーマを取得する(存在しない場合はエラー).
        const _loadSchema = async function (tableName) {
            const res = await s3sdk.get(_bucket, _schemaPrefix(), _schemaKey(tableName), _s3opts);
            if (res == null) {
                throw new Error("Table not found: " + tableName);
            }
            return JSON.parse(await _streamToString(res.Body));
        };

        const _saveSchema = async function (tableName, schema) {
            await s3sdk.put(_bucket, _schemaPrefix(), _schemaKey(tableName),
                JSON.stringify(schema), _s3opts);
        };

        // 行データ全件を取得する(存在しない場合は空配列).
        const _loadRows = async function (tableName) {
            const res = await s3sdk.get(_bucket, _dataPrefix(tableName), _dataKey(), _s3opts);
            if (res == null) {
                return [];
            }
            return JSON.parse(await _streamToString(res.Body));
        };

        const _saveRows = async function (tableName, rows) {
            await s3sdk.put(_bucket, _dataPrefix(tableName), _dataKey(),
                JSON.stringify(rows), _s3opts);
        };

        // テーブル作成.
        // tableName 対象のテーブル名を設定します.
        // schema.columns カラム定義
        //   ({名前: {type, notNull, default, primaryKey, unique, autoIncrement}}).
        const createTable = async function (tableName, schema) {
            schema = schema || {};
            const columns = schema.columns || {};
            const existing = await s3sdk.get(_bucket, _schemaPrefix(), _schemaKey(tableName), _s3opts);
            if (existing != null) {
                throw new Error("Table already exists: " + tableName);
            }
            const autoIncrementSeq = {};
            for (const colName in columns) {
                if (columns[colName].autoIncrement === true) {
                    autoIncrementSeq[colName] = 0;
                }
            }
            const saveSchemaObj = { columns: columns, autoIncrementSeq: autoIncrementSeq };
            await _saveSchema(tableName, saveSchemaObj);
            await _saveRows(tableName, []);
            return true;
        };

        // テーブル削除.
        const dropTable = async function (tableName) {
            await s3sdk.delete(_bucket, _schemaPrefix(), _schemaKey(tableName), _s3opts);
            await s3sdk.delete(_bucket, _dataPrefix(tableName), _dataKey(), _s3opts);
            return true;
        };

        // テーブル定義を取得する.
        const describeTable = async function (tableName) {
            return await _loadSchema(tableName);
        };

        // 1件分の行データを、カラム定義(notNull/default/primaryKey/unique/
        // autoIncrement/型)に従って検証・補完する.
        // rows 一意性チェック対象の既存行配列を設定します.
        const _prepareInsertRow = function (schema, rows, raw) {
            const row = {};
            for (const colName in schema.columns) {
                const def = schema.columns[colName];
                let value = raw[colName];

                if (def.autoIncrement === true && value == null) {
                    schema.autoIncrementSeq[colName] =
                        (schema.autoIncrementSeq[colName] || 0) + 1;
                    value = schema.autoIncrementSeq[colName];
                }
                if (value == null && def.default !== undefined) {
                    value = (typeof def.default === "function") ? def.default() : def.default;
                }
                if (value == null && def.notNull === true) {
                    throw new Error("Column '" + colName + "' must not be null.");
                }
                if (value != null && def.type && !_TYPE_CHECK[def.type](value)) {
                    throw new Error("Type mismatch for column '" + colName +
                        "': expected " + def.type);
                }
                if ((def.primaryKey === true || def.unique === true) && value != null) {
                    const cmpValue = _coerceForCompare(def.type, value);
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i][colName] === cmpValue) {
                            throw new Error("Duplicate value for unique column '" +
                                colName + "': " + value);
                        }
                    }
                }
                if (value !== undefined) {
                    row[colName] = (def.type === "date" && value instanceof Date)
                        ? value.getTime() : value;
                }
            }
            return row;
        };

        // INSERT.
        // tableName 対象のテーブル名を設定します.
        // records 挿入する行データ(オブジェクトまたは配列)を設定します.
        // 戻り値: 挿入された行データ(補完後)の配列が返却されます.
        const insert = async function (tableName, records) {
            const schema = await _loadSchema(tableName);
            const rows = await _loadRows(tableName);
            const input = Array.isArray(records) ? records : [records];
            const inserted = [];
            for (let i = 0; i < input.length; i++) {
                const row = _prepareInsertRow(schema, rows, input[i]);
                rows.push(row);
                inserted.push(row);
            }
            await _saveRows(tableName, rows);
            // autoIncrementSeqの更新を保存.
            await _saveSchema(tableName, schema);
            return inserted;
        };

        // 行データのdate型カラムをDateオブジェクトに変換した複製を返す.
        const _applyDateConversion = function (schema, row) {
            const out = Object.assign({}, row);
            for (const colName in schema.columns) {
                if (schema.columns[colName].type === "date" && out[colName] != null) {
                    out[colName] = new Date(out[colName]);
                }
            }
            return out;
        };

        // GROUP BY / 集計処理.
        const _groupAndAggregate = function (rows, groupBy, aggregates) {
            const groups = {};
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const key = groupBy.map((c) => JSON.stringify(row[c])).join("|");
                if (groups[key] == null) {
                    groups[key] = { keyValues: {}, rows: [] };
                    for (let j = 0; j < groupBy.length; j++) {
                        groups[key].keyValues[groupBy[j]] = row[groupBy[j]];
                    }
                }
                groups[key].rows.push(row);
            }
            const ret = [];
            for (const key in groups) {
                const g = groups[key];
                const out = Object.assign({}, g.keyValues);
                for (const aggName in aggregates) {
                    const agg = aggregates[aggName];
                    out[aggName] = _aggregate(g.rows, agg.fn, agg.col);
                }
                ret.push(out);
            }
            return ret;
        };

        // 集計関数(count, sum, avg, min, max)を計算する.
        const _aggregate = function (rows, fn, col) {
            if (fn === "count") {
                return rows.length;
            }
            const values = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v));
            if (values.length === 0) {
                return (fn === "sum") ? 0 : null;
            }
            switch (fn) {
                case "sum": return values.reduce((a, b) => a + b, 0);
                case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
                case "min": return Math.min.apply(null, values);
                case "max": return Math.max.apply(null, values);
                default: throw new Error("Unsupported aggregate function: " + fn);
            }
        };

        // SELECT.
        // tableName 対象のテーブル名を設定します.
        // query.where { カラム名: 条件 } (省略可、全件対象).
        // query.orderBy { カラム名: "asc"|"desc" } (省略可).
        // query.offset 読み飛ばし件数(省略可).
        // query.limit 取得件数上限(省略可).
        // query.columns 取得するカラム名配列(省略可、省略時は全カラム).
        // query.groupBy グルーピング対象カラム名配列(省略可).
        // query.aggregates 集計定義(省略可、groupByと併用).
        // 戻り値: 行データ(オブジェクト)の配列、またはgroupBy指定時は集計結果配列.
        const select = async function (tableName, query) {
            query = query || {};
            const schema = await _loadSchema(tableName);
            let rows = await _loadRows(tableName);

            if (query.where != null) {
                rows = rows.filter((r) => _matchesWhere(schema, r, query.where));
            }

            if (query.groupBy != null) {
                return _groupAndAggregate(rows, query.groupBy, query.aggregates || {});
            }

            const orderByKeys = Object.keys(query.orderBy || {});
            if (orderByKeys.length > 0) {
                const col = orderByKeys[0];
                const desc = query.orderBy[col] === "desc";
                rows = rows.slice().sort((a, b) => {
                    if (a[col] < b[col]) return desc ? 1 : -1;
                    if (a[col] > b[col]) return desc ? -1 : 1;
                    return 0;
                });
            }

            const offset = query.offset | 0;
            if (offset > 0) {
                rows = rows.slice(offset);
            }
            if (query.limit != null) {
                rows = rows.slice(0, query.limit | 0);
            }

            rows = rows.map((r) => _applyDateConversion(schema, r));

            if (query.columns != null) {
                rows = rows.map((r) => {
                    const out = {};
                    for (let i = 0; i < query.columns.length; i++) {
                        out[query.columns[i]] = r[query.columns[i]];
                    }
                    return out;
                });
            }
            return rows;
        };

        // UPDATE.
        // tableName 対象のテーブル名を設定します.
        // query.where 更新対象を絞り込む条件({カラム名: 条件}、省略時は全件).
        // patch 更新するカラムの部分オブジェクトを設定します.
        // 戻り値: 更新件数(number)が返却されます.
        const update = async function (tableName, query, patch) {
            query = query || {};
            const schema = await _loadSchema(tableName);
            const rows = await _loadRows(tableName);
            let cnt = 0;
            for (let i = 0; i < rows.length; i++) {
                if (_matchesWhere(schema, rows[i], query.where)) {
                    const merged = Object.assign({}, rows[i], patch);
                    if (patch && patch instanceof Date === false) {
                        for (const colName in schema.columns) {
                            const def = schema.columns[colName];
                            if (def.type === "date" && merged[colName] instanceof Date) {
                                merged[colName] = merged[colName].getTime();
                            }
                        }
                    }
                    rows[i] = merged;
                    cnt++;
                }
            }
            await _saveRows(tableName, rows);
            return cnt;
        };

        // DELETE.
        // tableName 対象のテーブル名を設定します.
        // query.where 削除対象を絞り込む条件({カラム名: 条件}、省略時は全件).
        // 戻り値: 削除件数(number)が返却されます.
        const del = async function (tableName, query) {
            query = query || {};
            const schema = await _loadSchema(tableName);
            const rows = await _loadRows(tableName);
            const remaining = rows.filter((r) => !_matchesWhere(schema, r, query.where));
            const cnt = rows.length - remaining.length;
            await _saveRows(tableName, remaining);
            return cnt;
        };

        return {
            createTable: createTable,
            dropTable: dropTable,
            describeTable: describeTable,
            insert: insert,
            select: select,
            update: update,
            delete: del
        };
    };
})();
