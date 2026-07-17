// modules/s3table/s3IndexTable.js のテスト.
// 実際のS3通信を伴うCRUD部分はテスト対象外(docs/testing.mdの方針通り)。
// ここではS3に依存しない純粋なエンコードロジックのみを検証する。
global.$loadLib = function (name) {
    if (name === "s3sdk.js") {
        return {};
    }
    if (name === "seqId.js") {
        return require("../../modules/s3table/seqId.js");
    }
    if (name === "s3Lock.js") {
        return {};
    }
    throw new Error("unexpected $loadLib: " + name);
};
global.$require = function (name) {
    return require(name);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const s3IndexTable = require("../../modules/s3table/s3IndexTable.js");

test("s3IndexTable: encodeInt は整数を数値順と一致する文字列にエンコードする", () => {
    const values = [
        -1000, -100, -10, -1, 0, 1, 10, 100, 1000,
        Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER
    ];
    const encoded = values.map((v) => ({ v, e: s3IndexTable.encodeInt(v) }));
    const byValue = [...encoded].sort((a, b) => a.v - b.v).map((x) => x.v);
    const byEncoded = [...encoded]
        .sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : 0))
        .map((x) => x.v);
    assert.deepEqual(byValue, byEncoded);
    // 固定長(8バイト=16hex)であること.
    for (const { e } of encoded) {
        assert.equal(e.length, 16);
    }
});

test("s3IndexTable: encodeFloat は浮動小数点を数値順と一致する文字列にエンコードする", () => {
    const values = [
        -1000.5, -100, -10.25, -1, -0.0001, 0, 0.0001,
        1, 10.25, 100, 1000.5, -Infinity, Infinity,
        Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE
    ];
    const encoded = values.map((v) => ({ v, e: s3IndexTable.encodeFloat(v) }));
    const byValue = [...encoded].sort((a, b) => a.v - b.v).map((x) => x.v);
    const byEncoded = [...encoded]
        .sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : 0))
        .map((x) => x.v);
    assert.deepEqual(byValue, byEncoded);
});

test("s3IndexTable: encodeString はS3キーセーフな文字列を返す", () => {
    const encoded = s3IndexTable.encodeString("hello! world/with?unsafe#chars");
    assert.match(encoded, /^[0-9a-f]+$/);
});

test("s3IndexTable: encodeString は通常の文字列比較(辞書順)と一致する", () => {
    const pairs = [
        ["Ab", "B"], ["ab", "abc"], ["apple", "banana"], ["Zoo", "apple"]
    ];
    for (const [a, b] of pairs) {
        const normal = a < b;
        const encoded = s3IndexTable.encodeString(a) < s3IndexTable.encodeString(b);
        assert.equal(encoded, normal, `"${a}" と "${b}" の比較結果が一致しない`);
    }
});

test("s3IndexTable: encodeString は255バイトを超えるとエラーになる", () => {
    const longStr = "a".repeat(256);
    assert.throws(() => s3IndexTable.encodeString(longStr));
    // 255バイトちょうどはエラーにならない.
    assert.doesNotThrow(() => s3IndexTable.encodeString("a".repeat(255)));
});

test("s3IndexTable: encodeBoolean は t/f を返す", () => {
    assert.equal(s3IndexTable.encodeBoolean(true), "t");
    assert.equal(s3IndexTable.encodeBoolean(false), "f");
});

test("s3IndexTable: null値はNULL_TOKENにエンコードされる", () => {
    assert.equal(s3IndexTable.encodeInt(null), s3IndexTable.NULL_TOKEN);
    assert.equal(s3IndexTable.encodeFloat(null), s3IndexTable.NULL_TOKEN);
    assert.equal(s3IndexTable.encodeString(null), s3IndexTable.NULL_TOKEN);
    assert.equal(s3IndexTable.encodeBoolean(null), s3IndexTable.NULL_TOKEN);
    // NULL_TOKENは "~" を含み、通常のエンコード結果(hex)には
    // 出現しない文字であること.
    assert.match(s3IndexTable.NULL_TOKEN, /~/);
});

test("s3IndexTable: encodeDate はDateオブジェクトと数値の両方を受け付ける", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    assert.equal(s3IndexTable.encodeDate(d), s3IndexTable.encodeInt(d.getTime()));
    assert.equal(s3IndexTable.encodeDate(d.getTime()), s3IndexTable.encodeInt(d.getTime()));
});

test("s3IndexTable: isRangeSupportedType はbooleanのみfalse、それ以外はtrueとする", () => {
    assert.equal(s3IndexTable.isRangeSupportedType("int"), true);
    assert.equal(s3IndexTable.isRangeSupportedType("float"), true);
    assert.equal(s3IndexTable.isRangeSupportedType("date"), true);
    assert.equal(s3IndexTable.isRangeSupportedType("string"), true);
    assert.equal(s3IndexTable.isRangeSupportedType("boolean"), false);
});

test("s3IndexTable: generateRowId は一意で!を含まない行ファイル名を生成する", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
        ids.add(s3IndexTable.generateRowId());
    }
    assert.equal(ids.size, 100);
    for (const id of ids) {
        assert.equal(id.includes("!"), false);
    }
});
