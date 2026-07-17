///////////////////////////////////////////////
// S3行ファイル型データベース(s3IndexTable).
//
// AIメモ:
// 詳細設計は docs/s3-row-store-design.md を参照。要点のみ記載する。
//
// - 1行=1ファイル(table/{table名}/{行ファイル名}).
//   行ファイル名は "UnixTime_ナノ秒_LambdaID_乱数" で一意性と時系列
//   ソート性を両立させている. 外部からこの物理名を安定参照しては
//   いけない(updateの度に変わるため). 必ずインデックス経由で解決する.
// - 検索は事前定義したインデックス経由のみ. インデックスは
//   index/{table名}/{col1}!{col2}!.../{value1}!{value2}!.../{行ファイル名}
//   という0バイトファイルで、HEAD/LISTのみで存在確認・検索が完結する.
// - 複合インデックスは先頭カラムのみ範囲検索可(RDBMSのB-tree複合
//   インデックスと同じ制約). 後続カラムは完全一致(eq/in)のみ.
// - テーブル定義(カラム・インデックス定義)は、テーブル単位ファイルではなく
//   {prefix}table.json という1つの集約ファイルにテーブル名をキーにして
//   まとめて保持する(show tables的な一覧参照・キャッシュ効率のため).
// - delete は行ファイルを即時DeleteObjectするだけで、インデックスの
//   後始末はしない. 読み取り時にインデックス経由でGetObjectして404に
//   なったら、その場でそのインデックスエントリだけ削除する(自己修復).
//   tombstone+Vacuum方式は「後始末をリクエスト処理の外に出せる」
//   というメリットが無い割に複雑になるため採用していない.
// - backupTable/restoreTable/listBackupsは物理コピー方式(S3のCopyObjectは
//   使わず既存のget/put経由で複製する). backup/{table名}/{backupId}/配下に
//   行データ・インデックス・スキーマをそのまま複製し、複数世代を保持できる.
//   restoreTableは指定世代の内容で現在のテーブルを全置換する(差分マージは
//   しない). listBackupsはdelimiter指定によるCommonPrefixes方式だと
//   s3sdk.jsの_prefix()が末尾スラッシュを除去する影響で区切り位置がずれる
//   (実際に踏んだ不具合)ため、delimiterは使わず全件Listしてキー名から
//   backupId部分を切り出す方式にしている.
// - 数値・日付は固定長バイナリ化+符号ビット反転(整数は符号ビットのみ、
//   浮動小数点は非負なら符号ビットのみ・負なら全ビット反転)してから
//   hexエンコードすることで、辞書順ソート=数値順ソートを実現している.
//   これは実際にNode.jsで検証済み(代表値・負数・Infinity・最小/最大値
//   を含めて数値順と文字列順が一致することを確認済み).
//   ※ 過去に検討した「Number.MAX_SAFE_INTEGERを使った負数変換」は
//     JSの安全な整数範囲(2^53)を超えて精度が崩れ、異なる負数が
//     同じ文字列に衝突するバグがあったため不採用にしている.
// - 文字列はUTF-8バイナリをそのままhex化する(長さプレフィックス等は
//   付与しない). 通常の文字列比較は「先頭バイトから順に比較し、差が
//   出た時点で決まる」だけなので、hex化(1バイト=2文字の固定変換)でも
//   通常の辞書順比較と完全に一致し、gt/ge/lt/le(範囲演算子)も使える.
//   ※ 過去に検討した base64エンコード方式は、標準アルファベットの
//     文字コード順とビット値順が一致しておらず辞書順を保持しないため
//     不採用にしている. また「長さプレフィックスを先頭に付与する」
//     方式も、桁数の少ない文字列が内容によらず常に先に来てしまい
//     通常の辞書順と一致しなくなる(例: 通常は"Ab"<"B"だが、長さ優先だと
//     "B"が先に来て逆転する)ため不採用にしている.
//   ※ インデックス対象の文字列はUTF-8で255バイトまでに制限している
//     (STRING_INDEX_MAX_BYTES). 行データ自体(非インデックスカラム)には
//     制限は無い. なお、いずれの方式でもLIKE検索・部分一致はできない
//     (別途N-gramインデックス等の対応が必要、対象外).
///////////////////////////////////////////////
(function () {
    'use strict';

    // S3の低レベル操作(put/get/delete/list).
    const s3sdk = $loadLib("s3sdk.js");

    // Snowflake ID方式のユニークID発行(autoIncrementの代替).
    const seqId = $loadLib("seqId.js");

    // crypto(行ファイル名のランダム部分生成用).
    const crypto = $require("crypto");

    // NULL値の予約トークン.
    // "~" はhexエンコード(0-9a-f)には出現しない文字なので、
    // 数値・文字列いずれのエンコード結果とも衝突しない.
    const NULL_TOKEN = "~null~";

    // 数値/日付の固定長エンコード後の桁数(8バイト=16hex文字).
    const NUMBER_HEX_LEN = 16;

    // インデックスの区切り文字.
    const SEP = "!";

    ///////////////////////////////////////////////
    // 値のエンコード.
    ///////////////////////////////////////////////

    // インデックス対象文字列のUTF-8バイト数上限.
    // (S3キー長の上限(1024バイト)や、後述のprefix構成要素との兼ね合いで
    //  上限を設ける。行データ自体(非インデックスカラム)には制限は無い。)
    const STRING_INDEX_MAX_BYTES = 255;

    // 文字列をインデックス用にエンコード.
    // UTF-8バイナリをそのままhex化する(長さプレフィックス等は付与しない)。
    // 通常の文字列比較は「先頭バイトから順に比較し、差が出た時点で決まる」
    // だけなので、hex化(1バイト=2文字の固定変換)しても通常の辞書順比較と
    // 完全に一致する。また短い文字列が長い文字列のprefixになっている
    // 場合に短い方が先、という関係もそのまま保たれる(例: "ab" < "abc")。
    // ※ 長さを先頭に付与する方式は、桁数の少ない文字列が内容によらず
    //   常に先に来てしまい通常の辞書順と一致しなくなる
    //  (例: "Ab" と "B" では通常 "Ab" < "B" だが、長さ優先だと "B" が
    //   先に来てしまい逆転する)ため採用しない。
    const encodeString = function (value) {
        if (value == null) {
            return NULL_TOKEN;
        }
        const buf = Buffer.from(String(value), "utf-8");
        if (buf.length > STRING_INDEX_MAX_BYTES) {
            throw new Error("Indexed string value exceeds " +
                STRING_INDEX_MAX_BYTES +
                " bytes (utf-8). Reduce the value length or exclude this column from any index.");
        }
        return buf.toString("hex");
    };

    // 符号付き64bit整数をソート可能なhex文字列にエンコード.
    // 2の補数は符号ビット以外がもともと単調増加のため、
    // 符号ビットのみを反転すれば正しくソート可能になる.
    const encodeInt = function (value) {
        if (value == null) {
            return NULL_TOKEN;
        }
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(BigInt(Math.trunc(Number(value))), 0);
        let bits = buf.readBigUInt64BE(0);
        bits = bits ^ (1n << 63n);
        return bits.toString(16).padStart(NUMBER_HEX_LEN, "0");
    };

    // IEEE754倍精度浮動小数点をソート可能なhex文字列にエンコード.
    // 非負なら符号ビットのみ1に反転、負なら全ビット反転する.
    const encodeFloat = function (value) {
        if (value == null) {
            return NULL_TOKEN;
        }
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(Number(value), 0);
        let bits = buf.readBigUInt64BE(0);
        const SIGN_BIT = 1n << 63n;
        const MASK64 = 0xFFFFFFFFFFFFFFFFn;
        if (bits & SIGN_BIT) {
            bits = (~bits) & MASK64;
        } else {
            bits = bits | SIGN_BIT;
        }
        return bits.toString(16).padStart(NUMBER_HEX_LEN, "0");
    };

    // 真偽値をインデックス用にエンコード.
    const encodeBoolean = function (value) {
        if (value == null) {
            return NULL_TOKEN;
        }
        return (value === true || value === "true") ? "t" : "f";
    };

    // 日付をインデックス用にエンコード(内部的にはUnixTimeミリ秒のint).
    const encodeDate = function (value) {
        if (value == null) {
            return NULL_TOKEN;
        }
        const t = (value instanceof Date) ? value.getTime() : Number(value);
        return encodeInt(t);
    };

    // カラムの型に応じてインデックス用の値エンコードを行う.
    // type カラム型(string, int, float, boolean, date, seqId)を設定します.
    // value エンコード対象の値を設定します.
    // 戻り値: エンコードされた文字列(S3キーセーフ)が返却されます.
    const encodeValue = function (type, value) {
        switch (type) {
            case "string": return encodeString(value);
            case "int": return encodeInt(value);
            case "float": return encodeFloat(value);
            case "boolean": return encodeBoolean(value);
            case "date": return encodeDate(value);
            // seqIdは固定長16桁の小文字hex文字列で、そのままUTF-8バイナリの
            // hex化(encodeString)でも辞書順=生成順(数値順)を保持できる.
            case "seqId": return encodeString(value);
            default:
                throw new Error("Unsupported index column type: " + type);
        }
    };

    // 型が「範囲検索(gt/ge/lt/le)に対応可能か」を判定する.
    // string型もUTF-8バイナリの直接hex化により辞書順を保持するため対応.
    // seqId型も固定長hex文字列のため同様に対応可能.
    // ただしLIKE検索・部分一致は引き続き対象外(N-gram等の別対応が必要).
    const isRangeSupportedType = function (type) {
        return type === "int" || type === "float" ||
            type === "date" || type === "string" || type === "seqId";
    };

    ///////////////////////////////////////////////
    // 行ファイル名の生成.
    ///////////////////////////////////////////////

    // 行ファイル名を生成する({UnixTime}_{ナノ秒}_{LambdaID}_{乱数}).
    // 戻り値: 一意な行ファイル名(文字列)が返却されます.
    const generateRowId = function () {
        const now = Date.now();
        // ナノ秒部分(process.hrtime()はllrtでも動作確認済み).
        const nano = process.hrtime()[1];
        // Lambda実行ID(minto環境なら$requestId()が利用可能).
        let lambdaId = "0";
        if (typeof $requestId === "function") {
            try {
                lambdaId = $requestId();
            } catch (e) {
                lambdaId = "0";
            }
        }
        const rand = crypto.randomBytes(8).toString("hex");
        return now + "_" + nano + "_" + lambdaId + "_" + rand;
    };

    ///////////////////////////////////////////////
    // StreamをStringに変換.
    // (llrtでは for-await-of 構文が動作しない事例があるため
    //  transformToString() を利用する).
    ///////////////////////////////////////////////
    const _streamToString = function (stream) {
        return stream.transformToString("utf-8");
    };

    ///////////////////////////////////////////////
    // hex文字列を1つデクリメントする(範囲検索のStartAfter計算用).
    // 全て "0" の場合は null を返す(それ以上下げられない).
    ///////////////////////////////////////////////
    const _decrementHex = function (hex) {
        let n = BigInt("0x" + hex);
        if (n === 0n) {
            return null;
        }
        n -= 1n;
        return n.toString(16).padStart(hex.length, "0");
    };

    ///////////////////////////////////////////////
    // テーブル操作本体.
    ///////////////////////////////////////////////

    // s3IndexTableオブジェクトを生成する.
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

        // 全テーブルのスキーマ定義を1つにまとめた集約ファイルのprefix/key.
        const _defsPrefix = function () {
            return _basePrefix ? _basePrefix.slice(0, -1) : null;
        };
        const _defsKey = function () {
            return "table.json";
        };

        // 集約ファイルのキャッシュ(1回のLambda実行中のみ有効).
        let _allDefsCache = null;

        // 集約ファイル(全テーブル分のスキーマ定義)を取得する
        // (キャッシュがあればそれを返す。ファイルが存在しない場合は空).
        const _loadAllDefs = async function () {
            if (_allDefsCache != null) {
                return _allDefsCache;
            }
            const res = await s3sdk.get(_bucket, _defsPrefix(), _defsKey(), _s3opts);
            _allDefsCache = (res == null) ? {} : JSON.parse(await _streamToString(res.Body));
            return _allDefsCache;
        };

        // 集約ファイル全体を書き戻す(キャッシュ更新後に呼び出す想定).
        const _saveAllDefs = async function () {
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(),
                JSON.stringify(_allDefsCache), _s3opts);
        };

        // table/{table名}/ のprefixを取得.
        const _tablePrefix = function (tableName) {
            return _basePrefix + "table/" + tableName;
        };

        // index/{table名}/{col1}!{col2}!.../ のprefixを取得.
        const _indexPrefix = function (tableName, columns) {
            return _basePrefix + "index/" + tableName + "/" + columns.join(SEP);
        };

        // backup/{table名}/[{backupId}] のprefixを取得(backupId省略時は
        // 該当テーブルのバックアップ世代一覧のルート).
        const _backupPrefix = function (tableName, backupId) {
            return _basePrefix + "backup/" + tableName +
                (backupId != null ? "/" + backupId : "");
        };

        // テーブル定義を取得(集約ファイルのキャッシュ経由).
        const _loadSchema = async function (tableName) {
            const all = await _loadAllDefs();
            if (all[tableName] == null) {
                throw new Error("Table not found: " + tableName);
            }
            return all[tableName];
        };

        // テーブル作成.
        // tableName 対象のテーブル名を設定します.
        // schema.columns カラム定義({名前: {type, notNull, default}}).
        // schema.indexes インデックス定義({インデックス名: [カラム名, ...]}).
        const createTable = async function (tableName, schema) {
            schema = schema || {};
            const columns = schema.columns || {};
            const indexes = schema.indexes || {};
            // インデックス対象カラムがjson型でないか検証.
            for (const idxName in indexes) {
                const cols = indexes[idxName];
                for (let i = 0; i < cols.length; i++) {
                    const col = columns[cols[i]];
                    if (col == null) {
                        throw new Error("Unknown column in index '" + idxName + "': " + cols[i]);
                    }
                    if (col.type === "json") {
                        throw new Error("json型カラムはインデックス対象にできません: " + cols[i]);
                    }
                }
            }
            const all = await _loadAllDefs();
            if (all[tableName] != null) {
                throw new Error("Table already exists: " + tableName);
            }
            all[tableName] = { columns: columns, indexes: indexes };
            await _saveAllDefs();
            return true;
        };

        // テーブル削除(table/index配下の全オブジェクトを削除).
        // 行数分のDeleteObjectを要するため、想定スケール(1万件程度)を
        // 超える場合は時間がかかる点に注意.
        const dropTable = async function (tableName) {
            // tableディレクトリの全ファイル削除.
            await _removeAllUnder(_tablePrefix(tableName));
            // indexディレクトリの全ファイル削除.
            await _removeAllUnder(_basePrefix + "index/" + tableName);
            // 集約ファイルから該当テーブルの定義を削除.
            const all = await _loadAllDefs();
            delete all[tableName];
            await _saveAllDefs();
            return true;
        };

        // 全テーブル分のテーブル定義を取得する({テーブル名: schema}形式).
        // テーブル管理コマンド(createTable/dropTable/alterTable/alterIndex)が、
        // 現在S3上に存在するテーブル定義を把握するために使用する.
        const listTables = async function () {
            const all = await _loadAllDefs();
            return JSON.parse(JSON.stringify(all));
        };

        // 既存テーブルのカラム定義を丸ごと差し替える(テーブル管理コマンドの
        // alterTable用). indexes定義・行データ・インデックスエントリは一切
        // 変更しない(削除されたカラムは以後selectで除外されるだけで、
        // 既存データはそのまま残る. インデックスの増減はcreateIndex/dropIndex
        // で別途行う).
        // tableName 対象のテーブル名を設定します.
        // columns 差し替え後のカラム定義({名前: {type, notNull, default}})
        //   を設定します.
        const alterColumns = async function (tableName, columns) {
            const schema = await _loadSchema(tableName);
            schema.columns = columns;
            await _saveAllDefs();
            return true;
        };

        // 指定prefix配下の全オブジェクトを削除する(内部ユーティリティ).
        const _removeAllUnder = async function (prefix) {
            let token = undefined;
            do {
                const res = await s3sdk.list(_bucket, prefix,
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    await s3sdk.delete(_bucket, null, contents[i].Key, _s3opts);
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);
        };

        // バックアップ(物理コピー方式。CopyObjectは使わず既存のget/put経由で
        // 複製する). table/{tableName}/(行データ)・index/{tableName}/
        // (インデックスエントリ)・スキーマ定義を、backup/{tableName}/{backupId}/
        // 配下にそのままの構造で複製する(backupIdは実行時のUnixTimeミリ秒。
        // 複数世代を保持でき、世代ごとにディレクトリが分かれる).
        // tableName 対象のテーブル名を設定します.
        // 戻り値: { tableName, backupId, rowCount, indexEntryCount }
        const backupTable = async function (tableName) {
            const schema = await _loadSchema(tableName);
            const backupId = String(Date.now());
            const backupBase = _backupPrefix(tableName, backupId);

            await s3sdk.put(_bucket, backupBase, "schema.json", JSON.stringify(schema), _s3opts);

            let rowCount = 0;
            let token = undefined;
            do {
                const res = await s3sdk.list(_bucket, _tablePrefix(tableName),
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const rowId = contents[i].Key.split("/").pop();
                    const rowRes = await s3sdk.get(_bucket, _tablePrefix(tableName), rowId, _s3opts);
                    if (rowRes == null) {
                        continue;
                    }
                    const body = await _streamToString(rowRes.Body);
                    await s3sdk.put(_bucket, backupBase + "/rows", rowId, body, _s3opts);
                    rowCount++;
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);

            const idxRoot = _basePrefix + "index/" + tableName + "/";
            let indexEntryCount = 0;
            token = undefined;
            do {
                const res = await s3sdk.list(_bucket, idxRoot,
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const relKey = contents[i].Key.substring(idxRoot.length);
                    // インデックスエントリは0バイトファイルのためget不要でそのまま複製.
                    await s3sdk.put(_bucket, backupBase + "/index", relKey, "", _s3opts);
                    indexEntryCount++;
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);

            return { tableName: tableName, backupId: backupId, rowCount: rowCount, indexEntryCount: indexEntryCount };
        };

        // 指定テーブルの既存バックアップ世代(backupId)一覧を、古い順
        // (タイムスタンプ昇順)の文字列配列で返す.
        // AIメモ: delimiter指定によるCommonPrefixes方式は、s3sdk.jsの
        // _prefix()が末尾スラッシュを除去してS3へのPrefixパラメータとして
        // 渡すため、区切り位置が1階層ずれてしまい正しく機能しない
        // (実際にテストで踏んだ不具合). そのためdelimiterは使わず、
        // 対象prefix配下を全件Listしてキー名から直接backupId部分を
        // 切り出す方式にしている.
        // tableName 対象のテーブル名を設定します.
        const listBackups = async function (tableName) {
            const marker = _basePrefix + "backup/" + tableName + "/";
            const backupIds = new Set();
            let token = undefined;
            do {
                const res = await s3sdk.list(_bucket, marker,
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const rest = contents[i].Key.substring(marker.length);
                    backupIds.add(rest.split("/")[0]);
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);
            return Array.from(backupIds).sort();
        };

        // 指定した世代(backupId)の内容で、現在のテーブル(行データ・
        // インデックス・スキーマ)を完全に置き換える(全置換。差分マージは
        // しない). 事前に現在のtable/index配下を全削除してからバックアップの
        // 内容を書き戻す.
        // tableName 対象のテーブル名を設定します.
        // backupId backupTable()が返したバックアップ世代IDを設定します.
        // 戻り値: { tableName, backupId, rowCount, indexEntryCount }
        const restoreTable = async function (tableName, backupId) {
            const backupBase = _backupPrefix(tableName, backupId);
            const schemaRes = await s3sdk.get(_bucket, backupBase, "schema.json", _s3opts);
            if (schemaRes == null) {
                throw new Error("Backup not found: " + tableName + "/" + backupId);
            }
            const schema = JSON.parse(await _streamToString(schemaRes.Body));

            // 現在のtable/index配下を全削除してから復元する(全置換).
            await _removeAllUnder(_tablePrefix(tableName));
            await _removeAllUnder(_basePrefix + "index/" + tableName);

            const rowsRoot = backupBase + "/rows/";
            let rowCount = 0;
            let token = undefined;
            do {
                const res = await s3sdk.list(_bucket, rowsRoot,
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const rowId = contents[i].Key.split("/").pop();
                    const rowRes = await s3sdk.get(_bucket, rowsRoot, rowId, _s3opts);
                    if (rowRes == null) {
                        continue;
                    }
                    const body = await _streamToString(rowRes.Body);
                    await s3sdk.put(_bucket, _tablePrefix(tableName), rowId, body, _s3opts);
                    rowCount++;
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);

            const idxRoot = backupBase + "/index/";
            let indexEntryCount = 0;
            token = undefined;
            do {
                const res = await s3sdk.list(_bucket, idxRoot,
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const relKey = contents[i].Key.substring(idxRoot.length);
                    await s3sdk.put(_bucket, _basePrefix + "index/" + tableName, relKey, "", _s3opts);
                    indexEntryCount++;
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);

            // スキーマも復元時点の内容へ上書きする.
            const all = await _loadAllDefs();
            all[tableName] = schema;
            await _saveAllDefs();

            return { tableName: tableName, backupId: backupId, rowCount: rowCount, indexEntryCount: indexEntryCount };
        };

        // 既存テーブルにインデックスを追加(既存行に対してバックフィルする).
        // tableName 対象のテーブル名を設定します.
        // indexName 追加するインデックス名を設定します.
        // columns インデックス対象のカラム名配列を設定します(先頭が範囲検索対象).
        const createIndex = async function (tableName, indexName, columns) {
            const schema = await _loadSchema(tableName);
            for (let i = 0; i < columns.length; i++) {
                const col = schema.columns[columns[i]];
                if (col == null) {
                    throw new Error("Unknown column: " + columns[i]);
                }
                if (col.type === "json") {
                    throw new Error("json型カラムはインデックス対象にできません: " + columns[i]);
                }
            }
            schema.indexes[indexName] = columns;
            await _saveAllDefs();

            // 既存の全行に対してインデックスエントリをバックフィル.
            let token = undefined;
            do {
                const res = await s3sdk.list(_bucket, _tablePrefix(tableName),
                    Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const rowId = contents[i].Key.split("/").pop();
                    const rowRes = await s3sdk.get(_bucket, _tablePrefix(tableName), rowId, _s3opts);
                    if (rowRes == null) {
                        continue;
                    }
                    const row = JSON.parse(await _streamToString(rowRes.Body));
                    await _writeIndexEntry(tableName, schema, indexName, columns, row, rowId);
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);
            return true;
        };

        // インデックス削除(インデックス定義のみ削除。既存エントリの
        // 一括削除はここでは行わず、自己修復に任せる).
        const dropIndex = async function (tableName, indexName) {
            const schema = await _loadSchema(tableName);
            const columns = schema.indexes[indexName];
            delete schema.indexes[indexName];
            await _saveAllDefs();
            if (columns != null) {
                await _removeAllUnder(_indexPrefix(tableName, columns));
            }
            return true;
        };

        // 1件分のインデックスエントリを作成.
        const _writeIndexEntry = async function (tableName, schema, indexName, columns, row, rowId) {
            const parts = [];
            for (let i = 0; i < columns.length; i++) {
                const col = schema.columns[columns[i]];
                parts.push(encodeValue(col.type, row[columns[i]]));
            }
            const entryKey = parts.join(SEP) + SEP + rowId;
            await s3sdk.put(_bucket, _indexPrefix(tableName, columns), entryKey, "", _s3opts);
        };

        // 1行分の全インデックスエントリを作成.
        const _writeAllIndexes = async function (tableName, schema, row, rowId) {
            for (const idxName in schema.indexes) {
                await _writeIndexEntry(tableName, schema, idxName, schema.indexes[idxName], row, rowId);
            }
        };

        // カラム定義に従って、seqId・not null・defaultを適用した行データを作る.
        const _applyColumnDefaults = function (schema, row) {
            const ret = {};
            for (const colName in schema.columns) {
                const col = schema.columns[colName];
                let value = row[colName];
                if (col.type === "seqId" && value == null) {
                    value = seqId.generate();
                }
                if (value == null) {
                    if (col.default !== undefined) {
                        value = (typeof col.default === "function") ? col.default() : col.default;
                    }
                }
                if (value == null && col.notNull === true) {
                    throw new Error("Column '" + colName + "' must not be null.");
                }
                if (value !== undefined) {
                    ret[colName] = (col.type === "date" && value instanceof Date)
                        ? value.getTime() : value;
                }
            }
            return ret;
        };

        // INSERT.
        // tableName 対象のテーブル名を設定します.
        // row 挿入する行データ(オブジェクト)を設定します.
        // 戻り値: 生成された行ファイル名(内部識別子)が返却されます.
        const insert = async function (tableName, row) {
            const schema = await _loadSchema(tableName);
            const data = _applyColumnDefaults(schema, row);
            const rowId = generateRowId();
            await s3sdk.put(_bucket, _tablePrefix(tableName), rowId,
                JSON.stringify(data), _s3opts);
            await _writeAllIndexes(tableName, schema, data, rowId);
            return rowId;
        };

        // 指定条件(1インデックス分)にマッチする行ファイル名の配列を取得する.
        const _scanIndex = async function (tableName, schema, indexName, cond) {
            const columns = schema.indexes[indexName];
            if (columns == null) {
                throw new Error("Unknown index: " + indexName);
            }
            const leadCol = columns[0];
            const leadType = schema.columns[leadCol].type;
            const leadCond = cond[leadCol];

            // 後続カラム(等価一致のみ)の期待エンコード値を計算.
            const trailExpected = [];
            for (let i = 1; i < columns.length; i++) {
                const col = columns[i];
                const c = cond[col];
                if (c == null) {
                    trailExpected.push(null); // 未指定(絞り込まない).
                    continue;
                }
                const v = (c != null && typeof c === "object" && !(c instanceof Date) && c.eq !== undefined)
                    ? c.eq : c;
                trailExpected.push(encodeValue(schema.columns[col].type, v));
            }

            // 先頭カラムがinの場合は値ごとに個別スキャンしてunion.
            if (leadCond != null && typeof leadCond === "object" && Array.isArray(leadCond.in)) {
                const ids = [];
                for (let i = 0; i < leadCond.in.length; i++) {
                    const sub = {};
                    sub[leadCol] = leadCond.in[i];
                    for (let j = 1; j < columns.length; j++) {
                        if (cond[columns[j]] !== undefined) {
                            sub[columns[j]] = cond[columns[j]];
                        }
                    }
                    const part = await _scanIndex(tableName, schema, indexName, sub);
                    for (let k = 0; k < part.length; k++) {
                        ids.push(part[k]);
                    }
                }
                return ids;
            }

            // 先頭カラムの条件を解析(eq or 範囲 or 未指定=全件).
            let eqValue, gteValue, gtValue, lteValue, ltValue;
            let hasRange = false;
            if (leadCond == null) {
                // 条件無し=全件スキャン.
            } else if (typeof leadCond !== "object" || leadCond instanceof Date) {
                eqValue = leadCond;
            } else if (leadCond.eq !== undefined) {
                eqValue = leadCond.eq;
            } else {
                if (leadCond.gte !== undefined) { gteValue = leadCond.gte; hasRange = true; }
                if (leadCond.gt !== undefined) { gtValue = leadCond.gt; hasRange = true; }
                if (leadCond.lte !== undefined) { lteValue = leadCond.lte; hasRange = true; }
                if (leadCond.lt !== undefined) { ltValue = leadCond.lt; hasRange = true; }
            }
            if (hasRange && !isRangeSupportedType(leadType)) {
                throw new Error("Column type '" + leadType +
                    "' does not support range queries (gt/ge/lt/le). Use eq/in instead.");
            }

            const basePrefix = _indexPrefix(tableName, columns);
            let listPrefix = basePrefix;
            let startAfter = undefined;
            let upperBoundEnc = null;
            let upperInclusive = true;

            if (eqValue !== undefined) {
                listPrefix = basePrefix + "/" + encodeValue(leadType, eqValue) + SEP;
            } else if (hasRange) {
                if (gteValue !== undefined) {
                    const dec = _decrementHex(encodeValue(leadType, gteValue));
                    startAfter = dec != null ? (basePrefix + "/" + dec) : undefined;
                } else if (gtValue !== undefined) {
                    // "!" の直後に非常に大きい文字を置くことで、
                    // gtValueと同じ先頭値を持つ実エントリより必ず
                    // 後ろにStartAfterが来るようにし、gtValue自身を
                    // 除外する(排他的下限)扱いにする.
                    startAfter = basePrefix + "/" + encodeValue(leadType, gtValue) +
                        SEP + "￿";
                }
                if (lteValue !== undefined) {
                    upperBoundEnc = encodeValue(leadType, lteValue);
                    upperInclusive = true;
                } else if (ltValue !== undefined) {
                    upperBoundEnc = encodeValue(leadType, ltValue);
                    upperInclusive = false;
                }
            }

            const ids = [];
            let token = undefined;
            outer:
            do {
                const res = await s3sdk.list(_bucket, listPrefix,
                    Object.assign({}, _s3opts, {
                        continuationToken: token, maxKey: 1000,
                        startAfter: token == null ? startAfter : undefined
                    }));
                const contents = res.Contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const name = contents[i].Key.split("/").pop();
                    const segs = name.split(SEP);
                    const rowId = segs[segs.length - 1];
                    const leadEnc = segs[0];
                    if (upperBoundEnc != null) {
                        if (upperInclusive ? (leadEnc > upperBoundEnc) : (leadEnc >= upperBoundEnc)) {
                            break outer;
                        }
                    }
                    // 後続カラムの一致確認.
                    let matched = true;
                    for (let j = 0; j < trailExpected.length; j++) {
                        if (trailExpected[j] != null && segs[j + 1] !== trailExpected[j]) {
                            matched = false;
                            break;
                        }
                    }
                    if (matched) {
                        ids.push(rowId);
                    }
                }
                token = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (token);
            return ids;
        };

        // where条件(複数インデックス可)から、マッチする行ファイル名の
        // 積集合(Set)を取得する.
        const _resolveCandidates = async function (tableName, schema, where) {
            const idxNames = Object.keys(where || {});
            if (idxNames.length === 0) {
                throw new Error("where must reference at least one index.");
            }
            let result = null;
            for (let i = 0; i < idxNames.length; i++) {
                const ids = await _scanIndex(tableName, schema, idxNames[i], where[idxNames[i]]);
                const idSet = new Set(ids);
                if (result == null) {
                    result = idSet;
                } else {
                    for (const id of result) {
                        if (!idSet.has(id)) {
                            result.delete(id);
                        }
                    }
                }
            }
            return result;
        };

        // 行ファイルを取得する。存在しない場合(404相当)はnullを返し、
        // 呼び出し元でインデックスの自己修復に使えるようにする.
        // 戻り値は現在のスキーマ(schema.columns)に定義されたキーのみに
        // 絞り込む(alterTableでカラムが削除された場合、既存の行データ自体は
        // 書き換えないため、ここで現在のスキーマに存在しないカラムを除外する).
        const _getRow = async function (tableName, rowId, schema) {
            const res = await s3sdk.get(_bucket, _tablePrefix(tableName), rowId, _s3opts);
            if (res == null) {
                return null;
            }
            const row = JSON.parse(await _streamToString(res.Body));
            const out = {};
            for (const colName in schema.columns) {
                if (row[colName] !== undefined) {
                    out[colName] = row[colName];
                }
            }
            return out;
        };

        // インデックス経由で取得した行が存在しなかった場合、該当する
        // インデックスエントリを自己修復(削除)する.
        const _healStaleIndex = async function (tableName, schema, rowId) {
            for (const idxName in schema.indexes) {
                const columns = schema.indexes[idxName];
                // rowIdだけでは対象エントリ名が分からないため、
                // 該当行を含む全エントリをrowId一致で検索して削除する.
                let token = undefined;
                do {
                    const res = await s3sdk.list(_bucket, _indexPrefix(tableName, columns),
                        Object.assign({}, _s3opts, { continuationToken: token, maxKey: 1000 }));
                    const contents = res.Contents || [];
                    for (let i = 0; i < contents.length; i++) {
                        const name = contents[i].Key.split("/").pop();
                        if (name.endsWith(SEP + rowId)) {
                            await s3sdk.delete(_bucket, _indexPrefix(tableName, columns), name, _s3opts);
                        }
                    }
                    token = res.IsTruncated ? res.NextContinuationToken : undefined;
                } while (token);
            }
        };

        // SELECT.
        // tableName 対象のテーブル名を設定します.
        // query.where { インデックス名: 条件 } (必須。複数指定でAND).
        // query.orderBy { インデックス名: "asc"|"desc" } (省略可).
        // query.offset 読み飛ばし件数(省略可).
        // query.limit 取得件数上限(省略可).
        // query.groupBy グルーピング対象カラム名配列(省略可).
        // query.aggregates 集計定義(省略可、groupByと併用).
        // 戻り値: 行データ(オブジェクト)の配列、またはgroupBy指定時は集計結果配列.
        const select = async function (tableName, query) {
            query = query || {};
            const schema = await _loadSchema(tableName);
            const candidateSet = await _resolveCandidates(tableName, schema, query.where);
            let ids = Array.from(candidateSet);

            // orderBy処理.
            const orderByKeys = Object.keys(query.orderBy || {});
            if (orderByKeys.length > 0) {
                const idxName = orderByKeys[0];
                const desc = query.orderBy[idxName] === "desc";
                const usedInWhere = query.where && query.where[idxName] != null;
                if (usedInWhere) {
                    // _scanIndexは既に昇順で返しているため、descなら反転する.
                    // (whereで使ったインデックスのidsは既にids配列に反映済み
                    //  だが、複数インデックスAND済みのため順序が保証されない
                    //  場合がある. ここでは単純化のため、再度そのインデックス
                    //  でスキャンして順序を確定させる.)
                    const orderedIds = await _scanIndex(tableName, schema, idxName, query.where[idxName]);
                    const idSet = new Set(ids);
                    ids = orderedIds.filter((id) => idSet.has(id));
                    if (desc) {
                        ids = ids.reverse();
                    }
                } else {
                    // whereに含まれないインデックスでの並び替え=メモリソート.
                    const rows = [];
                    for (let i = 0; i < ids.length; i++) {
                        const row = await _getRow(tableName, ids[i], schema);
                        if (row == null) {
                            await _healStaleIndex(tableName, schema, ids[i]);
                            continue;
                        }
                        rows.push({ id: ids[i], row: row });
                    }
                    const sortCol = schema.indexes[idxName][0];
                    rows.sort((a, b) => {
                        const av = a.row[sortCol], bv = b.row[sortCol];
                        if (av < bv) return desc ? 1 : -1;
                        if (av > bv) return desc ? -1 : 1;
                        return 0;
                    });
                    ids = rows.map((r) => r.id);
                }
            }

            // offset/limit.
            const offset = query.offset | 0;
            const limit = (query.limit != null) ? query.limit | 0 : undefined;
            if (offset > 0) {
                ids = ids.slice(offset);
            }
            if (limit != null) {
                ids = ids.slice(0, limit);
            }

            // 行データ取得(自己修復含む).
            const rows = [];
            for (let i = 0; i < ids.length; i++) {
                const row = await _getRow(tableName, ids[i], schema);
                if (row == null) {
                    await _healStaleIndex(tableName, schema, ids[i]);
                    continue;
                }
                rows.push(row);
            }

            // GROUP BY / 集計.
            if (query.groupBy != null) {
                return _groupAndAggregate(rows, query.groupBy, query.aggregates || {});
            }
            return rows;
        };

        // 取得済み行データ配列に対してGROUP BY・集計を行う(アプリ側計算).
        const _groupAndAggregate = function (rows, groupBy, aggregates) {
            const groups = {};
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const key = groupBy.map((c) => row[c]).join(SEP);
                if (groups[key] == null) {
                    groups[key] = { keyValues: groupBy.map((c) => row[c]), rows: [] };
                }
                groups[key].rows.push(row);
            }
            const ret = [];
            for (const key in groups) {
                const g = groups[key];
                const out = {};
                for (let i = 0; i < groupBy.length; i++) {
                    out[groupBy[i]] = g.keyValues[i];
                }
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

        // UPDATE(内部的には対象行を検索→削除→新規行として再作成).
        // tableName 対象のテーブル名を設定します.
        // query.where 更新対象を絞り込む条件(selectと同じ形式).
        // patch 更新するカラムの部分オブジェクトを設定します.
        // 戻り値: 更新件数(number)が返却されます.
        const update = async function (tableName, query, patch) {
            const schema = await _loadSchema(tableName);
            const candidateSet = await _resolveCandidates(tableName, schema, query.where);
            let cnt = 0;
            for (const rowId of candidateSet) {
                const row = await _getRow(tableName, rowId, schema);
                if (row == null) {
                    await _healStaleIndex(tableName, schema, rowId);
                    continue;
                }
                const merged = Object.assign({}, row, patch);
                const data = _applyColumnDefaults(schema, merged);
                // 旧行を削除(自己修復方式のため旧インデックスは放置).
                await s3sdk.delete(_bucket, _tablePrefix(tableName), rowId, _s3opts);
                // 新しい行ファイル名で再作成.
                const newRowId = generateRowId();
                await s3sdk.put(_bucket, _tablePrefix(tableName), newRowId,
                    JSON.stringify(data), _s3opts);
                await _writeAllIndexes(tableName, schema, data, newRowId);
                cnt++;
            }
            return cnt;
        };

        // DELETE(行ファイルを即時削除。インデックスは自己修復に任せる).
        // tableName 対象のテーブル名を設定します.
        // query.where 削除対象を絞り込む条件(selectと同じ形式).
        // 戻り値: 削除件数(number)が返却されます.
        const del = async function (tableName, query) {
            const schema = await _loadSchema(tableName);
            const candidateSet = await _resolveCandidates(tableName, schema, query.where);
            let cnt = 0;
            for (const rowId of candidateSet) {
                await s3sdk.delete(_bucket, _tablePrefix(tableName), rowId, _s3opts);
                cnt++;
            }
            return cnt;
        };

        return {
            createTable: createTable,
            dropTable: dropTable,
            listTables: listTables,
            alterColumns: alterColumns,
            backupTable: backupTable,
            listBackups: listBackups,
            restoreTable: restoreTable,
            createIndex: createIndex,
            dropIndex: dropIndex,
            insert: insert,
            select: select,
            update: update,
            delete: del
        };
    };

    // 単体テスト・他モジュールからの再利用のためにエンコード関数群も公開する.
    exports.encodeString = encodeString;
    exports.encodeInt = encodeInt;
    exports.encodeFloat = encodeFloat;
    exports.encodeBoolean = encodeBoolean;
    exports.encodeDate = encodeDate;
    exports.encodeValue = encodeValue;
    exports.isRangeSupportedType = isRangeSupportedType;
    exports.generateRowId = generateRowId;
    exports.NULL_TOKEN = NULL_TOKEN;
})();
