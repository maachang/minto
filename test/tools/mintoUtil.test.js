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

test("mintoUtil: resolveLocalConf は同名の.local.jsonが存在すればそちらを返す", () => {
    const dir = makeTmpDir();
    const jsonPath = path.join(dir, "env.json");
    const localPath = path.join(dir, "env.local.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ from: "json" }));
    fs.writeFileSync(localPath, JSON.stringify({ from: "local" }));

    assert.equal(mintoUtil.resolveLocalConf(jsonPath), localPath);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: resolveLocalConf は.local.jsonが無ければ元のパスをそのまま返す", () => {
    const dir = makeTmpDir();
    const jsonPath = path.join(dir, "env.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ from: "json" }));

    assert.equal(mintoUtil.resolveLocalConf(jsonPath), jsonPath);
    // .jsonで終わらないパスはそのまま返す.
    assert.equal(mintoUtil.resolveLocalConf(path.join(dir, "note.txt")), path.join(dir, "note.txt"));
    // 既に.local.jsonのパスはそのまま返す(二重解決しない).
    assert.equal(mintoUtil.resolveLocalConf(path.join(dir, "env.local.json")), path.join(dir, "env.local.json"));

    fs.rmSync(dir, { recursive: true, force: true });
});

test("mintoUtil: isTestMode はMINTO_TEST_MODE環境変数(true/1)を判定する", () => {
    const original = process.env.MINTO_TEST_MODE;
    try {
        delete process.env.MINTO_TEST_MODE;
        assert.equal(mintoUtil.isTestMode(), false);
        process.env.MINTO_TEST_MODE = "true";
        assert.equal(mintoUtil.isTestMode(), true);
        process.env.MINTO_TEST_MODE = "1";
        assert.equal(mintoUtil.isTestMode(), true);
        process.env.MINTO_TEST_MODE = "false";
        assert.equal(mintoUtil.isTestMode(), false);
    } finally {
        if (original === undefined) {
            delete process.env.MINTO_TEST_MODE;
        } else {
            process.env.MINTO_TEST_MODE = original;
        }
    }
});

test("mintoUtil: resolveLocalConfはテストモード時、.test.jsonを優先し.local.jsonは無視する", () => {
    const original = process.env.MINTO_TEST_MODE;
    process.env.MINTO_TEST_MODE = "true";
    try {
        const dir = makeTmpDir();
        const jsonPath = path.join(dir, "env.json");
        const localPath = path.join(dir, "env.local.json");
        const testPath = path.join(dir, "env.test.json");
        fs.writeFileSync(jsonPath, JSON.stringify({ from: "json" }));
        fs.writeFileSync(localPath, JSON.stringify({ from: "local" }));
        fs.writeFileSync(testPath, JSON.stringify({ from: "test" }));

        // .test.jsonが優先される(.local.jsonは無視).
        assert.equal(mintoUtil.resolveLocalConf(jsonPath), testPath);

        // .test.jsonが無ければ、.local.jsonを無視して元の.jsonを使う.
        fs.rmSync(testPath);
        assert.equal(mintoUtil.resolveLocalConf(jsonPath), jsonPath);

        fs.rmSync(dir, { recursive: true, force: true });
    } finally {
        if (original === undefined) {
            delete process.env.MINTO_TEST_MODE;
        } else {
            process.env.MINTO_TEST_MODE = original;
        }
    }
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
