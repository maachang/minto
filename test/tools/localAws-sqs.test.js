// tools/localAws.js(ローカルAWSエミュレータ)のうち、SQS(AWS JSON 1.0
// protocol)エミュレーション部分を検証する。
//
// S3 REST API部分は既存の test/modules/s3IndexTable-crud.test.js・
// s3MasterTable-crud.test.js・test/e2e/tableTool.test.js で実際に
// @aws-sdk/client-s3経由で動かして検証済みのため、本テストでは
// SendMessage/ReceiveMessage/DeleteMessageに絞って検証する。
//
// @aws-sdk/client-sqsが未インストール(devDependencies未追加)のため、
// SQSClientは経由せず、実際にAWSクライアントが送信するのと同じ
// AWS JSON 1.0 protocol(x-amz-targetヘッダ + JSONボディ)を生の
// fetchで直接叩いて検証する。
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

// SQS(AWS JSON 1.0 protocol)呼び出し.
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

before(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "localAws-sqs-test-storage-"));
    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [LOCAL_AWS_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    // S3側の疎通確認をもってサーバー起動完了とみなす.
    await waitForServer(baseUrl + "/dummy-bucket?list-type=2", 5000);
});

after(() => {
    if (child != null) {
        child.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
});

test("localAws(SQS): SendMessage→ReceiveMessageでメッセージ内容が取得できる", async () => {
    const queueUrl = baseUrl + "/queue/q1";
    const sendRes = await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: JSON.stringify({ a: 1 }) });
    assert.equal(typeof sendRes.MessageId, "string");
    assert.equal(typeof sendRes.MD5OfMessageBody, "string");

    const recv = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
    assert.equal(recv.Messages.length, 1);
    assert.equal(recv.Messages[0].MessageId, sendRes.MessageId);
    assert.equal(recv.Messages[0].Body, JSON.stringify({ a: 1 }));
    assert.equal(typeof recv.Messages[0].ReceiptHandle, "string");

    // 後始末.
    await sqsCall("DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: recv.Messages[0].ReceiptHandle });
});

test("localAws(SQS): DeleteMessage後は同じメッセージを再受信しない", async () => {
    const queueUrl = baseUrl + "/queue/q2";
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: "hello" });

    const recv1 = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
    assert.equal(recv1.Messages.length, 1);

    await sqsCall("DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: recv1.Messages[0].ReceiptHandle });

    const recv2 = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
    assert.deepEqual(recv2.Messages, []);
});

test("localAws(SQS): ReceiveMessage後、可視性タイムアウト中は同じメッセージを再受信しない", async () => {
    const queueUrl = baseUrl + "/queue/q3";
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: "hello" });

    const recv1 = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10, VisibilityTimeout: 10 });
    assert.equal(recv1.Messages.length, 1);

    // 可視性タイムアウト中(10秒)は再受信されない.
    const recv2 = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
    assert.deepEqual(recv2.Messages, []);

    // 後始末.
    await sqsCall("DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: recv1.Messages[0].ReceiptHandle });
});

test("localAws(SQS): MaxNumberOfMessagesで受信件数の上限が効く", async () => {
    const queueUrl = baseUrl + "/queue/q4";
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: "m1" });
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: "m2" });
    await sqsCall("SendMessage", { QueueUrl: queueUrl, MessageBody: "m3" });

    const recv = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 2 });
    assert.equal(recv.Messages.length, 2);

    // 後始末(残りを全て削除).
    for (;;) {
        const rest = await sqsCall("ReceiveMessage", { QueueUrl: queueUrl, MaxNumberOfMessages: 10 });
        if (rest.Messages.length === 0) {
            break;
        }
        for (const m of rest.Messages) {
            await sqsCall("DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle });
        }
    }
});

test("localAws(SQS): 別々のキュー名は独立して管理される", async () => {
    await sqsCall("SendMessage", { QueueUrl: baseUrl + "/queue/qa", MessageBody: "a" });

    const recvB = await sqsCall("ReceiveMessage", { QueueUrl: baseUrl + "/queue/qb", MaxNumberOfMessages: 10 });
    assert.deepEqual(recvB.Messages, []);

    const recvA = await sqsCall("ReceiveMessage", { QueueUrl: baseUrl + "/queue/qa", MaxNumberOfMessages: 10 });
    assert.equal(recvA.Messages.length, 1);
    await sqsCall("DeleteMessage", { QueueUrl: baseUrl + "/queue/qa", ReceiptHandle: recvA.Messages[0].ReceiptHandle });
});
