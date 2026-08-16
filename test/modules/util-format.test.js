// modules/util/format.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const format = require("../../modules/util/format.js");

test("format: money / comma 金額・数値フォーマット", () => {
    assert.equal(format.money(1250000), "1,250,000");
    assert.equal(format.money(1250000.5), "1,250,000.5");
    assert.equal(format.money("1250000"), "1,250,000");
    assert.equal(format.money(1250000, "¥"), "¥1,250,000");
    assert.equal(format.money(1250000, "$"), "$1,250,000");
    assert.equal(format.comma(999), "999");
    assert.equal(format.comma(1000), "1,000");
    assert.equal(format.money(0), "0");
    assert.equal(format.money(null), "");
    assert.equal(format.money(undefined), "");
    assert.equal(format.money(""), "");
    assert.equal(format.money("invalid"), "invalid");
});

test("format: 全角・半角変換 (toHalfWidth / toFullWidth)", () => {
    // 全角 -> 半角
    assert.equal(format.toHalfWidth("ＡＢＣ１２３　！＃"), "ABC123 !#");
    assert.equal(format.toHalfWidth(""), "");
    assert.equal(format.toHalfWidth(null), "");

    // 半角 -> 全角
    assert.equal(format.toFullWidth("ABC123 !#"), "ＡＢＣ１２３　！＃");
    assert.equal(format.toFullWidth(""), "");
    assert.equal(format.toFullWidth(null), "");
});

test("format: かな・カナ変換 (toHiragana / toKatakana)", () => {
    // カタカナ -> ひらがな
    assert.equal(format.toHiragana("テスト カタカナ ラーメン"), "てすと かたかな らーめん");
    assert.equal(format.toHiragana(""), "");
    assert.equal(format.toHiragana(null), "");

    // ひらがな -> カタカナ
    assert.equal(format.toKatakana("てすと かたかな らーめん"), "テスト カタカナ ラーメン");
    assert.equal(format.toKatakana(""), "");
    assert.equal(format.toKatakana(null), "");
});

test("format: バイトサイズ表記 (bytes)", () => {
    assert.equal(format.bytes(0), "0 B");
    assert.equal(format.bytes("0"), "0 B");
    assert.equal(format.bytes(500), "500 B");
    assert.equal(format.bytes(1024), "1 KB");
    assert.equal(format.bytes(1024 * 1024), "1 MB");
    assert.equal(format.bytes(1024 * 1024 * 1.5), "1.5 MB");
    assert.equal(format.bytes(1024 * 1024 * 1024), "1 GB");
    assert.equal(format.bytes(1024 * 1024 * 1024 * 2.55, 2), "2.55 GB");
    assert.equal(format.bytes(-100), "0 B");
    assert.equal(format.bytes(null), "0 B");
});

test("format: 伏字・マスキング (mask)", () => {
    // 電話番号 (先頭3桁・末尾4桁残し)
    assert.equal(format.mask("09012345678", 3, 4), "090****5678");

    // メールアドレス (先頭2文字・末尾3文字残し)
    assert.equal(format.mask("sample@example.com", 2, 3), "sa*************com");

    // カスタムマスク文字
    assert.equal(format.mask("1234567890", 2, 2, "x"), "12xxxxxx90");

    // 文字数が残す文字数以下の場合は全マスク
    assert.equal(format.mask("12345", 3, 3), "*****");
    assert.equal(format.mask("", 3, 3), "");
    assert.equal(format.mask(null), "");
});

test("format: 文字列切り詰め (truncate) & HTMLエスケープ (escapeHtml)", () => {
    // truncate
    assert.equal(format.truncate("あいうえおかきくけこ", 5), "あいうえお...");
    assert.equal(format.truncate("あいうえおかきくけこ", 5, "…"), "あいうえお…");
    assert.equal(format.truncate("短い", 5), "短い");
    assert.equal(format.truncate("", 5), "");
    assert.equal(format.truncate(null, 5), "");

    // escapeHtml
    assert.equal(
        format.escapeHtml("<script>alert('xss') & \"safe\"</script>"),
        "&lt;script&gt;alert(&#39;xss&#39;) &amp; &quot;safe&quot;&lt;/script&gt;"
    );
    assert.equal(format.escapeHtml(""), "");
    assert.equal(format.escapeHtml(null), "");
});
