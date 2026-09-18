///////////////////////////////////////////////
// (node専用)テーブル管理コマンド実行ツール.
//
// s3MasterTable.js/s3IndexTable.jsが管理するテーブル定義に対する
// createTable/dropTable/alterTable/alterIndex、両モジュール共通の
// backupTable/restoreTable/listBackups/previewRestore/pruneBackups/
// restoreBackupAs/describeBackup、s3MasterTable.js(target=masterのみ)の
// exportCsv/importCsv、およびmaster/index両対応のローカルファイル
// dump/importを、ローカルから実行するためのコマンド。
//
// 実装はlambda/src/index.jsの_responseTableCommand()に集約されており、
// AWSコンソールの「テスト実行」で渡すevent({ target, command, tableName })
// と全く同じ形のオブジェクトを組み立てて、lambda/src/index.jsのhandler()を
// 直接呼び出す(tools/webapps.jsと同じ「lambda/src/index.jsをそのまま使う」
// パターン。ロジックの二重実装を避け、Lambda実行時と全く同じコードパスを通す)。
//
// 起動パラメータ: -t/--target (master|index), -c/--command
// (createTable|dropTable|alterTable|alterIndex|backupTable|restoreTable|
// listBackups|previewRestore|pruneBackups|restoreBackupAs|describeBackup|
// exportCsv|importCsv|dump|import), -n/--table (alterIndex/backupTable/restoreTable/
// listBackups/previewRestore/pruneBackups/restoreBackupAs/describeBackup/
// exportCsv/importCsv/dump/import時必須), -b/--backupId (restoreTable/previewRestore/
// restoreBackupAs/describeBackup時必須), -k/--keep (pruneBackups時必須),
// -d/--dest (restoreBackupAs時必須の複製先テーブル名),
// --csvBucket/--csvPrefix/--csvFileName (exportCsv/importCsv時必須。
// --csvPrefixのみ省略可。target=masterのみ対応。CSV入出力先はテーブル自体が
// 保存されているbucketとは無関係に指定できる),
// -f/--file (dump/import時の入出力ローカルファイルパス。dump時省略時はテーブル名.format),
// --format (dump/import時のフォーマット: jsonl(デフォルト) | csv),
// -m/--mode (import時のモード: append(デフォルト) | replace).
///////////////////////////////////////////////
(function () {
    'use strict';

    const fs = require("fs");
    const path = require("path");
    const args = require("./args.js");

    // mintoメイン(lambda/src/index.js).
    const mintoLambdaIndex = require("../lambda/src/index.js");

    // CSV用モジュール.
    const csvReader = require("../modules/csv/csvReader.js");
    const csvWriter = require("../modules/csv/csvWriter.js");

    // webapps.jsを経由せずlambda/src/index.jsを直接呼び出すツール共通の
    // global $xxx 上書き($loadLibのmodules/フォールバック、$loadConfの
    // "*.local.json"/"*.test.json"優先解決).
    const lambdaOverrides = require("./lambdaOverrides.js");

    // 対象プロジェクトのカレントパス.
    const _CURRENT_PATH = path.resolve() + "/";

    lambdaOverrides.applyLoadLibModulesFallback();
    lambdaOverrides.applyLoadConfLocalOverride(_CURRENT_PATH);

    // 起動パラメータ取得(-t/--target, -c/--command, -n/--table,
    // -b/--backupId, -k/--keep, -d/--dest, --csvBucket, --csvPrefix,
    // --csvFileName, -f/--file, --format, -m/--mode).
    const _target = args.get("-t", "--target");
    const _command = args.get("-c", "--command");
    const _tableName = args.get("-n", "--table");
    const _backupId = args.get("-b", "--backupId");
    const _keep = args.get("-k", "--keep");
    const _dest = args.get("-d", "--dest");
    const _csvBucket = args.get("--csvBucket");
    const _csvPrefix = args.get("--csvPrefix");
    const _csvFileName = args.get("--csvFileName");
    const _file = args.get("-f", "--file");
    const _format = (args.get("--format") || "jsonl").toLowerCase();
    const _mode = args.get("-m", "--mode") || "append";

    // rows 配列を JSONL 文字列にシリアライズ.
    const _rowsToJsonl = function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return "";
        }
        return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    };

    // rows 配列を CSV 文字列にシリアライズ.
    const _rowsToCsv = function (rows, schema) {
        if (!Array.isArray(rows)) {
            return "";
        }
        let headers = [];
        if (schema && schema.columns) {
            headers = Object.keys(schema.columns);
        } else if (rows.length > 0) {
            headers = Object.keys(rows[0]);
        }
        if (headers.length === 0) {
            return "";
        }
        const writer = csvWriter.createCsvWriter(headers);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
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

    // JSONL 文字列を行オブジェクト配列にパース.
    const _parseJsonl = function (content) {
        const lines = content.split("\n");
        const rows = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.length === 0) {
                continue;
            }
            rows.push(JSON.parse(line));
        }
        return rows;
    };

    // CSV 文字列を行オブジェクト配列にパース.
    const _parseCsv = function (content) {
        const reader = csvReader.createCsvReader(content);
        const rows = [];
        while (reader.hasNext()) {
            const csvRow = reader.next();
            const row = {};
            const headers = reader.getHeaders();
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                const rawStr = csvRow.getString(h);
                if (rawStr == null || rawStr === "") {
                    continue;
                }
                // JSONオブジェクト/配列または数値・真偽値の自動解釈を試行
                if ((rawStr.startsWith("{") && rawStr.endsWith("}")) ||
                    (rawStr.startsWith("[") && rawStr.endsWith("]"))) {
                    try {
                        row[h] = JSON.parse(rawStr);
                        continue;
                    } catch (e) {
                        // 文字列として扱う
                    }
                }
                if (rawStr === "true") {
                    row[h] = true;
                } else if (rawStr === "false") {
                    row[h] = false;
                } else if (/^-?[0-9]+(\.[0-9]+)?$/.test(rawStr)) {
                    row[h] = Number(rawStr);
                } else {
                    row[h] = rawStr;
                }
            }
            rows.push(row);
        }
        return rows;
    };

    const main = async function () {
        if (_target == null || _command == null) {
            console.error("使い方: tableTool -t <master|index> -c " +
                "<createTable|dropTable|alterTable|alterIndex|backupTable|" +
                "restoreTable|listBackups|previewRestore|pruneBackups|" +
                "restoreBackupAs|describeBackup|exportCsv|importCsv|dump|import> " +
                "[-n <tableName>] [-b <backupId>] [-k <keep>] [-d <destTableName>] " +
                "[--csvBucket <bucket>] [--csvPrefix <prefix>] [--csvFileName <fileName>] " +
                "[-f <file>] [--format <jsonl|csv>] [-m <append|replace>]");
            process.exitCode = 1;
            return;
        }
        // 基本パスをカレントプロジェクトディレクトリに設定.
        mintoLambdaIndex.setBasePath(_CURRENT_PATH);

        const event = { target: _target, command: _command };
        if (_tableName != null) {
            event.tableName = _tableName;
        }
        if (_backupId != null) {
            event.backupId = _backupId;
        }
        if (_keep != null) {
            event.keep = parseInt(_keep, 10);
        }
        if (_dest != null) {
            event.destTableName = _dest;
        }
        if (_csvBucket != null) {
            event.csvBucket = _csvBucket;
        }
        if (_csvPrefix != null) {
            event.csvPrefix = _csvPrefix;
        }
        if (_csvFileName != null) {
            event.csvFileName = _csvFileName;
        }

        // import の場合は事前にローカルファイルをパースして event.rows にセット
        if (_command === "import") {
            const filePath = _file || (_tableName ? (_tableName + "." + _format) : null);
            if (!filePath) {
                console.error("エラー: importには -n <tableName> または -f <filePath> が必要です。");
                process.exitCode = 1;
                return;
            }
            if (!fs.existsSync(filePath)) {
                console.error("エラー: インポート対象ファイルが存在しません: " + filePath);
                process.exitCode = 1;
                return;
            }
            const content = fs.readFileSync(filePath, "utf-8");
            const isCsv = _format === "csv" || filePath.endsWith(".csv");
            const rows = isCsv ? _parseCsv(content) : _parseJsonl(content);
            event.rows = rows;
            event.mode = _mode;
        }

        const result = await mintoLambdaIndex.handler(event, {});

        // dump の場合は結果の rows をローカルファイルに書き出す
        if (_command === "dump" && result && !result.error) {
            const filePath = _file || (_tableName + "." + _format);
            const isCsv = _format === "csv" || filePath.endsWith(".csv");
            const content = isCsv ? _rowsToCsv(result.rows, result.schema) : _rowsToJsonl(result.rows);
            fs.writeFileSync(filePath, content, "utf-8");
            result.file = filePath;
            result.format = isCsv ? "csv" : "jsonl";
        }

        console.log(JSON.stringify(result, null, 2));
        if (result != null && result.error != null) {
            process.exitCode = 1;
        }
    };

    main().catch(function (e) {
        console.error("[error]tableTool: ", e);
        process.exitCode = 1;
    });
})();
