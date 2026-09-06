// test/tools/jhtmlBrowser.test.js
// public/js/jhtml.browser.js の単体テスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const jhtml = require("../../public/js/jhtml.browser.js");

test("jhtml.escapeHtml: 特殊文字が正しくエスケープされる", () => {
    assert.equal(jhtml.escapeHtml('<div class="a" id=\'b\'>foo & bar</div>'),
        '&lt;div class=&quot;a&quot; id=&#39;b&#39;&gt;foo &amp; bar&lt;/div&gt;');
    assert.equal(jhtml.escapeHtml(null), '');
    assert.equal(jhtml.escapeHtml(undefined), '');
    assert.equal(jhtml.escapeHtml(123), '123');
});

test("jhtml.html: タグ付きテンプレートリテラルで自動エスケープされる", () => {
    const name = '<script>alert(1)</script>';
    const safe = jhtml.raw('<b>OK</b>');
    const result = jhtml.html`<div>${name} - ${safe}</div>`;
    assert.equal(result, '<div>&lt;script&gt;alert(1)&lt;/script&gt; - <b>OK</b></div>');
});

test("jhtml.html: 配列が渡された場合に自動連結される", () => {
    const items = ['apple', '<banana>', 'orange'];
    const result = jhtml.html`<ul>${items.map(it => jhtml.html`<li>${it}</li>`)}</ul>`;
    assert.equal(result, '<ul><li>apple</li><li>&lt;banana&gt;</li><li>orange</li></ul>');
});

test("jhtml.compile & render: 文字列テンプレートからHTMLを非同期レンダリングできる", async () => {
    const tpl = '<% if (show) { %><h1>Hello ${name}!</h1><% } %>';
    const compiled = jhtml.compile(tpl);
    const out1 = await compiled({ show: true, name: 'Taro' });
    assert.equal(out1.trim(), '<h1>Hello Taro!</h1>');

    const out2 = await compiled({ show: false, name: 'Taro' });
    assert.equal(out2.trim(), '');

    // render API直接呼び出し
    const out3 = await jhtml.render(tpl, { show: true, name: '<Hanako>' });
    assert.equal(out3.trim(), '<h1>Hello &lt;Hanako&gt;!</h1>');
});

test("jhtml.format: bytes / money / truncate / date が正常に動作する", () => {
    // bytes
    assert.equal(jhtml.format.bytes(0), '0 B');
    assert.equal(jhtml.format.bytes(1024), '1 KB');
    assert.equal(jhtml.format.bytes(10485760), '10 MB');

    // money
    assert.equal(jhtml.format.money(1000), '1,000');
    assert.equal(jhtml.format.money(1234567.89, '¥'), '¥1,234,567.89');

    // truncate
    assert.equal(jhtml.format.truncate('長い文章のテストです', 5), '長い文章の...');
    assert.equal(jhtml.format.truncate('短い', 10), '短い');

    // date
    const d = new Date(2026, 8, 6, 12, 34, 56);
    assert.equal(jhtml.format.date(d, 'YYYY/MM/DD HH:mm:ss'), '2026/09/06 12:34:56');
});

test("jhtml.state: リアクティブ状態変更でコールバックが発火する", () => {
    const log = [];
    const app = jhtml.state({ count: 0, title: 'init' }, (prop, val, oldVal) => {
        log.push({ prop, val, oldVal });
    });

    app.count = 1;
    app.title = 'updated';
    app.count = 1; // 同じ値なら発火しない

    assert.equal(log.length, 2);
    assert.deepEqual(log[0], { prop: 'count', val: 1, oldVal: 0 });
    assert.deepEqual(log[1], { prop: 'title', val: 'updated', oldVal: 'init' });

    // $watch による追加監視
    let watchedVal = null;
    const unwatch = app.$watch((prop, val) => {
        if (prop === 'count') watchedVal = val;
    });
    app.count = 2;
    assert.equal(watchedVal, 2);

    unwatch();
    app.count = 3;
    assert.equal(watchedVal, 2); // 購読解除後は更新されない
});

test("jhtml.poll: 条件成立で自動停止する", async () => {
    let count = 0;
    await new Promise((resolve) => {
        jhtml.poll(async () => {
            count++;
            if (count >= 3) {
                resolve();
                return true; // 停止
            }
        }, { interval: 10 });
    });
    assert.equal(count, 3);
});
