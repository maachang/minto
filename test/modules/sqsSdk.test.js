// modules/sdk/sqsSdk.js のテスト.
//
// tools/localAws.js(ローカルAWSエミュレータ)を子プロセスとして起動し、
// 実際に`@aws-sdk/client-sqs`経由で通信させることで、send/receive/deleteの
// 一連の流れと、MINTO_LOCAL_SQS_ENDPOINT設定時の自動ダミークレデンシャル
// (s3sdk.jsと同様の仕組み)を検証する。
//
// 本テストの実行には @aws-sdk/client-sqs(devDependencies)が必要。
// `npm install` 済みであれば自動的に実行される。
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const LOCAL_AWS_JS = path.join(MINTO_HOME, "tools", "localAws.js");

let child;
let storageDir;
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

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqsSdk-test-storage-"));
    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [LOCAL_AWS_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/dummy-bucket?list-type=2", 5000);

    // AWSクレデンシャルは明示的に設定しない。MINTO_LOCAL_SQS_ENDPOINT設定時は
    // sqsSdk.js側が自動的にダミークレデンシャルを使うため不要(この動作自体の
    // 回帰テストを兼ねる)。実行環境に既にAWS認証情報が設定されていてもその
    // 経路を通らないことを保証するため、明示的に削除しておく.
    process.env.MINTO_LOCAL_SQS_ENDPOINT = baseUrl;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
});

after(() => {
    delete process.env.MINTO_LOCAL_SQS_ENDPOINT;
    if (child != null) {
        child.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
});

const sqsSdk = require("../../modules/sdk/sqsSdk.js");

test("sqsSdk: send→receive→deleteの一連の流れがMINTO_LOCAL_SQS_ENDPOINT経由で動作する", async () => {
    const queueUrl = baseUrl + "/queue/sqsSdkTestQueue1";

    const sendRes = await sqsSdk.send(queueUrl, JSON.stringify({ hello: "world" }), { noError: false });
    assert.equal(typeof sendRes.messageId, "string");

    const messages = await sqsSdk.receive(queueUrl, { maxMessages: 10, noError: false });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].messageId, sendRes.messageId);
    assert.equal(messages[0].body, JSON.stringify({ hello: "world" }));
    assert.equal(typeof messages[0].receiptHandle, "string");

    const deleteRes = await sqsSdk.delete(queueUrl, messages[0].receiptHandle, { noError: false });
    assert.equal(deleteRes, true);

    const afterDelete = await sqsSdk.receive(queueUrl, { maxMessages: 10, noError: false });
    assert.deepEqual(afterDelete, []);
});

test("sqsSdk: receiveはmaxMessages件数の上限を守る", async () => {
    const queueUrl = baseUrl + "/queue/sqsSdkTestQueue2";
    await sqsSdk.send(queueUrl, "m1", { noError: false });
    await sqsSdk.send(queueUrl, "m2", { noError: false });
    await sqsSdk.send(queueUrl, "m3", { noError: false });

    const messages = await sqsSdk.receive(queueUrl, { maxMessages: 2, noError: false });
    assert.equal(messages.length, 2);

    // 後始末.
    for (;;) {
        const rest = await sqsSdk.receive(queueUrl, { maxMessages: 10, noError: false });
        if (rest.length === 0) {
            break;
        }
        for (const m of rest) {
            await sqsSdk.delete(queueUrl, m.receiptHandle, { noError: false });
        }
    }
});

test("sqsSdk: メッセージが無いキューのreceiveは空配列を返す", async () => {
    const messages = await sqsSdk.receive(baseUrl + "/queue/sqsSdkEmptyQueue", { maxMessages: 10, noError: false });
    assert.deepEqual(messages, []);
});
