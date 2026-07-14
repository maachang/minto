// modules/http/response.js のテスト.
// lambda/src/index.js が提供するグローバル関数 $response() に依存するため、
// テスト用に呼び出し内容を記録するスタブを差し替えてから読み込む.
let recorded;
global.$response = function () {
    recorded = { contentType: null, status: null, body: null };
    return {
        contentType: function (type, charset) {
            recorded.contentType = [type, charset];
        },
        status: function (code) {
            recorded.status = code;
        },
        body: function (data) {
            recorded.body = data;
        }
    };
};
const response = require("../../modules/http/response.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("response.json: デフォルトstatusは200でJSON文字列がbodyに設定される", () => {
    response.json({ a: 1 });
    assert.deepEqual(recorded.contentType, ["application/json", "utf-8"]);
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body, JSON.stringify({ a: 1 }));
});

test("response.json: statusを指定した場合はその値が設定される", () => {
    response.json({ a: 1 }, 201);
    assert.equal(recorded.status, 201);
});

test("response.error: statusとmessageからerrorボディが組み立てられる", () => {
    response.error(404, "not found");
    assert.equal(recorded.status, 404);
    assert.deepEqual(JSON.parse(recorded.body), { error: "not found" });
});

test("response.error: extraを指定した場合はerrorとマージされる", () => {
    response.error(400, "invalid param", { code: "INVALID_PARAM" });
    assert.deepEqual(JSON.parse(recorded.body), {
        code: "INVALID_PARAM",
        error: "invalid param"
    });
});
