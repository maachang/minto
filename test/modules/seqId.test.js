// modules/s3table/seqId.js のテスト.
// Snowflake ID方式(42bit時刻+10bitワーカーID+12bitシーケンス)のユニークID発行を検証する。
global.$requestId = function () {
    return "test-request-id";
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const seqId = require("../../modules/s3table/seqId.js");

test("seqId: generateは固定長16桁の小文字hex文字列を返す", () => {
    const id = seqId.generate();
    assert.equal(typeof id, "string");
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
});

test("seqId: isValidは16桁の小文字hex文字列のみを正とする", () => {
    assert.equal(seqId.isValid(seqId.generate()), true);
    assert.equal(seqId.isValid("0123456789abcdef"), true);
    assert.equal(seqId.isValid("0123456789ABCDEF"), false);
    assert.equal(seqId.isValid("abc"), false);
    assert.equal(seqId.isValid(12345), false);
    assert.equal(seqId.isValid(null), false);
});

test("seqId: 大量生成しても重複しない(同一ミリ秒内のシーケンス処理を含む)", () => {
    const ids = [];
    for (let i = 0; i < 20000; i++) {
        ids.push(seqId.generate());
    }
    const uniq = new Set(ids);
    assert.equal(uniq.size, ids.length);
});

test("seqId: 生成順に文字列比較で単調増加する(タイムスタンプ部分の順序性)", () => {
    const ids = [];
    for (let i = 0; i < 5000; i++) {
        ids.push(seqId.generate());
    }
    for (let i = 1; i < ids.length; i++) {
        assert.equal(ids[i] > ids[i - 1], true);
    }
});

test("seqId: $requestId()が使えない環境でもエラーにならない", () => {
    // workerIdは初回generate()呼び出し時にメモ化されるため、requireキャッシュを
    // 破棄してモジュールを再読み込みし、$requestId未定義の状態から検証する.
    delete global.$requestId;
    const modulePath = require.resolve("../../modules/s3table/seqId.js");
    delete require.cache[modulePath];
    const freshSeqId = require(modulePath);
    const id = freshSeqId.generate();
    assert.equal(freshSeqId.isValid(id), true);
});
