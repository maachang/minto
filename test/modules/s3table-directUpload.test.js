// test/modules/s3table-directUpload.test.js
// modules/s3table/directUpload.js の単体テスト.
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-upload-test-storage-"));
    const port = await getFreePort();
    baseUrl = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [LOCAL_AWS_JS, "-p", String(port), "-d", storageDir], {
        stdio: "pipe"
    });
    await waitForServer(baseUrl + "/dummy-bucket?list-type=2", 5000);

    process.env.MINTO_LOCAL_S3_ENDPOINT = baseUrl;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
});

after(() => {
    delete process.env.MINTO_LOCAL_S3_ENDPOINT;
    if (child != null) {
        child.kill();
    }
    if (storageDir != null) {
        fs.rmSync(storageDir, { recursive: true, force: true });
    }
});

const directUpload = require("../../modules/s3table/directUpload.js");

test("directUpload._safeExtension: 拡張子を安全に抽出・サニタイズできる", () => {
    assert.equal(directUpload._safeExtension("photo.PNG"), ".png");
    assert.equal(directUpload._safeExtension("archive.tar.gz"), ".gz");
    assert.equal(directUpload._safeExtension("no_ext"), "");
    assert.equal(directUpload._safeExtension("../evil/path.js"), ".js");
});

test("directUpload._isAllowedContentType: ワイルドカードおよび厳密一致判定", () => {
    const allowed = ["image/*", "application/pdf"];
    assert.equal(directUpload._isAllowedContentType("image/png", allowed), true);
    assert.equal(directUpload._isAllowedContentType("image/jpeg", allowed), true);
    assert.equal(directUpload._isAllowedContentType("application/pdf", allowed), true);
    assert.equal(directUpload._isAllowedContentType("application/json", allowed), false);
    assert.equal(directUpload._isAllowedContentType("text/html", allowed), false);
});

test("directUpload.createUploadTicket: 許可されていないContent-Typeの場合はエラーになる", () => {
    assert.throws(() => {
        directUpload.createUploadTicket({
            bucket: "test-bucket",
            contentType: "application/x-sh",
            allowedTypes: ["image/*", "application/pdf"]
        });
    }, /Content-Type 'application\/x-sh' is not allowed/);
});

test("directUpload: チケット発行 → S3へ直接PUT → verifyUploadedFile で検証成功する", async () => {
    const bucket = "upload-bucket";
    const filename = "user-avatar.png";
    const fileContent = Buffer.from("fake-png-binary-data-for-testing-12345");

    // 1. アップロードチケット発行
    const ticket = directUpload.createUploadTicket({
        bucket: bucket,
        prefix: "avatars/user1/",
        filename: filename,
        contentType: "image/png",
        allowedTypes: ["image/*"],
        maxSize: 10 * 1024 * 1024
    });

    assert.ok(ticket.uploadUrl.startsWith(baseUrl));
    assert.ok(ticket.key.startsWith("avatars/user1/"));
    assert.ok(ticket.key.endsWith(".png"));
    assert.equal(ticket.contentType, "image/png");

    // アップロード前は検証失敗する
    const beforeCheck = await directUpload.verifyUploadedFile(bucket, ticket.key);
    assert.equal(beforeCheck.valid, false);

    // 2. クライアントからの直接PUT通信
    const putRes = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": "image/png"
        },
        body: fileContent
    });
    assert.equal(putRes.status, 200);

    // 3. 完了検証 (verifyUploadedFile)
    const afterCheck = await directUpload.verifyUploadedFile(bucket, ticket.key, {
        maxSize: 10 * 1024 * 1024
    });
    assert.equal(afterCheck.valid, true);
    assert.equal(afterCheck.size, fileContent.length);
    assert.equal(afterCheck.key, ticket.key);
});

test("directUpload.verifyUploadedFile: サイズ超過を検知して検証エラーになる", async () => {
    const bucket = "limit-bucket";
    const ticket = directUpload.createUploadTicket({
        bucket: bucket,
        filename: "large.bin"
    });

    // 100バイト書き込み
    await fetch(ticket.uploadUrl, {
        method: "PUT",
        body: Buffer.alloc(100)
    });

    // maxSize 50バイトで検証
    const check = await directUpload.verifyUploadedFile(bucket, ticket.key, {
        maxSize: 50
    });
    assert.equal(check.valid, false);
    assert.ok(check.error.includes("exceeds maximum allowed size"));
});

test("directUpload.createDownloadTicket: ダウンロードチケット(署名付きGET)が発行できる", () => {
    const ticket = directUpload.createDownloadTicket("my-bucket", "docs/manual.pdf", {
        filename: "マニュアル.pdf",
        asAttachment: true,
        expiresIn: 600
    });

    assert.ok(ticket.downloadUrl.startsWith(baseUrl));
    assert.ok(ticket.downloadUrl.includes("response-content-disposition=attachment"));
    assert.equal(ticket.bucket, "my-bucket");
    assert.equal(ticket.key, "docs/manual.pdf");
});
