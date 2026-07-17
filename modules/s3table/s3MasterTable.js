///////////////////////////////////////////////
// S3全体JSON型データベース(s3MasterTable).
// マスターデータのような「更新頻度が低いデータ」を対象とする.
//
// AIメモ:
// 詳細は docs/s3MasterTable.md を参照。s3IndexTable.js
// (modules/s3table/s3IndexTable.js)と対になるモジュールで、
// 書き込み頻度が少なく読み込み頻度が多い用途向け.
// (旧名: s3db.js. 用途(マスターデータ向け)を名前に反映して改名した).
//
// - テーブル全体を1つのJSON(table/{table名}/data.json)として
//   読み込み→メモリ上でフィルタ・更新→丸ごと書き戻す方式.
//   s3IndexTable.jsのようなインデックスは持たず、全件走査で検索する
//   ため、where条件はmemoryTable.js(modules/csv/memoryTable.js)相当の
//   演算子(eq/ne/gt/gte/lt/lte/in/ni/between/regexp)をそのまま使える.
//   ※ 演算子名は memoryTable.js の ge/le ではなく、s3IndexTable.js に
//     合わせて gte/lte としている(プロジェクト内表記の統一).
// - primaryKey/uniqueは、テーブル全体を1回の読み込み→書き戻しサイクルの
//   中で検証するため、s3IndexTable.jsとは異なり提供する(s3IndexTable.jsで
//   見送った理由は、複数の独立したLambda実行が別々の行ファイル+
//   インデックスファイルに分散して書き込むため一意性チェックがTOCTOU的に
//   競合するからだが、本モジュールはその構造ではないため同じ問題は起きない。
//   ただし複数の書き込みが同時に発生した場合、後勝ちで上書きされる可能性は
//   既存の制約として残る=書き込み頻度が少ない前提のため許容している).
//   autoIncrementは提供しない(insertの度に変わる値をテーブル定義の集約
//   ファイルに同居させると書き込み競合・性能劣化を招くため。連番的な
//   採番が必要な場合は代わりにseqId型(modules/s3table/seqId.js、
//   Snowflake ID方式)を使う。ロック・中央採番管理が不要なため書き込み
//   競合を招かない).
// - テーブル定義(カラム定義)は、テーブル単位ファイルではなく
//   {prefix}table.json という1つの集約ファイルにテーブル名をキーにして
//   まとめて保持する(show tables的な一覧参照・キャッシュ効率のため).
// - joinは不要機能として提供しない(旧実装にはあったが削除)。transactionは
//   後日「テーブル単位ロック+バッファリング書き込み」という形で復活させた
//   (下記参照)。
// - insert/update/delete/importCsvはS3への即時アップロードを行わず、
//   メモリキャッシュ(_rowsCache/_dirty)にのみ変更を保持する。実際の
//   アップロードはflush(tableName)を呼んだ時点、またはtransaction()経由で
//   行う(書き込み回数を減らすため)。flush()を呼ばない限りS3には反映
//   されない点に注意(Lambda実行が終了すると変更は失われる)。
// - transaction(tableName, fn)は、s3Lock.jsで"master."+tableNameという
//   キーのロックを取得→fn実行→flush→ロック解放、という流れを提供する。
//   fn内で例外が発生した場合は、実行前のメモリ状態にロールバックし
//   (S3へは一切アップロードしない)、ロック解放後に例外を再throwする.
// - backupTable/restoreTable/listBackupsはs3IndexTable.jsと共通の物理コピー
//   方式(S3のCopyObjectは使わず既存のget/put経由で複製する)。ただし本
//   モジュールはテーブル全体1JSON(data.json)なのでインデックスは無く、
//   data.json＋スキーマ定義の2ファイルをbackup/{table名}/{backupId}/配下に
//   複製するだけで済む(s3IndexTable.jsより単純)。backupTableは_loadRows
//   経由で行を取得するため、flush前の未反映な変更も対象に含む
//   (select/exportCsvと同じ「現在の実効値」を見る挙動).
// - カラム型システム(string/int/float/boolean/date/json/seqId)は
//   s3IndexTable.jsと共通の考え方. date型はinsert時にDateオブジェクトを
//   受け取り、内部的にはUnixTimeミリ秒のnumberとして保存し、
//   select時に(集計されていない通常の行では)Dateオブジェクトに変換して
//   返す。where条件の比較時もDateオブジェクトを渡せるように、
//   比較前に自動的にミリ秒数へ変換している. seqId型は固定長16桁の
//   小文字hex文字列(Snowflake ID)で、insert時に値省略なら自動生成される.
///////////////////////////////////////////////
(function () {
    'use strict';

    // S3の低レベル操作(put/get/delete/list).
    const s3sdk = $loadLib("s3sdk.js");

    // Snowflake ID方式のユニークID発行(autoIncrementの代替).
    const seqId = $loadLib("seqId.js");

    // テーブル単位の排他ロック(transaction用).
    const s3Lock = $loadLib("s3Lock.js");

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
        json: function () { return true; },
        seqId: function (v) { return seqId.isValid(v); }
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

    // s3MasterTableオブジェクトを生成する.
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

        const _dataPrefix = function (tableName) {
            return _basePrefix + "table/" + tableName;
        };
        const _dataKey = function () {
            return "data.json";
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

        // スキーマを取得する(存在しない場合はエラー).
        const _loadSchema = async function (tableName) {
            const all = await _loadAllDefs();
            if (all[tableName] == null) {
                throw new Error("Table not found: " + tableName);
            }
            return all[tableName];
        };

        // 行データのメモリキャッシュ(1回のLambda実行中のみ有効)と、
        // S3へ未反映の変更があるかどうかのフラグ(flush/transaction用).
        const _rowsCache = {};
        const _dirty = {};

        // 行データ全件を取得する(存在しない場合は空配列).
        // キャッシュがあればそれを返す(flush前の変更もここで参照できる
        // ようにするため、S3へは問い合わせない).
        const _loadRows = async function (tableName) {
            if (_rowsCache[tableName] !== undefined) {
                return _rowsCache[tableName];
            }
            return await _reloadRows(tableName);
        };

        // キャッシュの有無に関わらず、必ずS3から最新の行データを取得し
        // キャッシュを上書きする(transaction()がロック取得直後に使う。
        // ロック取得前に作られた可能性のある古いキャッシュを信用せず、
        // 排他区間の開始時点で必ず最新のS3状態と同期するため).
        const _reloadRows = async function (tableName) {
            const res = await s3sdk.get(_bucket, _dataPrefix(tableName), _dataKey(), _s3opts);
            const rows = (res == null) ? [] : JSON.parse(await _streamToString(res.Body));
            _rowsCache[tableName] = rows;
            return rows;
        };

        const _saveRows = async function (tableName, rows) {
            await s3sdk.put(_bucket, _dataPrefix(tableName), _dataKey(),
                JSON.stringify(rows), _s3opts);
        };

        // 保留中の変更(_dirty)があれば、実際にS3へアップロードする.
        // tableName 対象のテーブル名を設定します.
        // 戻り値: アップロードを実施した場合true、変更が無く何もしなかった場合false.
        const flush = async function (tableName) {
            if (_dirty[tableName] !== true) {
                return false;
            }
            await _saveRows(tableName, _rowsCache[tableName] || []);
            _dirty[tableName] = false;
            return true;
        };

        // テーブル単位ロック(s3Lock.js)の遅延生成.
        let _lock = null;
        const _getLock = function () {
            if (_lock == null) {
                _lock = s3Lock.create({
                    bucket: _bucket, region: _s3opts.region, credentials: _s3opts.credentials
                });
            }
            return _lock;
        };

        // テーブル単位ロックを取得したうえでfnを実行し、成功時はflushして
        // ロックを解放する。fn内で例外が発生した場合は、ロック取得直後の
        // 状態にロールバックし(S3へは一切アップロードしない)、ロックを
        // 解放してから例外を再throwする.
        //
        // AIメモ: ロック取得直後に必ず_reloadRows()でS3から強制再取得する
        // (_loadRows()のキャッシュ優先ロジックに任せない)。ロック取得前に
        // 別の処理(select/insert等)がキャッシュを作っていた場合、それは
        // 他プロセスの変更を反映していない古い状態である可能性があり、
        // それをそのままバックアップ・作業対象にしてしまうと、他プロセスが
        // ロック区間の直前に書き込んだ内容をここでのflushが上書きして
        // 消してしまう(実際にこの手順で再現・確認済みのバグだったため、
        // 必ずこの順序を守ること).
        // tableName ロック対象・flush対象のテーブル名を設定します.
        // fn 実行する処理(引数無しのasync関数)を設定します.
        // 戻り値: 正常終了時true.
        const transaction = async function (tableName, fn) {
            const lockKey = "master." + tableName;
            const lock = _getLock();
            if (!(await lock.acquire(lockKey))) {
                throw new Error("Failed to acquire lock for table: " + tableName);
            }
            try {
                // ロック取得直後、キャッシュの有無に関わらず必ずS3から
                // 最新状態を取得し直す(排他区間開始時点での正しい基準点にする).
                const freshRows = await _reloadRows(tableName);
                _dirty[tableName] = false;
                // ロールバック用にバックアップ(直後に取得した最新状態そのもの).
                const backupRows = JSON.parse(JSON.stringify(freshRows));
                try {
                    await fn();
                    await flush(tableName);
                } catch (e) {
                    _rowsCache[tableName] = backupRows;
                    _dirty[tableName] = false;
                    throw e;
                }
            } finally {
                await lock.release(lockKey);
            }
            return true;
        };

        // テーブル作成.
        // tableName 対象のテーブル名を設定します.
        // schema.columns カラム定義
        //   ({名前: {type, notNull, default, primaryKey, unique}}).
        const createTable = async function (tableName, schema) {
            schema = schema || {};
            const columns = schema.columns || {};
            const all = await _loadAllDefs();
            if (all[tableName] != null) {
                throw new Error("Table already exists: " + tableName);
            }
            all[tableName] = { columns: columns };
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(),
                JSON.stringify(all), _s3opts);
            await _saveRows(tableName, []);
            _rowsCache[tableName] = [];
            _dirty[tableName] = false;
            return true;
        };

        // テーブル削除.
        const dropTable = async function (tableName) {
            const all = await _loadAllDefs();
            delete all[tableName];
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(),
                JSON.stringify(all), _s3opts);
            await s3sdk.delete(_bucket, _dataPrefix(tableName), _dataKey(), _s3opts);
            delete _rowsCache[tableName];
            delete _dirty[tableName];
            return true;
        };

        // テーブル定義を取得する.
        const describeTable = async function (tableName) {
            return await _loadSchema(tableName);
        };

        // 全テーブル分のテーブル定義を取得する({テーブル名: schema}形式).
        // テーブル管理コマンド(createTable/dropTable/alterTable)が、現在
        // S3上に存在するテーブル定義を把握するために使用する.
        const listTables = async function () {
            const all = await _loadAllDefs();
            return JSON.parse(JSON.stringify(all));
        };

        // 既存テーブルのカラム定義を丸ごと差し替える(テーブル管理コマンドの
        // alterTable用). 行データ(data.json)は一切変更しない
        // (削除されたカラムは以後selectで除外されるだけで、既存データはそのまま残る).
        // tableName 対象のテーブル名を設定します.
        // columns 差し替え後のカラム定義({名前: {type, notNull, default,
        //   primaryKey, unique}})を設定します.
        const alterColumns = async function (tableName, columns) {
            const all = await _loadAllDefs();
            if (all[tableName] == null) {
                throw new Error("Table not found: " + tableName);
            }
            all[tableName] = Object.assign({}, all[tableName], { columns: columns });
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(),
                JSON.stringify(all), _s3opts);
            return true;
        };

        // backup/{table名}/[{backupId}] のprefixを取得(backupId省略時は
        // 該当テーブルのバックアップ世代一覧のルート).
        const _backupPrefix = function (tableName, backupId) {
            return _basePrefix + "backup/" + tableName +
                (backupId != null ? "/" + backupId : "");
        };

        // バックアップ(物理コピー方式。s3IndexTable.jsと同じ考え方だが、
        // 本モジュールはテーブル全体1JSON(data.json)なのでインデックスは
        // 無く、data.json＋スキーマ定義の2ファイルを複製するだけで済む).
        // backup/{tableName}/{backupId}/配下に複製する(backupIdは実行時の
        // UnixTimeミリ秒。複数世代を保持できる)。行データは_loadRows経由で
        // 取得するため、flush前の未反映な変更(_dirty)もバックアップ対象に
        // 含まれる(select/exportCsvと同じ「現在の実効値」を見る挙動に合わせている).
        // tableName 対象のテーブル名を設定します.
        // 戻り値: { tableName, backupId, rowCount }
        const backupTable = async function (tableName) {
            const schema = await _loadSchema(tableName);
            const backupId = String(Date.now());
            const backupBase = _backupPrefix(tableName, backupId);

            await s3sdk.put(_bucket, backupBase, "schema.json", JSON.stringify(schema), _s3opts);
            const rows = await _loadRows(tableName);
            await s3sdk.put(_bucket, backupBase, _dataKey(), JSON.stringify(rows), _s3opts);

            return { tableName: tableName, backupId: backupId, rowCount: rows.length };
        };

        // 指定テーブルの既存バックアップ世代(backupId)一覧を、古い順
        // (タイムスタンプ昇順)の文字列配列で返す.
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

        // バックアップのスキーマ定義・行データを取得する(存在しなければ
        // エラー). restoreTable/restoreBackupAs/describeBackup共通の
        // 内部ヘルパー.
        // 戻り値: { schema, rows }
        const _loadBackup = async function (sourceTableName, backupId) {
            const backupBase = _backupPrefix(sourceTableName, backupId);
            const schemaRes = await s3sdk.get(_bucket, backupBase, "schema.json", _s3opts);
            if (schemaRes == null) {
                throw new Error("Backup not found: " + sourceTableName + "/" + backupId);
            }
            const schema = JSON.parse(await _streamToString(schemaRes.Body));
            const dataRes = await s3sdk.get(_bucket, backupBase, _dataKey(), _s3opts);
            const rows = (dataRes == null) ? [] : JSON.parse(await _streamToString(dataRes.Body));
            return { schema: schema, rows: rows };
        };

        // 指定した世代(backupId)の内容で、現在のテーブル(行データ・
        // スキーマ)を完全に置き換える(全置換。差分マージはしない)。
        // 復元後の内容は即座にS3へ書き込み、メモリキャッシュも復元後の
        // 内容にリセットする(flush不要で反映済みの状態になる).
        // tableName 対象のテーブル名を設定します.
        // backupId backupTable()が返したバックアップ世代IDを設定します.
        // 戻り値: { tableName, backupId, rowCount }
        const restoreTable = async function (tableName, backupId) {
            const backup = await _loadBackup(tableName, backupId);

            await _saveRows(tableName, backup.rows);
            _rowsCache[tableName] = backup.rows;
            _dirty[tableName] = false;

            const all = await _loadAllDefs();
            all[tableName] = backup.schema;
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(), JSON.stringify(all), _s3opts);

            return { tableName: tableName, backupId: backupId, rowCount: backup.rows.length };
        };

        // バックアップの内容を、元とは別のテーブル名(destTableName)として
        // 新規復元する(クローン用途). destTableNameが既に存在する場合は
        // 事故防止のためエラーにする(上書きしたい場合は先に明示的に
        // dropTableすること).
        // sourceTableName バックアップ取得元のテーブル名を設定します.
        // backupId 対象のバックアップ世代IDを設定します.
        // destTableName 複製先の新しいテーブル名を設定します.
        // 戻り値: { sourceTableName, backupId, destTableName, rowCount }
        const restoreBackupAs = async function (sourceTableName, backupId, destTableName) {
            const all = await _loadAllDefs();
            if (all[destTableName] != null) {
                throw new Error("Destination table already exists: " + destTableName);
            }
            const backup = await _loadBackup(sourceTableName, backupId);

            await _saveRows(destTableName, backup.rows);
            _rowsCache[destTableName] = backup.rows;
            _dirty[destTableName] = false;

            all[destTableName] = backup.schema;
            await s3sdk.put(_bucket, _defsPrefix(), _defsKey(), JSON.stringify(all), _s3opts);

            return { sourceTableName: sourceTableName, backupId: backupId, destTableName: destTableName,
                rowCount: backup.rows.length };
        };

        // 指定したバックアップ世代の中身(スキーマ・行数)を、復元せずに
        // 確認する.
        // tableName 対象のテーブル名を設定します.
        // backupId 確認対象のバックアップ世代IDを設定します.
        // 戻り値: { tableName, backupId, schema, rowCount }
        const describeBackup = async function (tableName, backupId) {
            const backup = await _loadBackup(tableName, backupId);
            return { tableName: tableName, backupId: backupId, schema: backup.schema, rowCount: backup.rows.length };
        };

        // restoreTable実行前に、現在の行数とバックアップの行数を比較できる
        // dry-run用の確認API(実際の復元は一切行わない).
        // tableName 対象のテーブル名を設定します.
        // backupId 確認対象のバックアップ世代IDを設定します.
        // 戻り値: { tableName, backupId, currentRowCount, backupRowCount }
        const previewRestore = async function (tableName, backupId) {
            const backup = await _loadBackup(tableName, backupId);
            const currentRows = await _loadRows(tableName);
            return { tableName: tableName, backupId: backupId,
                currentRowCount: currentRows.length, backupRowCount: backup.rows.length };
        };

        // 古いバックアップ世代を削除し、直近keep世代分だけを残す.
        // tableName 対象のテーブル名を設定します.
        // keep 残す世代数(0以上の整数)を設定します.
        // 戻り値: { tableName, keep, deleted }(deletedは削除したbackupIdの配列、古い順).
        const pruneBackups = async function (tableName, keep) {
            const backups = await listBackups(tableName);
            const deleted = [];
            if (backups.length > keep) {
                const toDelete = backups.slice(0, backups.length - keep);
                for (let i = 0; i < toDelete.length; i++) {
                    const backupBase = _backupPrefix(tableName, toDelete[i]);
                    await s3sdk.delete(_bucket, backupBase, "schema.json", _s3opts);
                    await s3sdk.delete(_bucket, backupBase, _dataKey(), _s3opts);
                    deleted.push(toDelete[i]);
                }
            }
            return { tableName: tableName, keep: keep, deleted: deleted };
        };

        // 1件分の行データを、カラム定義(notNull/default/primaryKey/unique/
        // seqId/型)に従って検証・補完する.
        // rows 一意性チェック対象の既存行配列を設定します.
        const _prepareInsertRow = function (schema, rows, raw) {
            const row = {};
            for (const colName in schema.columns) {
                const def = schema.columns[colName];
                let value = raw[colName];

                if (def.type === "seqId" && value == null) {
                    value = seqId.generate();
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
            _rowsCache[tableName] = rows;
            _dirty[tableName] = true;
            return inserted;
        };

        // 行データを、現在のスキーマ(schema.columns)に定義されたキーのみに
        // 絞り込み、date型カラムをDateオブジェクトに変換して返す.
        // (alterTableでカラムが削除された場合、既存の行データ自体は書き換え
        //  ないため、ここで現在のスキーマに存在しないカラムを除外する).
        const _applyDateConversion = function (schema, row) {
            const out = {};
            for (const colName in schema.columns) {
                if (row[colName] === undefined) {
                    continue;
                }
                out[colName] = (schema.columns[colName].type === "date" && row[colName] != null)
                    ? new Date(row[colName]) : row[colName];
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
            _rowsCache[tableName] = rows;
            _dirty[tableName] = true;
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
            _rowsCache[tableName] = remaining;
            _dirty[tableName] = true;
            return cnt;
        };

        // テーブル全体をCSV文字列としてエクスポートする.
        // (マスターデータのバックアップ・Excel等での編集用途を想定).
        // tableName 対象のテーブル名を設定します.
        // 戻り値: CSV文字列が返却されます.
        const exportCsv = async function (tableName) {
            const csvWriter = $loadLib("csvWriter.js");
            const schema = await _loadSchema(tableName);
            const rows = await _loadRows(tableName);
            const headers = Object.keys(schema.columns);
            const writer = csvWriter.createCsvWriter(headers);
            for (let i = 0; i < rows.length; i++) {
                const row = _applyDateConversion(schema, rows[i]);
                const out = {};
                for (let j = 0; j < headers.length; j++) {
                    const h = headers[j];
                    let v = row[h];
                    if (v instanceof Date) {
                        v = v.toISOString();
                    } else if (v != null && typeof v === "object") {
                        v = JSON.stringify(v);
                    }
                    out[h] = v;
                }
                writer.putRow(out);
                writer.next();
            }
            return writer.getWriteCsv();
        };

        // CSV文字列からテーブル全体を置き換える(インポート).
        // 既存の行データは全て破棄され、CSVの内容で丸ごと置き換わる。
        // insert等と同様にメモリキャッシュへの反映のみ行い、S3への
        // アップロードはflush(tableName)またはtransaction()経由で行う.
        // notNull/default/primaryKey/unique/型検証は
        // insertと同様に適用される(一意性チェックはCSV内の行同士でも行う).
        // tableName 対象のテーブル名を設定します.
        // csvString インポート対象のCSV文字列を設定します.
        // 戻り値: インポートされた行数(number)が返却されます.
        const importCsv = async function (tableName, csvString) {
            const csvReader = $loadLib("csvReader.js");
            const schema = await _loadSchema(tableName);
            const reader = csvReader.createCsvReader(csvString);
            const newRows = [];
            while (reader.hasNext()) {
                const csvRow = reader.next();
                const raw = {};
                for (const colName in schema.columns) {
                    if (!csvRow.contains(colName)) {
                        continue;
                    }
                    // 空セルは「未設定」として扱い、default/notNull/
                    // autoIncrementの通常ロジックに委ねる
                    // (getNumber("")がNaNになる等の誤判定を避けるため).
                    const rawStr = csvRow.getString(colName);
                    if (rawStr == null || rawStr === "") {
                        continue;
                    }
                    const def = schema.columns[colName];
                    switch (def.type) {
                        case "int":
                        case "float":
                            raw[colName] = csvRow.getNumber(colName);
                            break;
                        case "boolean":
                            raw[colName] = csvRow.getBoolean(colName);
                            break;
                        case "date":
                            raw[colName] = csvRow.getDate(colName);
                            break;
                        case "json":
                            raw[colName] = csvRow.getJSON(colName);
                            break;
                        default:
                            raw[colName] = csvRow.getString(colName);
                    }
                }
                newRows.push(_prepareInsertRow(schema, newRows, raw));
            }
            _rowsCache[tableName] = newRows;
            _dirty[tableName] = true;
            return newRows.length;
        };

        return {
            createTable: createTable,
            dropTable: dropTable,
            describeTable: describeTable,
            listTables: listTables,
            alterColumns: alterColumns,
            backupTable: backupTable,
            listBackups: listBackups,
            restoreTable: restoreTable,
            restoreBackupAs: restoreBackupAs,
            describeBackup: describeBackup,
            previewRestore: previewRestore,
            pruneBackups: pruneBackups,
            insert: insert,
            select: select,
            update: update,
            delete: del,
            exportCsv: exportCsv,
            importCsv: importCsv,
            flush: flush,
            transaction: transaction
        };
    };
})();
