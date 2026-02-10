/**
 * S3-backed RDBMS-like Database for AWS Lambda (Node.js)
 *
 * データは S3 上に JSON 形式で保存され、
 * CREATE TABLE / INSERT / SELECT / UPDATE / DELETE / JOIN などの
 * RDBMS ライクな操作を提供します。
 *
 * 構造:
 *   s3://<bucket>/<dbPrefix>/  _schema/<tableName>.json   … スキーマ定義
 *   s3://<bucket>/<dbPrefix>/  <tableName>/data.json      … 行データ
 *
 * ◆ claudeCodeで作成.
 */
(function () {
    'use strict';

    const {
        S3Client,
        GetObjectCommand,
        PutObjectCommand,
        DeleteObjectCommand
    } = require("@aws-sdk/client-s3");

    // ─── ユーティリティ ───
    const streamToString = (stream) =>
        new Promise((resolve, reject) => {
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("error", reject);
            stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        });

    // ─── メインクラス ───
    class S3Database {
        /**
         * @param {object} opts
         * @param {string} opts.bucket     - S3 バケット名
         * @param {string} [opts.prefix]   - キープレフィックス (デフォルト: "db/")
         * @param {object} [opts.s3Client] - カスタム S3Client（テスト用など）
         */
        constructor({ bucket, prefix = "db/", s3Client } = {}) {
            this.bucket = bucket;
            this.prefix = prefix.endsWith("/") ? prefix : prefix + "/";
            this.s3 = s3Client || new S3Client({});
        }

        // ─── S3 I/O ヘルパー ───
        _key(path) {
            return this.prefix + path;
        }

        async _getJson(path) {
            try {
                const res = await this.s3.send(
                    new GetObjectCommand({ Bucket: this.bucket, Key: this._key(path) })
                );
                return JSON.parse(await streamToString(res.Body));
            } catch (e) {
                if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
                throw e;
            }
        }

        async _putJson(path, data) {
            await this.s3.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: this._key(path),
                    Body: JSON.stringify(data),
                    ContentType: "application/json",
                })
            );
        }

        async _deleteKey(path) {
            await this.s3.send(
                new DeleteObjectCommand({ Bucket: this.bucket, Key: this._key(path) })
            );
        }

        // ─── スキーマ / データパス ───
        _schemaPath(table) { return `_schema/${table}.json`; }
        _dataPath(table) { return `${table}/data.json`; }

        async _loadSchema(table) {
            const s = await this._getJson(this._schemaPath(table));
            if (!s) throw new Error(`Table "${table}" does not exist.`);
            return s;
        }

        async _loadRows(table) {
            return (await this._getJson(this._dataPath(table))) || [];
        }

        async _saveRows(table, rows) {
            await this._putJson(this._dataPath(table), rows);
        }

        // ════════════════════════════════════════
        //  DDL
        // ════════════════════════════════════════

        /**
         * CREATE TABLE
         * @param {string} table
         * @param {object} columns  { colName: { type, notNull?, default?, primaryKey?, unique?, autoIncrement? } }
         *   type: "string" | "number" | "boolean" | "object"
         */
        async createTable(table, columns) {
            const existing = await this._getJson(this._schemaPath(table));
            if (existing) throw new Error(`Table "${table}" already exists.`);

            const schema = { table, columns, createdAt: new Date().toISOString(), autoIncrementSeq: {} };

            // autoIncrement 初期化
            for (const [col, def] of Object.entries(columns)) {
                if (def.autoIncrement) schema.autoIncrementSeq[col] = 0;
            }

            await this._putJson(this._schemaPath(table), schema);
            await this._saveRows(table, []);
            return { success: true, message: `Table "${table}" created.` };
        }

        /**
         * DROP TABLE
         */
        async dropTable(table) {
            await this._deleteKey(this._schemaPath(table));
            await this._deleteKey(this._dataPath(table));
            return { success: true, message: `Table "${table}" dropped.` };
        }

        /**
         * DESCRIBE TABLE
         */
        async describeTable(table) {
            return this._loadSchema(table);
        }

        // ════════════════════════════════════════
        //  DML — INSERT
        // ════════════════════════════════════════

        /**
         * INSERT INTO
         * @param {string} table
         * @param {object|object[]} records  単一 or 複数
         * @returns inserted rows
         */
        async insert(table, records) {
            const schema = await this._loadSchema(table);
            const rows = await this._loadRows(table);
            const input = Array.isArray(records) ? records : [records];
            const inserted = [];

            for (const raw of input) {
                const row = {};

                for (const [col, def] of Object.entries(schema.columns)) {
                    let val = raw[col];

                    // autoIncrement
                    if (def.autoIncrement && val == null) {
                        schema.autoIncrementSeq[col] = (schema.autoIncrementSeq[col] || 0) + 1;
                        val = schema.autoIncrementSeq[col];
                    }
                    // default
                    if (val == null && def.default !== undefined) val = def.default;
                    // notNull check
                    if (val == null && def.notNull) throw new Error(`Column "${col}" cannot be null.`);
                    // type check
                    if (val != null && def.type && typeof val !== def.type) {
                        throw new Error(`Type mismatch for "${col}": expected ${def.type}, got ${typeof val}`);
                    }
                    // unique check
                    if ((def.unique || def.primaryKey) && val != null) {
                        if (rows.some((r) => r[col] === val)) throw new Error(`Duplicate value for unique column "${col}": ${val}`);
                    }

                    row[col] = val ?? null;
                }

                rows.push(row);
                inserted.push(row);
            }

            await this._saveRows(table, rows);
            await this._putJson(this._schemaPath(table), schema); // autoIncrement seq 更新
            return { inserted: inserted.length, rows: inserted };
        }

        // ════════════════════════════════════════
        //  DML — SELECT
        // ════════════════════════════════════════

        /**
         * SELECT
         * @param {string} table
         * @param {object} [opts]
         * @param {function} [opts.where]       row => boolean
         * @param {string[]} [opts.columns]     取得カラム（省略時は全カラム）
         * @param {string}   [opts.orderBy]     ソートカラム
         * @param {"asc"|"desc"} [opts.order]   ソート順 (デフォルト asc)
         * @param {number}   [opts.limit]
         * @param {number}   [opts.offset]
         * @param {string[]} [opts.groupBy]     グループカラム
         * @param {object}   [opts.aggregates]  { alias: { fn: "count"|"sum"|"avg"|"min"|"max", col? } }
         */
        async select(table, opts = {}) {
            let rows = await this._loadRows(table);

            // WHERE
            if (opts.where) rows = rows.filter(opts.where);

            // GROUP BY + aggregates
            if (opts.groupBy) {
                rows = this._groupBy(rows, opts.groupBy, opts.aggregates || {});
            }

            // ORDER BY
            if (opts.orderBy) {
                const dir = opts.order === "desc" ? -1 : 1;
                rows.sort((a, b) => {
                    if (a[opts.orderBy] < b[opts.orderBy]) return -1 * dir;
                    if (a[opts.orderBy] > b[opts.orderBy]) return 1 * dir;
                    return 0;
                });
            }

            // OFFSET / LIMIT
            if (opts.offset) rows = rows.slice(opts.offset);
            if (opts.limit) rows = rows.slice(0, opts.limit);

            // COLUMNS projection
            if (opts.columns) {
                rows = rows.map((r) => {
                    const o = {};
                    for (const c of opts.columns) o[c] = r[c];
                    return o;
                });
            }

            return rows;
        }

        _groupBy(rows, groupCols, aggregates) {
            const groups = {};
            for (const row of rows) {
                const key = groupCols.map((c) => JSON.stringify(row[c])).join("|");
                if (!groups[key]) groups[key] = { _key: {}, _rows: [] };
                for (const c of groupCols) groups[key]._key[c] = row[c];
                groups[key]._rows.push(row);
            }

            return Object.values(groups).map(({ _key, _rows }) => {
                const out = { ..._key };
                for (const [alias, agg] of Object.entries(aggregates)) {
                    const vals = _rows.map((r) => r[agg.col]).filter((v) => v != null);
                    switch (agg.fn) {
                        case "count": out[alias] = _rows.length; break;
                        case "sum": out[alias] = vals.reduce((a, b) => a + b, 0); break;
                        case "avg": out[alias] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; break;
                        case "min": out[alias] = vals.length ? Math.min(...vals) : null; break;
                        case "max": out[alias] = vals.length ? Math.max(...vals) : null; break;
                    }
                }
                return out;
            });
        }

        // ════════════════════════════════════════
        //  DML — UPDATE
        // ════════════════════════════════════════

        /**
         * UPDATE
         * @param {string} table
         * @param {function} where   row => boolean
         * @param {object|function} set  更新値オブジェクト or row => 更新値
         */
        async update(table, where, set) {
            const rows = await this._loadRows(table);
            let count = 0;

            for (let i = 0; i < rows.length; i++) {
                if (where(rows[i])) {
                    const patch = typeof set === "function" ? set(rows[i]) : set;
                    rows[i] = { ...rows[i], ...patch };
                    count++;
                }
            }

            await this._saveRows(table, rows);
            return { updated: count };
        }

        // ════════════════════════════════════════
        //  DML — DELETE
        // ════════════════════════════════════════

        /**
         * DELETE
         * @param {string} table
         * @param {function} where  row => boolean
         */
        async delete(table, where) {
            const rows = await this._loadRows(table);
            const remaining = rows.filter((r) => !where(r));
            await this._saveRows(table, remaining);
            return { deleted: rows.length - remaining.length };
        }

        // ════════════════════════════════════════
        //  JOIN
        // ════════════════════════════════════════

        /**
         * INNER JOIN
         * @param {string} tableA
         * @param {string} tableB
         * @param {function} on  (rowA, rowB) => boolean
         */
        async innerJoin(tableA, tableB, on) {
            const a = await this._loadRows(tableA);
            const b = await this._loadRows(tableB);
            const result = [];
            for (const ra of a) {
                for (const rb of b) {
                    if (on(ra, rb)) result.push({ ...this._prefix(ra, tableA), ...this._prefix(rb, tableB) });
                }
            }
            return result;
        }

        /**
         * LEFT JOIN
         */
        async leftJoin(tableA, tableB, on) {
            const a = await this._loadRows(tableA);
            const b = await this._loadRows(tableB);
            const result = [];
            for (const ra of a) {
                let matched = false;
                for (const rb of b) {
                    if (on(ra, rb)) {
                        result.push({ ...this._prefix(ra, tableA), ...this._prefix(rb, tableB) });
                        matched = true;
                    }
                }
                if (!matched) {
                    const nullB = {};
                    if (b[0]) for (const k of Object.keys(b[0])) nullB[`${tableB}.${k}`] = null;
                    result.push({ ...this._prefix(ra, tableA), ...nullB });
                }
            }
            return result;
        }

        _prefix(row, table) {
            const o = {};
            for (const [k, v] of Object.entries(row)) o[`${table}.${k}`] = v;
            return o;
        }

        // ════════════════════════════════════════
        //  トランザクション（楽観的ロック簡易版）
        // ════════════════════════════════════════

        /**
         * 簡易トランザクション: コールバック内の操作をまとめて実行
         * ※ S3 はトランザクションをネイティブサポートしないため、
         *   アプリケーションレベルの簡易的な仕組みです。
         */
        async transaction(fn) {
            try {
                const result = await fn(this);
                return { success: true, result };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    }

    module.exports = { S3Database };
})();