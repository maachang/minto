// tools/llrtCheck.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const llrtCheck = require("../../tools/llrtCheck.js");

const makeTmpProject = function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-llrtcheck-test-"));
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.mkdirSync(path.join(dir, "public"), { recursive: true });
    return dir;
};

test("llrtCheck: 未サポートAPI(crypto.pbkdf2Sync)を検出する", () => {
    const dir = makeTmpProject();
    fs.writeFileSync(path.join(dir, "lib", "bad.js"),
        'const crypto = require("crypto");\n' +
        'const x = crypto.pbkdf2Sync("a", "b", 1, 1, "sha256");\n');

    const result = llrtCheck.check(dir);
    assert.equal(result.length >= 1, true);
    assert.equal(result.some((r) =>
        r.file.endsWith("bad.js") && r.line === 2 &&
        r.reason.includes("pbkdf2")), true);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("llrtCheck: for await 構文を検出する", () => {
    const dir = makeTmpProject();
    fs.writeFileSync(path.join(dir, "lib", "stream.js"),
        'async function f(s) {\n' +
        '    for await (const chunk of s) {\n' +
        '        console.log(chunk);\n' +
        '    }\n' +
        '}\n');

    const result = llrtCheck.check(dir);
    assert.equal(result.some((r) =>
        r.file.endsWith("stream.js") && r.line === 2 &&
        r.reason.includes("for-await-of")), true);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("llrtCheck: 問題が無いファイルは検出結果が空になる", () => {
    const dir = makeTmpProject();
    fs.writeFileSync(path.join(dir, "lib", "good.js"),
        'const crypto = require("crypto");\n' +
        'const h = crypto.createHash("sha256").update("a").digest("hex");\n');

    const result = llrtCheck.check(dir);
    assert.deepEqual(result, []);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("llrtCheck: 存在しないディレクトリは無視して例外を投げない", () => {
    const dir = makeTmpProject();
    // public/lib はあるが modules/lambda 側の探索対象がなくても
    // 例外にならないことを確認(MINTO_HOME未設定でも動く).
    const result = llrtCheck.check(dir);
    assert.equal(Array.isArray(result), true);

    fs.rmSync(dir, { recursive: true, force: true });
});
