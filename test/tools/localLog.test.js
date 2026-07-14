// tools/localLog.js のテスト.
// localLog は require 時にグローバルの console を差し替えるため、
// 子プロセス(fixtures/localLogRunner.js)経由で検証する.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RUNNER = path.join(__dirname, ".fixtures", "localLogRunner.js");

const makeTmpDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), "minto-locallog-test-"));
};

// logDir配下に生成された logout.*.log の中身を結合して返す.
const readLogContent = function (logDir) {
    if (!fs.existsSync(logDir)) {
        return "";
    }
    const files = fs.readdirSync(logDir)
        .filter((f) => f.startsWith("logout.") && f.endsWith(".log"));
    let content = "";
    for (const f of files) {
        content += fs.readFileSync(path.join(logDir, f), "utf-8");
    }
    return content;
};

test("localLog: level=\"none\" はログファイルに一切書き込まない", () => {
    const dir = makeTmpDir();
    execFileSync(process.execPath, [RUNNER, "level-none", dir]);
    const content = readLogContent(dir);
    assert.equal(content.includes("should-not-be-in-file"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("localLog: level=\"error\" はerror未満を抑制し、error/logは書き込む", () => {
    const dir = makeTmpDir();
    execFileSync(process.execPath, [RUNNER, "level-error", dir]);
    const content = readLogContent(dir);
    assert.equal(content.includes("should-be-suppressed"), false);
    assert.equal(content.includes("should-be-logged"), true);
    assert.equal(content.includes("plain-log-always-written"), true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("localLog: console.count は呼び出すたびにカウントが増加する", () => {
    const dir = makeTmpDir();
    const out = execFileSync(process.execPath, [RUNNER, "count", dir]).toString();
    const lines = out.trim().split("\n").filter((l) => l.length > 0);
    // 標準出力には "mySymbol: 1", "mySymbol: 2", "mySymbol: 3" の順で出力される.
    assert.equal(lines.length, 3);
    assert.match(lines[0], /mySymbol: 1$/);
    assert.match(lines[1], /mySymbol: 2$/);
    assert.match(lines[2], /mySymbol: 3$/);
    fs.rmSync(dir, { recursive: true, force: true });
});
