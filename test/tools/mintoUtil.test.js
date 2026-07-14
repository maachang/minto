// tools/mintoUtil.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mintoUtil = require("../../tools/mintoUtil.js");

// テスト用一時ディレクトリを作成するヘルパー.
const makeTmpDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), "minto-test-"));
};

test("mintoUtil: existsFileSync / existsDirSync", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "hello");

    assert.equal(mintoUtil.existsFileSync(filePath), true);
    assert.equal(mintoUtil.existsFileSync(dir), false);
    assert.equal(mintoUtil.existsDirSync(dir), true);
    assert.equal(mintoUtil.existsDirSync(filePath), false);
    assert.equal(mintoUtil.existsFileSync(path.join(dir, "notfound.txt")), false);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: loadJson はJSONファイルをパースして返す", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "conf.json");
    fs.writeFileSync(filePath, JSON.stringify({ hoge: 100 }));

    const conf = mintoUtil.loadJson(filePath);
    assert.deepEqual(conf, { hoge: 100 });

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: listDir はディレクトリのみを一覧取得する(末尾/付き)", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "subA"));
    fs.mkdirSync(path.join(dir, "subB"));
    fs.writeFileSync(path.join(dir, "file.txt"), "x");

    const list = mintoUtil.listDir(dir, false);
    assert.equal(list.length, 2);
    for (const d of list) {
        assert.equal(d.endsWith("/"), true);
    }

    const dict = mintoUtil.listDir(dir, true);
    assert.deepEqual(Object.keys(dict).sort(), ["subA", "subB"]);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: listFile はファイルのみを一覧取得する(末尾に/を付けない)", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "a.js"), "x");
    fs.writeFileSync(path.join(dir, "b.js"), "x");

    const list = mintoUtil.listFile(dir, false);
    assert.equal(list.length, 2);
    for (const f of list) {
        assert.equal(f.endsWith("/"), false);
        assert.equal(f.endsWith(".js"), true);
    }

    const dict = mintoUtil.listFile(dir, true);
    assert.deepEqual(Object.keys(dict).sort(), ["a.js", "b.js"]);
    for (const k in dict) {
        assert.equal(dict[k].endsWith("/"), false);
    }

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: listFile は再帰指定でサブディレクトリ内のファイルも取得できる(パスが破損しないこと)", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "top.js"), "x");
    fs.writeFileSync(path.join(dir, "sub", "nested.js"), "x");

    const list = mintoUtil.listFile(dir, false, true).sort();
    // NodeとBunでdirent.parentPathの末尾スラッシュ有無が異なるため、
    // パス結合が壊れて二重結合されないことを厳密なフルパス一致で確認する.
    const expected = [
        path.join(dir, "sub", "nested.js"),
        path.join(dir, "top.js")
    ].sort();
    assert.deepEqual(list, expected);

    fs.rmSync(dir, { recursive: true, force: true });
});
