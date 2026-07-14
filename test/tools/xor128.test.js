// tools/xor128.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const xor128 = require("../../tools/xor128.js");

test("xor128: 同じseedなら同じ乱数列を再現できる", () => {
    const a = xor128.create(12345);
    const b = xor128.create(12345);
    for (let i = 0; i < 10; i++) {
        assert.equal(a.next(), b.next());
    }
});

test("xor128: 異なるseedなら異なる乱数列になる", () => {
    const a = xor128.create(1);
    const b = xor128.create(2);
    // 最初の数回で少なくとも1回は値が異なること.
    let diff = false;
    for (let i = 0; i < 5; i++) {
        if (a.next() !== b.next()) {
            diff = true;
            break;
        }
    }
    assert.equal(diff, true);
});

test("xor128: getBytes は指定バイト数のBufferを返す", () => {
    const r = xor128.create(1);
    const buf = r.getBytes(16);
    assert.equal(Buffer.isBuffer(buf), true);
    assert.equal(buf.length, 16);
});

test("xor128: getUUID はRFC4122 version4/variant準拠のフォーマットを返す", () => {
    const r = xor128.create(1);
    const uuid = r.getUUID();
    // 8-4-4-4-12 桁のハイフン区切り.
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // versionニブル(3グループ目先頭)は "4".
    const groups = uuid.split("-");
    assert.equal(groups[2][0], "4");
    // variantニブル(4グループ目先頭)は 8/9/a/b のいずれか.
    assert.match(groups[3][0], /[89ab]/);
});

test("xor128: getPassword は指定文字数・文字種のパスワードを生成する", () => {
    const r = xor128.create(1);
    const pw = r.getPassword(12, true, true, true, false);
    assert.equal(pw.length, 12);
    assert.match(pw, /^[0-9A-Za-z]+$/);
});

test("xor128: getPassword はsize<=0で空文字、9999超で null", () => {
    const r = xor128.create(1);
    assert.equal(r.getPassword(0, true), "");
    assert.equal(r.getPassword(10000, true), null);
});

test("xor128: random() はデフォルトジェネレーターを返しUUIDが生成できる", () => {
    const r = xor128.random();
    const uuid = r.getUUID();
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
