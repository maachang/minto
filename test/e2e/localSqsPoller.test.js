// e2eテスト: tools/localSqsPoller.js(SQSトリガー模擬ポーラー)を、実際に
// 子プロセスとして起動して検証する。
//
// tools/localAws.js(ローカルAWSエミュレータ)を子プロセスとして起動し、
// 生のfetchでAWS JSON 1.0 protocolのSendMessageでキューにメッセージを
// 投入した上で、localSqsPoller.jsを子プロセス起動してポーリングさせ、
// fixtureプロジェクトの public/runSqs.mt.js が実際に呼び出され、処理後に
// メッセージがキューから削除されることを確認する。
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const LOCAL_AWS_JS = path.join(MINTO_HOME, "tools", "localAws.js");
const LOCAL_SQS_POLLER_JS = path.join(MINTO_HOME, "tools", "localSqsPoller.js");
const RECEIVED_LOG = "received.log";

let awsChild;
let storageDir;
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
                throw new Error("localAws did not start in time: " + e.message);
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
};

const sqsCall = async function (action, input) {
    const res = await fetch(baseUrl + "/", {
        method: "POST",
        headers: {
            "content-type": "application/x-amz-json-1.0",
            "x-amz-target": "AmazonSQS." + action
        },
        body: JSON.stringify(input)
    });
    return await res.json();
};

// 指定した回数分、条件を満たすまでポーリングする(タイムアウト付き).
const waitFor = async function (checkFn, timeoutMs) {
    const start = Date.now();
    for (;;) {
        const r = checkFn();
        if (r) {
            return r;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((r2) => setTimeout(r2, 50));
    }
};

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "localSqsPoller-test-storage-"));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localSqsPoller-test-project-"));
    fs.mkdirSync(path.join(projectDir, "public"), { recursive: true });

    // 受信したparamsを1行1JSONで追記するfixture.
    const logPath = path.join(projectDir, RECEIVED_LOG).replace(/\\/g, "\\\\");
    fs.writeFileSync(path.join(projectDir, "public", "runSqs.mt.js"),
        "exports.handler = async function (params) {\n" +
        "    const fs = $require(\"fs\");\n" +
        "    fs.appendFileSync(\"" + logPath + "\", JSON.stringify(params) + \"\\n\");\n" +
        "};\n");

    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    awsChild = spawn(process.execPath, [LOCAL_AWS_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/dummy-bucket?list-type=2", 5000);
});

after(() => {
    if (awsChild != null) {
        awsChild.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
    if (projectDir != null) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

test("localSqsPoller: 受信したメッセージがrunSqs.mt.jsに渡り、処理後にキューから削除される", async () => {
    const queueName = "pollerTestQueue";
    const queueUrl = baseUrl + "/queue/" + queueName;
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: JSON.stringify({ msg: 1 }) });
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: JSON.stringify({ msg: 2 }) });

    const logPath = path.join(projectDir, RECEIVED_LOG);
    const poller = spawn(process.execPath,
        [LOCAL_SQS_POLLER_JS, "-e", baseUrl, "-q", queueName, "-i", "200"],
        { cwd: projectDir, stdio: "pipe" });

    try {
        await waitFor(() => {
            if (!fs.existsSync(logPath)) {
                return false;
            }
            const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter((l) => l.length > 0);
            return lines.length >= 2 ? lines : null;
        }, 5000);
    } finally {
        poller.kill("SIGINT");
    }

    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    const received = lines.map((l) => JSON.parse(l));
    assert.deepEqual(
        received.map((r) => r.msg).sort(),
        [1, 2]
    );

    // 処理後はキューから削除されていること.
    const rest = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
    assert.deepEqual(rest.Messages, []);
});

test("localSqsPoller: メッセージが無いキューは-qのみ指定して起動でき、正常に待機し続ける", async () => {
    const poller = spawn(process.execPath,
        [LOCAL_SQS_POLLER_JS, "-e", baseUrl, "-q", "emptyQueue", "-i", "200"],
        { cwd: projectDir, stdio: "pipe" });

    let stderr = "";
    poller.stderr.on("data", (d) => { stderr += d.toString(); });

    await new Promise((r) => setTimeout(r, 500));
    poller.kill("SIGINT");
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(stderr, "");
});
