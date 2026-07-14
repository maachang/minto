// tools/args.js のテスト.
// args.js は require 時に process.argv を読み込む作りのため、
// 実際のCLI起動を再現するように子プロセスで実行して検証する.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RUNNER = path.join(__dirname, ".fixtures", "argsRunner.js");

// argsRunner.js を指定引数で実行し、JSON結果を返す.
const run = function (cliArgs) {
    const out = execFileSync(process.execPath, [RUNNER, ...cliArgs]);
    return JSON.parse(out.toString());
};

test("args: -i を複数指定した場合の next/getArray", () => {
    const r = run(["-i", "abc", "-i", "def", "-i", "xyz"]);
    assert.equal(r.next0_i, "abc");
    assert.equal(r.next1_i, "def");
    assert.equal(r.next2_i, "xyz");
    assert.deepEqual(r.getArray_i, ["abc", "def", "xyz"]);
});

test("args: -t/--target で値を取得", () => {
    const r = run(["-t", "hoge"]);
    assert.equal(r.get_t, "hoge");
});

test("args: isValue はフラグの有無を判定する", () => {
    const r = run(["-h"]);
    assert.equal(r.isValue_h, true);
    assert.equal(r.isValue_x, false);
});

test("args: getFirst/getLast/length はユーザー引数(node/script名を除く)を対象とする", () => {
    const r = run(["first", "middle", "last"]);
    assert.equal(r.getFirst, "first");
    assert.equal(r.getLast, "last");
    assert.equal(r.length, 3);
});

test("args: getBoolean は true/on を真として扱う", () => {
    let r = run(["-all", "true"]);
    assert.equal(r.getBoolean_all, true);
    r = run(["-all", "on"]);
    assert.equal(r.getBoolean_all, true);
    r = run(["-all", "false"]);
    assert.equal(r.getBoolean_all, false);
});

test("args: 引数無しの場合は空扱い", () => {
    const r = run([]);
    assert.equal(r.getFirst, "");
    assert.equal(r.getLast, "");
    assert.equal(r.length, 0);
});
