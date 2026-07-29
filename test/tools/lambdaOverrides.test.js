// tools/lambdaOverrides.js のテスト.
//
// applyLoadLibModulesFallback/applyLoadConfLocalOverride(globalの$xxxを
// 実際に書き換える処理)自体は、tools/tableTool.js経由の実際の動作を通して
// test/e2e/tableTool.test.js側で検証済みのため、ここでは単体で完結する
// isTestMode/resolveLocalConfのみを対象とする.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lambdaOverrides = require("../../tools/lambdaOverrides.js");

// テスト用一時ディレクトリを作成するヘルパー.
const makeTmpDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lambdaOverrides-test-"));
};

test("lambdaOverrides: resolveLocalConf は同名の.local.jsonが存在すればそちらを返す", () => {
    const dir = makeTmpDir();
    const jsonPath = path.join(dir, "env.json");
    const localPath = path.join(dir, "env.local.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ from: "json" }));
    fs.writeFileSync(localPath, JSON.stringify({ from: "local" }));

    assert.equal(lambdaOverrides.resolveLocalConf(jsonPath), localPath);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("lambdaOverrides: resolveLocalConf は.local.jsonが無ければ元のパスをそのまま返す", () => {
    const dir = makeTmpDir();
    const jsonPath = path.join(dir, "env.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ from: "json" }));

    assert.equal(lambdaOverrides.resolveLocalConf(jsonPath), jsonPath);
    // .jsonで終わらないパスはそのまま返す.
    assert.equal(lambdaOverrides.resolveLocalConf(path.join(dir, "note.txt")), path.join(dir, "note.txt"));
    // 既に.local.jsonのパスはそのまま返す(二重解決しない).
    assert.equal(lambdaOverrides.resolveLocalConf(path.join(dir, "env.local.json")), path.join(dir, "env.local.json"));

    fs.rmSync(dir, { recursive: true, force: true });
});

test("lambdaOverrides: isTestMode はMINTO_TEST_MODE環境変数(true/1)を判定する", () => {
    const original = process.env.MINTO_TEST_MODE;
    try {
        delete process.env.MINTO_TEST_MODE;
        assert.equal(lambdaOverrides.isTestMode(), false);
        process.env.MINTO_TEST_MODE = "true";
        assert.equal(lambdaOverrides.isTestMode(), true);
        process.env.MINTO_TEST_MODE = "1";
        assert.equal(lambdaOverrides.isTestMode(), true);
        process.env.MINTO_TEST_MODE = "false";
        assert.equal(lambdaOverrides.isTestMode(), false);
    } finally {
        if (original === undefined) {
            delete process.env.MINTO_TEST_MODE;
        } else {
            process.env.MINTO_TEST_MODE = original;
        }
    }
});

test("lambdaOverrides: resolveLocalConfはテストモード時、.test.jsonを優先し.local.jsonは無視する", () => {
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
        assert.equal(lambdaOverrides.resolveLocalConf(jsonPath), testPath);

        // .test.jsonが無ければ、.local.jsonを無視して元の.jsonを使う.
        fs.rmSync(testPath);
        assert.equal(lambdaOverrides.resolveLocalConf(jsonPath), jsonPath);

        fs.rmSync(dir, { recursive: true, force: true });
    } finally {
        if (original === undefined) {
            delete process.env.MINTO_TEST_MODE;
        } else {
            process.env.MINTO_TEST_MODE = original;
        }
    }
});
