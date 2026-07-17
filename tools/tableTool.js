///////////////////////////////////////////////
// (node専用)テーブル管理コマンド実行ツール.
//
// s3MasterTable.js/s3IndexTable.jsが管理するテーブル定義に対する
// createTable/dropTable/alterTable/alterIndex、およびs3IndexTable.js専用の
// backupTable/restoreTable/listBackupsを、ローカルから実行するためのコマンド。
//
// 実装はlambda/src/index.jsの_responseTableCommand()に集約されており、
// AWSコンソールの「テスト実行」で渡すevent({ target, command, tableName })
// と全く同じ形のオブジェクトを組み立てて、lambda/src/index.jsのhandler()を
// 直接呼び出す(tools/webapps.jsと同じ「lambda/src/index.jsをそのまま使う」
// パターン。ロジックの二重実装を避け、Lambda実行時と全く同じコードパスを通す)。
//
// 起動パラメータ: -t/--target (master|index), -c/--command
// (createTable|dropTable|alterTable|alterIndex|backupTable|restoreTable|
// listBackups), -n/--table (alterIndex/backupTable/restoreTable/listBackups時
// 必須), -b/--backupId (restoreTable時必須).
///////////////////////////////////////////////
(function () {
    'use strict';

    const path = require("path");
    const args = require("./args.js");

    // mintoメイン(lambda/src/index.js).
    const mintoLambdaIndex = require("../lambda/src/index.js");

    // 対象プロジェクトのカレントパス.
    const _CURRENT_PATH = path.resolve() + "/";

    // 起動パラメータ取得(-t/--target, -c/--command, -n/--table, -b/--backupId).
    const _target = args.get("-t", "--target");
    const _command = args.get("-c", "--command");
    const _tableName = args.get("-n", "--table");
    const _backupId = args.get("-b", "--backupId");

    const main = async function () {
        if (_target == null || _command == null) {
            console.error("使い方: tableTool -t <master|index> -c " +
                "<createTable|dropTable|alterTable|alterIndex|backupTable|" +
                "restoreTable|listBackups> [-n <tableName>] [-b <backupId>]");
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
