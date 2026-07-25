// modules/http/multipart.js のテスト.
// 依存グローバル関数は無いため、requestオブジェクトを直接スタブして渡す.
const multipart = require("../../modules/http/multipart.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

// テスト用リクエストスタブを生成する.
const _makeRequest = function (contentType, body) {
    return {
        header: function (name) {
            if (name === "content-type") {
                return contentType;
            }
            return undefined;
        },
        body: function () {
            return body;
        }
    };
};

test("multipart.parse: content-typeがmultipart/form-data以外の場合は空オブジェクトを返す", () => {
    const req = _makeRequest("application/json", Buffer.from("{}"));
    assert.deepEqual(multipart.parse(req), {});
});

test("multipart.parse: boundaryが無い場合は空オブジェクトを返す", () => {
    const req = _makeRequest("multipart/form-data", Buffer.from(""));
    assert.deepEqual(multipart.parse(req), {});
});

test("multipart.parse: テキストフィールドを文字列として取得できる", () => {
    const boundary = "----WebKitFormBoundaryXXXX";
    const body = Buffer.from(
        "--" + boundary + "\r\n" +
        "Content-Disposition: form-data; name=\"username\"\r\n" +
        "\r\n" +
        "taro\r\n" +
        "--" + boundary + "--\r\n"
    );
    const req = _makeRequest(
        "multipart/form-data; boundary=" + boundary, body);
    const result = multipart.parse(req);
    assert.deepEqual(result, { username: "taro" });
});

test("multipart.parse: ファイルフィールドを{filename, contentType, data}として取得できる", () => {
    const boundary = "----WebKitFormBoundaryXXXX";
    const fileData = Buffer.from([0x01, 0x02, 0x03, 0xff]);
    const body = Buffer.concat([
        Buffer.from(
            "--" + boundary + "\r\n" +
            "Content-Disposition: form-data; name=\"avatar\"; filename=\"photo.jpg\"\r\n" +
            "Content-Type: image/jpeg\r\n" +
            "\r\n"),
        fileData,
        Buffer.from("\r\n--" + boundary + "--\r\n")
    ]);
    const req = _makeRequest(
        "multipart/form-data; boundary=\"" + boundary + "\"", body);
    const result = multipart.parse(req);
    assert.equal(result.avatar.filename, "photo.jpg");
    assert.equal(result.avatar.contentType, "image/jpeg");
    assert.ok(Buffer.compare(result.avatar.data, fileData) === 0);
});

test("multipart.parse: 複数フィールド(テキスト+ファイル)を同時に取得できる", () => {
    const boundary = "----WebKitFormBoundaryXXXX";
    const body = Buffer.from(
        "--" + boundary + "\r\n" +
        "Content-Disposition: form-data; name=\"username\"\r\n" +
        "\r\n" +
        "taro\r\n" +
        "--" + boundary + "\r\n" +
        "Content-Disposition: form-data; name=\"memo\"; filename=\"memo.txt\"\r\n" +
        "Content-Type: text/plain\r\n" +
        "\r\n" +
        "hello\r\n" +
        "--" + boundary + "--\r\n"
    );
    const req = _makeRequest(
        "multipart/form-data; boundary=" + boundary, body);
    const result = multipart.parse(req);
    assert.equal(result.username, "taro");
    assert.equal(result.memo.filename, "memo.txt");
    assert.equal(result.memo.data.toString("utf-8"), "hello");
});
