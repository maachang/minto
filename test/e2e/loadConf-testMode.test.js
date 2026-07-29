// e2eテスト: tools/webapps.jsの$loadConfが、MINTO_TEST_MODE環境変数
// (テストモード)設定時に、conf/xxx.jsonではなくconf/xxx.test.jsonを
// 優先すること、その際conf/xxx.local.jsonは一切参照されないことを検証する。
//
// webapps.test.jsが使う共有fixture(sample-project)は複数テストファイルから
// 参照される可能性があるため、conf/xxx.local.json・conf/xxx.test.jsonを
// 動的に書き込む本テストでは、fixtureを一時ディレクトリへコピーして
// 専用インスタンスとして使う(競合回避).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const FIXTURE_PROJECT_DIR = path.join(__dirname, ".fixtures", "sample-project");
const RUN_SERVER = path.join(__dirname, ".fixtures", "runServer.js");

let child;
let projectDir;
let baseUrl;

const getFreePort = function () {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const p = srv.address().port;
            srv.close(() => resolve(p));
        });
        srv.on("error", reject);
    });
};

const waitForServer = async function (url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const res = await fetch(url);
            await res.arrayBuffer();
            return;
        } catch (e) {
            if (Date.now() - start > timeoutMs) {
                throw new Error("server did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

before(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadConf-testMode-project-"));
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.cpSync(FIXTURE_PROJECT_DIR, projectDir, { recursive: true });

    // conf/sample.jsonに対するローカル専用・テスト専用の上書きを配置する.
    fs.writeFileSync(path.join(projectDir, "conf", "sample.local.json"),
        JSON.stringify({ from: "local" }));
    fs.writeFileSync(path.join(projectDir, "conf", "sample.test.json"),
        JSON.stringify({ from: "test" }));

    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [RUN_SERVER, projectDir, String(port)], {
        env: Object.assign({}, process.env, { MINTO_HOME: MINTO_HOME, MINTO_TEST_MODE: "true" }),
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/hello", 5000);
});

after(() => {
    if (child != null) {
        child.kill();
    }
    if (projectDir != null) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

test("e2e: MINTO_TEST_MODE時、$loadConfはconf/xxx.test.jsonを優先し、conf/xxx.local.jsonは無視する", async () => {
    const res = await fetch(baseUrl + "/loadConf");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { from: "test" });
});

test("e2e: MINTO_TEST_MODE時、conf/xxx.test.jsonが無ければ通常のconf/xxx.jsonを使う(conf/xxx.local.jsonは無視する)", async () => {
    const testConfPath = path.join(projectDir, "conf", "sample.test.json");
    fs.rmSync(testConfPath);
    try {
        const res = await fetch(baseUrl + "/loadConf");
        assert.equal(res.status, 200);
        const body = await res.json();
        // conf/sample.local.json({from:"local"})は無視され、conf/sample.json({from:"json"})が使われる.
        assert.deepEqual(body, { from: "json" });
    } finally {
        fs.writeFileSync(testConfPath, JSON.stringify({ from: "test" }));
    }
});
