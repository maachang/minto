///////////////////////////////////////////////
// ページネーション＆カーソル検索ヘルパー (paginate.js).
//
// s3IndexTable, s3MasterTable, memoryTable, 通常配列に対応.
//
// 1. カーソル式ページング (S3 StartAfter 直結 / Base64URL 不透明トークン)
//    何万件あっても1ページ目と同等の高速・1LIST(最安コスト)で続きを取得.
//    リアルタイム更新によるデータの重複・抜けを防止.
//
// 2. オフセット式ページング (ページ番号指定)
//    page, offset による全件数・総ページ数を含むページネーション.
//
// 3. URL / リンク生成ヘルパー
//    SSR(JHTML)やフロントエンド向けのクエリパラメータURL生成.
///////////////////////////////////////////////
(function () {
    'use strict';

    // デフォルト・最大取得件数.
    const _DEF_LIMIT = 20;
    const _MAX_LIMIT = 100;

    // s3IndexTableモジュール (遅延参照).
    let _s3IndexTable = null;
    const _getS3IndexTable = function () {
        if (_s3IndexTable == null) {
            try {
                _s3IndexTable = typeof $loadLib === "function" ? $loadLib("s3IndexTable.js") : require("./s3IndexTable.js");
            } catch (e) {
                _s3IndexTable = null;
            }
        }
        return _s3IndexTable;
    };

    // Base64URLエンコード (URL-Safe, パディング除去).
    const encodeCursor = function (cursorObj) {
        if (!cursorObj || typeof cursorObj !== "object") return null;
        try {
            const json = JSON.stringify(cursorObj);
            return Buffer.from(json, "utf-8").toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
        } catch (e) {
            return null;
        }
    };

    // Base64URLデコード.
    const decodeCursor = function (cursorStr) {
        if (!cursorStr || typeof cursorStr !== "string") return null;
        try {
            let base64 = cursorStr.replace(/-/g, "+").replace(/_/g, "/");
            const pad = base64.length % 4;
            if (pad === 2) base64 += "==";
            else if (pad === 3) base64 += "=";
            else if (pad === 1) return null;
            const json = Buffer.from(base64, "base64").toString("utf-8");
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    };

    // 配列内アイテムのID値を取得 (id, _id, rowId, seqId 等).
    const _getItemId = function (item, idKey) {
        if (!item || typeof item !== "object") return null;
        if (idKey && item[idKey] !== undefined) return item[idKey];
        if (item.id !== undefined) return item.id;
        if (item._id !== undefined) return item._id;
        if (item.rowId !== undefined) return item.rowId;
        if (item._rowId !== undefined) return item._rowId;
        if (item.seqId !== undefined) return item.seqId;
        if (item.code !== undefined) return item.code;
        if (item.key !== undefined) return item.key;
        const keys = Object.keys(item);
        if (keys.length > 0) return item[keys[0]];
        return null;
    };

    // 配列のインメモリソート.
    const _sortArray = function (arr, orderBy) {
        if (!orderBy || typeof orderBy !== "object") return arr;
        const keys = Object.keys(orderBy);
        if (keys.length === 0) return arr;
        const col = keys[0];
        const desc = orderBy[col] === "desc";
        const copy = arr.slice();
        copy.sort(function (a, b) {
            const av = a[col];
            const bv = b[col];
            if (av < bv) return desc ? 1 : -1;
            if (av > bv) return desc ? -1 : 1;
            return 0;
        });
        return copy;
    };

    // 配列に対するカーソル/オフセットページネーション処理.
    const _paginateArray = function (items, options) {
        options = options || {};
        let limit = parseInt(options.limit) || _DEF_LIMIT;
        if (limit <= 0) limit = _DEF_LIMIT;
        if (limit > _MAX_LIMIT) limit = _MAX_LIMIT;

        const idKey = options.idKey;
        const sorted = _sortArray(items, options.orderBy);

        // ページ番号/オフセットが明示指定されている場合
        const isOffsetMode = options.page != null || options.offset != null;

        if (isOffsetMode && !options.cursor) {
            const page = options.page != null ? Math.max(1, parseInt(options.page) || 1) : null;
            const offset = options.offset != null ? Math.max(0, parseInt(options.offset) || 0) : (page != null ? (page - 1) * limit : 0);
            const totalCount = sorted.length;
            const totalPages = Math.ceil(totalCount / limit);
            const currentPage = page != null ? page : Math.floor(offset / limit) + 1;

            const resultItems = sorted.slice(offset, offset + limit);

            return {
                items: resultItems,
                count: resultItems.length,
                totalCount: totalCount,
                totalPages: totalPages,
                currentPage: currentPage,
                limit: limit,
                hasNext: offset + limit < totalCount,
                hasPrev: offset > 0
            };
        }

        // カーソル方式 (デフォルト または options.cursor 指定時)
        let startIndex = 0;
        if (options.cursor) {
            const cursorData = typeof options.cursor === "string" ? decodeCursor(options.cursor) : options.cursor;
            if (cursorData && (cursorData.id !== undefined || cursorData.v !== undefined)) {
                const targetId = cursorData.id;
                for (let i = 0; i < sorted.length; i++) {
                    const curId = _getItemId(sorted[i], idKey);
                    if (targetId != null && curId != null && String(curId) === String(targetId)) {
                        startIndex = i + 1;
                        break;
                    }
                }
            }
        }

        const sliced = sorted.slice(startIndex, startIndex + limit + 1);
        const hasNext = sliced.length > limit;
        const resultItems = hasNext ? sliced.slice(0, limit) : sliced;
        const lastItem = resultItems.length > 0 ? resultItems[resultItems.length - 1] : null;

        let nextCursor = null;
        if (hasNext && lastItem) {
            const lastId = _getItemId(lastItem, idKey);
            nextCursor = encodeCursor({
                id: lastId,
                v: options.orderBy ? lastItem[Object.keys(options.orderBy)[0]] : undefined
            });
        }

        return {
            items: resultItems,
            count: resultItems.length,
            hasNext: hasNext,
            hasPrev: startIndex > 0,
            nextCursor: nextCursor,
            prevCursor: null
        };
    };

    // 統合ページネーションクエリ実行.
    // db: s3IndexTable / s3MasterTable インスタンス、または 配列
    // tableNameOrOptions: テーブル名(string) または options(dbが配列の場合)
    // options: { limit, cursor, page, offset, where, orderBy, idKey, ... }
    const query = async function (db, tableNameOrOptions, options) {
        if (!db) {
            throw new Error("db or array source is required.");
        }

        // db が配列の場合
        if (Array.isArray(db)) {
            const opts = typeof tableNameOrOptions === "object" ? tableNameOrOptions : (options || {});
            return _paginateArray(db, opts);
        }

        const tableName = tableNameOrOptions;
        if (typeof tableName !== "string") {
            throw new Error("tableName (string) is required when using a database instance.");
        }

        options = options || {};
        let limit = parseInt(options.limit) || _DEF_LIMIT;
        if (limit <= 0) limit = _DEF_LIMIT;
        if (limit > _MAX_LIMIT) limit = _MAX_LIMIT;

        const idKey = options.idKey;

        // A. s3IndexTable (行ファイル型) の場合
        if (db && typeof db.createIndex === "function") {
            const isOffsetMode = (options.page != null || options.offset != null) && !options.cursor;

            // 1. オフセット / ページ番号方式
            if (isOffsetMode) {
                const page = options.page != null ? Math.max(1, parseInt(options.page) || 1) : null;
                const offset = options.offset != null ? Math.max(0, parseInt(options.offset) || 0) : (page != null ? (page - 1) * limit : 0);

                let totalCount = 0;
                if (options.where && typeof db.count === "function") {
                    try {
                        totalCount = await db.count(tableName, options.where);
                    } catch (e) {
                        totalCount = 0;
                    }
                }

                const resultItems = await db.select(tableName, {
                    where: options.where,
                    orderBy: options.orderBy,
                    offset: offset,
                    limit: limit
                });

                if (totalCount === 0 && resultItems.length > 0) {
                    totalCount = resultItems.length;
                }

                const totalPages = Math.ceil(totalCount / limit);
                const currentPage = page != null ? page : Math.floor(offset / limit) + 1;

                return {
                    items: resultItems,
                    count: resultItems.length,
                    totalCount: totalCount,
                    totalPages: totalPages,
                    currentPage: currentPage,
                    limit: limit,
                    hasNext: offset + limit < totalCount,
                    hasPrev: offset > 0
                };
            }

            // 2. カーソル方式 (デフォルト)
            const cursorData = typeof options.cursor === "string" ? decodeCursor(options.cursor) : options.cursor;
            const whereQuery = Object.assign({}, options.where);

            const fetchLimit = limit + 1;
            const selectQuery = {
                where: whereQuery,
                orderBy: options.orderBy,
                limit: fetchLimit
            };

            if (cursorData) {
                if (cursorData.startAfterKey) {
                    selectQuery.startAfterKey = cursorData.startAfterKey;
                } else if (cursorData.startAfter) {
                    selectQuery.startAfter = cursorData.startAfter;
                }
            }

            const rawRows = await db.select(tableName, selectQuery);

            let rows = rawRows;
            if (cursorData && cursorData.id != null && !cursorData.startAfterKey && !cursorData.startAfter) {
                let cutIdx = 0;
                for (let i = 0; i < rawRows.length; i++) {
                    const curId = _getItemId(rawRows[i], idKey);
                    if (curId != null && String(curId) === String(cursorData.id)) {
                        cutIdx = i + 1;
                        break;
                    }
                }
                if (cutIdx > 0) {
                    rows = rawRows.slice(cutIdx);
                }
            }

            const hasNext = rows.length > limit;
            const resultItems = hasNext ? rows.slice(0, limit) : rows;
            const lastItem = resultItems.length > 0 ? resultItems[resultItems.length - 1] : null;

            let nextCursor = null;
            if (hasNext && lastItem) {
                const lastId = _getItemId(lastItem, idKey);
                const sortCol = options.orderBy ? Object.keys(options.orderBy)[0] : (options.where ? Object.keys(options.where)[0] : null);

                let startAfterKey = null;
                try {
                    const desc = await db.describeTable(tableName);
                    const s3Mod = _getS3IndexTable();
                    if (desc && desc.indexes && sortCol && desc.indexes[sortCol] && s3Mod) {
                        const cols = desc.indexes[sortCol];
                        const parts = [];
                        for (let i = 0; i < cols.length; i++) {
                            const colDef = desc.columns[cols[i]];
                            parts.push(s3Mod.encodeValue(colDef.type, lastItem[cols[i]]));
                        }
                        const rowId = lastItem._rowId || lastId;
                        startAfterKey = parts.join("!") + "!" + rowId;
                    }
                } catch (e) {
                    // ignore
                }

                nextCursor = encodeCursor({
                    idx: sortCol,
                    id: lastId,
                    startAfterKey: startAfterKey,
                    v: sortCol && lastItem[sortCol] !== undefined ? lastItem[sortCol] : undefined
                });
            }

            return {
                items: resultItems,
                count: resultItems.length,
                hasNext: hasNext,
                hasPrev: options.cursor != null,
                nextCursor: nextCursor,
                prevCursor: null
            };
        }

        // B. s3MasterTable またはその他 (全件インメモリ型)
        if (db && typeof db.select === "function") {
            const allRows = await db.select(tableName, {
                where: options.where,
                orderBy: options.orderBy
            });
            return _paginateArray(allRows, options);
        }

        throw new Error("Unsupported db instance type.");
    };

    // クエリURL構築ヘルパー.
    // baseUrl: "/items" または "/items?category=news"
    // paramValue: カーソル文字列 または ページ番号
    // paramName: パラメータ名 (デフォルト: paramValueが数値なら"page"、文字列なら"cursor")
    const url = function (baseUrl, paramValue, paramName) {
        if (!baseUrl) return "";
        if (paramValue == null || paramValue === "") return baseUrl;

        if (!paramName) {
            paramName = typeof paramValue === "number" ? "page" : "cursor";
        }

        const qIdx = baseUrl.indexOf("?");
        let path = baseUrl;
        let queryStr = "";
        if (qIdx !== -1) {
            path = baseUrl.substring(0, qIdx);
            queryStr = baseUrl.substring(qIdx + 1);
        }

        const params = new URLSearchParams(queryStr);
        params.set(paramName, "" + paramValue);

        return path + "?" + params.toString();
    };

    exports.encodeCursor = encodeCursor;
    exports.decodeCursor = decodeCursor;
    exports.query = query;
    exports.paginate = query;
    exports.url = url;
})();
