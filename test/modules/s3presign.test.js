// modules/s3table/s3presign.js のテスト.
//
// 1. AWS SigV4 署名仕様に基づく決定論的URL生成テスト
// 2. tools/localAws.js (ローカルS3エミュレータ) を用いたPUT/GET/DELETEの実通信E2Eテスト
// 3. s3sdk.js 経由の委譲呼び出しテスト
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "s3presign-test-storage-"));
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

const s3presign = require("../../modules/s3table/s3presign.js");
const s3sdk = require("../../modules/s3table/s3sdk.js");

test("s3presign: 決定論的日時とクレデンシャルで正しいAWS SigV4 Presigned GET URLを生成する", () => {
    const fixedDate = new Date("2026-08-15T12:00:00Z");
    const credentials = {
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    };

    const urlStr = s3presign.createPresignedGetUrl("my-bucket", "photos", "vacation.jpg", {
        credentials: credentials,
        region: "ap-northeast-1",
        endpoint: null,
        forcePathStyle: false,
        expiresIn: 3600,
        date: fixedDate
    });

    const parsed = new URL(urlStr);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "my-bucket.s3.ap-northeast-1.amazonaws.com");
    assert.equal(parsed.pathname, "/photos/vacation.jpg");
    assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(parsed.searchParams.get("X-Amz-Credential"), "AKIAIOSFODNN7EXAMPLE/20260815/ap-northeast-1/s3/aws4_request");
    assert.equal(parsed.searchParams.get("X-Amz-Date"), "20260815T120000Z");
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), "3600");
    assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(typeof parsed.searchParams.get("X-Amz-Signature"), "string");
    assert.equal(parsed.searchParams.get("X-Amz-Signature").length, 64);
});

test("s3presign: セッショントークンおよびレスポンスヘッダ上書きパラメータを含めて署名できる", () => {
    const fixedDate = new Date("2026-08-15T12:00:00Z");
    const credentials = {
        access_key: "ASIAEXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        session_token: "AQoDYXdzEJr1EXAMPLE"
    };

    const urlStr = s3presign.createPresignedGetUrl("my-bucket", null, "docs/report.pdf", {
        credentials: credentials,
        region: "ap-northeast-1",
        endpoint: null,
        forcePathStyle: true,
        responseContentType: "application/pdf",
        responseContentDisposition: "attachment; filename=\"report.pdf\"",
        date: fixedDate
    });

    const parsed = new URL(urlStr);
    assert.equal(parsed.pathname, "/my-bucket/docs/report.pdf");
    assert.equal(parsed.searchParams.get("X-Amz-Security-Token"), "AQoDYXdzEJr1EXAMPLE");
    assert.equal(parsed.searchParams.get("response-content-type"), "application/pdf");
    assert.equal(parsed.searchParams.get("response-content-disposition"), "attachment; filename=\"report.pdf\"");
});

test("s3presign: PUT署名付きURLでContentTypeを指定した場合signedHeadersに含まれる", () => {
    const fixedDate = new Date("2026-08-15T12:00:00Z");
    const credentials = {
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    };

    const urlStr = s3presign.createPresignedPutUrl("my-bucket", "uploads", "avatar.png", {
        credentials: credentials,
        region: "ap-northeast-1",
        endpoint: null,
        contentType: "image/png",
        date: fixedDate
    });

    const parsed = new URL(urlStr);
    assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
});

test("s3presign: パスやファイル名に特殊文字・スペースが含まれていても正しくURLエンコードされる", () => {
    const credentials = {
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    };

    const urlStr = s3presign.createPresignedGetUrl("my-bucket", "folder with space", "日本語 ファイル! [test].txt", {
        credentials: credentials,
        region: "ap-northeast-1",
        endpoint: null
    });

    assert.ok(urlStr.includes("folder%20with%20space/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB%21%20%5Btest%5D.txt"));
});

test("s3presign: localAws に対して Presigned PUT → GET → DELETE の一連のHTTP操作ができる", async () => {
    const bucket = "test-presign-bucket";
    const key = "test-file.txt";
    const content = "Hello, Presigned S3 direct upload and download!";

    // 1. PUT Presigned URL 生成
    const putUrl = s3presign.createPresignedPutUrl(bucket, "data", key, {
        expiresIn: 300
    });
    assert.ok(putUrl.startsWith(baseUrl));

    // 2. HTTP PUT 実行
    const putRes = await fetch(putUrl, {
        method: "PUT",
        body: content
    });
    assert.equal(putRes.status, 200);

    // 3. GET Presigned URL 生成
    const getUrl = s3presign.createPresignedGetUrl(bucket, "data", key, {
        expiresIn: 300
    });
    assert.ok(getUrl.startsWith(baseUrl));

    // 4. HTTP GET 実行
    const getRes = await fetch(getUrl);
    assert.equal(getRes.status, 200);
    const text = await getRes.text();
    assert.equal(text, content);

    // 5. DELETE Presigned URL 生成
    const deleteUrl = s3presign.createPresignedDeleteUrl(bucket, "data", key, {
        expiresIn: 300
    });

    // 6. HTTP DELETE 実行
    const delRes = await fetch(deleteUrl, { method: "DELETE" });
    assert.equal(delRes.status, 204);

    // 7. 削除後の再GETは404
    const getResAfterDel = await fetch(getUrl);
    assert.equal(getResAfterDel.status, 404);
});

test("s3presign: s3sdk 経由で署名付きURLを生成し正常にアクセスできる", async () => {
    const bucket = "test-sdk-bucket";
    const key = "sdk-test.json";
    const data = JSON.stringify({ minto: "presign", ok: true });

    const putUrl = s3sdk.createPresignedPutUrl(bucket, null, key);
    const putRes = await fetch(putUrl, { method: "PUT", body: data });
    assert.equal(putRes.status, 200);

    const getUrl = s3sdk.getPresignedGetUrl(bucket, null, key);
    const getRes = await fetch(getUrl);
    assert.equal(getRes.status, 200);
    const fetchedData = await getRes.text();
    assert.equal(fetchedData, data);
});

test("s3presign: パラメータ不正時のエラーハンドリング", () => {
    // method未指定
    assert.equal(s3presign.createPresignedUrl("", "b", null, "k"), null);
    assert.throws(() => s3presign.createPresignedUrl("", "b", null, "k", { noError: false }), /HTTP method is required/);

    // bucket未指定
    assert.equal(s3presign.createPresignedUrl("GET", "", null, "k"), null);
    assert.throws(() => s3presign.createPresignedUrl("GET", "", null, "k", { noError: false }), /Bucket name is required/);

    // key未指定
    assert.equal(s3presign.createPresignedUrl("GET", "b", null, null), null);
    assert.throws(() => s3presign.createPresignedUrl("GET", "b", null, null, { noError: false }), /Key is required/);
});
