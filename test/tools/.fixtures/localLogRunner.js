// tools/localLog.js のテスト用ランナー.
// localLog は require 時にグローバルの console を差し替えるため、
// テストプロセス本体を汚染しないよう子プロセスで実行する.
// 実行モード(argv[2])とログ出力先ディレクトリ(argv[3])を指定する.
const mode = process.argv[2];
const logDir = process.argv[3];
const localLog = require("../../../tools/localLog.js");

if (mode === "level-none") {
    // "none" は logLevel が全レベルより大きくなるため、
    // ログファイルには一切書き込まれないことを期待する.
    localLog.setting({ dir: logDir, level: "none" });
    console.error("should-not-be-in-file");
} else if (mode === "level-error") {
    // "error" 指定時は error 未満(warn等)はファイルに書き込まれず、
    // error および console.log(常にLEVEL_LOG=99扱い)は書き込まれる.
    localLog.setting({ dir: logDir, level: "error" });
    console.warn("should-be-suppressed");
    console.error("should-be-logged");
    console.log("plain-log-always-written");
} else if (mode === "count") {
    localLog.setting({ dir: logDir });
    console.count("mySymbol");
    console.count("mySymbol");
    console.count("mySymbol");
}
