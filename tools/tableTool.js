///////////////////////////////////////////////
// (node専用)テーブル管理コマンド実行ツール.
//
// s3MasterTable.js/s3IndexTable.jsが管理するテーブル定義に対する
// createTable/dropTable/alterTable/alterIndex、両モジュール共通の
// backupTable/restoreTable/listBackups/previewRestore/pruneBackups/
// restoreBackupAs/describeBackup、およびs3MasterTable.js(target=masterの
// み)のexportCsv/importCsvを、ローカルから実行するためのコマンド。
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
// exportCsv|importCsv), -n/--table (alterIndex/backupTable/restoreTable/
// listBackups/previewRestore/pruneBackups/restoreBackupAs/describeBackup/
// exportCsv/importCsv時必須), -b/--backupId (restoreTable/previewRestore/
// restoreBackupAs/describeBackup時必須), -k/--keep (pruneBackups時必須),
// -d/--dest (restoreBackupAs時必須の複製先テーブル名),
// --csvBucket/--csvPrefix/--csvFileName (exportCsv/importCsv時必須。
// --csvPrefixのみ省略可。target=masterのみ対応。CSV入出力先はテーブル自体が
// 保存されているbucketとは無関係に指定できる).
///////////////////////////////////////////////
(function () {
    'use strict';

    const path = require("path");
    const args = require("./args.js");

    // mintoメイン(lambda/src/index.js).
    const mintoLambdaIndex = require("../lambda/src/index.js");

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
    // --csvFileName).
    const _target = args.get("-t", "--target");
    const _command = args.get("-c", "--command");
    const _tableName = args.get("-n", "--table");
    const _backupId = args.get("-b", "--backupId");
    const _keep = args.get("-k", "--keep");
    const _dest = args.get("-d", "--dest");
    const _csvBucket = args.get("--csvBucket");
    const _csvPrefix = args.get("--csvPrefix");
    const _csvFileName = args.get("--csvFileName");

    const main = async function () {
        if (_target == null || _command == null) {
            console.error("使い方: tableTool -t <master|index> -c " +
                "<createTable|dropTable|alterTable|alterIndex|backupTable|" +
                "restoreTable|listBackups|previewRestore|pruneBackups|" +
                "restoreBackupAs|describeBackup|exportCsv|importCsv> " +
                "[-n <tableName>] [-b <backupId>] [-k <keep>] [-d <destTableName>] " +
                "[--csvBucket <bucket>] [--csvPrefix <prefix>] [--csvFileName <fileName>]");
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
        const result = await mintoLambdaIndex.handler(event, {});
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
