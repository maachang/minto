// e2eテスト: tools/tableTool.js(テーブル管理コマンド: createTable/dropTable/
// alterTable/alterIndex)を、実際に子プロセスとして起動して検証する。
//
// tools/localS3.js(ローカルS3エミュレータ)を子プロセスとして起動し、その上で
// 実際に`node tools/tableTool.js -t ... -c ...`を実行して、標準出力のJSON結果を
// 検証する(bin/tableToolが実行するのと同じtools/tableTool.jsを直接使う)。
//
// 本テストの実行には @aws-sdk/client-s3(devDependencies)が必要。
// `npm install` 済みであれば自動的に実行される。
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const LOCAL_S3_JS = path.join(MINTO_HOME, "tools", "localS3.js");
const TABLE_TOOL_JS = path.join(MINTO_HOME, "tools", "tableTool.js");
const BUCKET = "test-bucket";

let s3Child;
let storageDir;
let projectDir;
let baseUrl;
let s3Env;

// OSに空きポートを割り当ててもらう.
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

// サーバーが起動してリクエストに応答できるようになるまでポーリングする.
const waitForServer = async function (url, timeoutMs) {
    const start = Date.now();
    for (;;) {
        try {
            const res = await fetch(url);
            await res.arrayBuffer();
            return;
        } catch (e) {
            if (Date.now() - start > timeoutMs) {
                throw new Error("localS3 did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

// conf/table/{target}.jsonを書き込む.
const writeTableConf = function (target, options, tables) {
    fs.writeFileSync(
        path.join(projectDir, "conf", "table", target + ".json"),
        JSON.stringify({ options: options, tables: tables })
    );
};

// tools/tableTool.jsを子プロセスとして実行し、標準出力のJSONを返す.
const runTableTool = function (args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [TABLE_TOOL_JS].concat(args), {
            cwd: projectDir,
            env: s3Env,
            stdio: "pipe"
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", () => {
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error("failed to parse tableTool output: " + stdout + "\n" + stderr));
            }
        });
        child.on("error", reject);
    });
};

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "tableTool-test-storage-"));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tableTool-test-project-"));

    // fixtureプロジェクトの lib/ に、実物のmodules/s3table/*.jsを絶対パスで
    // re-exportするスタブを配置する(コピーによる重複・鮮度ズレを避けるため).
    const libDir = path.join(projectDir, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, "conf", "table"), { recursive: true });
    for (const name of ["s3sdk.js", "s3Lock.js", "s3MasterTable.js", "s3IndexTable.js", "seqId.js"]) {
        const realPath = path.join(MINTO_HOME, "modules", "s3table", name).replace(/\\/g, "\\\\");
        fs.writeFileSync(path.join(libDir, name),
            "module.exports = require(\"" + realPath + "\");\n");
    }

    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    s3Child = spawn(process.execPath, [LOCAL_S3_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/" + BUCKET + "?list-type=2", 5000);

    s3Env = Object.assign({}, process.env, {
        MINTO_LOCAL_S3_ENDPOINT: baseUrl,
        AWS_ACCESS_KEY_ID: "local",
        AWS_SECRET_ACCESS_KEY: "local"
    });
});

after(() => {
    if (s3Child != null) {
        s3Child.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
    if (projectDir != null) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

test("tableTool: createTableは未作成のテーブルのみ作成する(べき等)", async () => {
    writeTableConf("master", { bucket: BUCKET }, {
        users: { columns: { name: { type: "string" }, age: { type: "int" } } }
    });

    const r1 = await runTableTool(["-t", "master", "-c", "createTable"]);
    assert.deepEqual(r1, { command: "createTable", target: "master", created: ["users"] });

    // 2回目は既に存在するので何も作成されない.
    const r2 = await runTableTool(["-t", "master", "-c", "createTable"]);
    assert.deepEqual(r2, { command: "createTable", target: "master", created: [] });
});

test("tableTool: alterTableはカラムの追加・削除を反映する", async () => {
    writeTableConf("master", { bucket: BUCKET }, {
        users: {
            columns: {
                name: { type: "string" },
                role: { type: "string", default: "member" }
            }
        }
    });

    const r = await runTableTool(["-t", "master", "-c", "alterTable"]);
    assert.equal(r.command, "alterTable");
    assert.equal(r.altered.length, 1);
    assert.equal(r.altered[0].tableName, "users");
    assert.deepEqual(r.altered[0].addedColumns, ["role"]);
    assert.deepEqual(r.altered[0].removedColumns, ["age"]);
});

test("tableTool: alterTableはnotNullカラム追加時にdefault未指定だと検証エラーで中断する", async () => {
    writeTableConf("master", { bucket: BUCKET }, {
        users: {
            columns: {
                name: { type: "string" },
                role: { type: "string", default: "member" },
                email: { type: "string", notNull: true }
            }
        }
    });

    const r = await runTableTool(["-t", "master", "-c", "alterTable"]);
    assert.equal(r.command, "alterTable");
    assert.match(r.error, /検証エラー/);
    assert.equal(r.details.length, 1);
});

test("tableTool: alterTableはprimaryKey/unique変更を検知すると中断する", async () => {
    writeTableConf("master", { bucket: BUCKET }, {
        users: {
            columns: {
                name: { type: "string", unique: true },
                role: { type: "string", default: "member" }
            }
        }
    });

    const r = await runTableTool(["-t", "master", "-c", "alterTable"]);
    assert.match(r.error, /検証エラー/);
    assert.match(r.details[0], /primaryKey\/unique/);
});

test("tableTool: dropTableは定義から消えたテーブルを削除する", async () => {
    writeTableConf("master", { bucket: BUCKET }, {});
    const r = await runTableTool(["-t", "master", "-c", "dropTable"]);
    assert.deepEqual(r, { command: "dropTable", target: "master", dropped: ["users"] });
});

test("tableTool: index対象でcreateTable→alterIndexでインデックスを追加できる", async () => {
    writeTableConf("index", { bucket: BUCKET, prefix: "idx/" }, {
        logs: {
            columns: { name: { type: "string" }, level: { type: "string" } },
            indexes: { byName: ["name"] }
        }
    });
    const r1 = await runTableTool(["-t", "index", "-c", "createTable"]);
    assert.deepEqual(r1, { command: "createTable", target: "index", created: ["logs"] });

    writeTableConf("index", { bucket: BUCKET, prefix: "idx/" }, {
        logs: {
            columns: { name: { type: "string" }, level: { type: "string" } },
            indexes: { byName: ["name"], byLevel: ["level"] }
        }
    });
    const r2 = await runTableTool(["-t", "index", "-c", "alterIndex", "-n", "logs"]);
    assert.deepEqual(r2, {
        command: "alterIndex", target: "index", tableName: "logs",
        addedIndexes: ["byLevel"], removedIndexes: []
    });
});

test("tableTool: 定義ファイルが存在しない場合はエラーを返す", async () => {
    fs.rmSync(path.join(projectDir, "conf", "table", "master.json"), { force: true });
    const r = await runTableTool(["-t", "master", "-c", "createTable"]);
    assert.match(r.error, /定義ファイルが見つかりません/);
});
