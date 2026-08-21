// test/tools/jhtml.test.js
// jhtml の変換および $include 機能のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const jhtml = require("../../tools/jhtml.js");
const lambda = require("../../lambda/src/index.js");

test("jhtml.convert: 基本的な変換", async () => {
    const src = `
<% const name = "world"; %>
<h1>Hello <%= name %></h1>
<p>\${name}</p>
`;
    const js = jhtml.convert(src);
    assert.match(js, /exports\.handler = async function\(\$params\)/);
    assert.match(js, /let _\$outString = "";/);

    const exp = {};
    Function("exports", "module", js)(exp, { exports: exp });
    const result = await exp.handler();
    assert.match(result, /<h1>Hello world<\/h1>/);
    assert.match(result, /<p>world<\/p>/);
});

test("jhtml.convert: $params を受け取ってアクセスできる", async () => {
    const src = `<h1>\${$params.title}</h1><p>\${$params.count + 1}</p>`;
    const js = jhtml.convert(src);
    const exp = {};
    Function("exports", "module", js)(exp, { exports: exp });
    const result = await exp.handler({ title: "Minto Title", count: 10 });
    assert.equal(result.trim(), "<h1>Minto Title</h1><p>11</p>");
});

test("jhtml.convert: $params 省略時もエラーにならず空オブジェクトとして扱われる", async () => {
    const src = `<p>\${$params.title || "default"}</p>`;
    const js = jhtml.convert(src);
    const exp = {};
    Function("exports", "module", js)(exp, { exports: exp });
    const result = await exp.handler();
    assert.equal(result.trim(), "<p>default</p>");
});

test("jhtml.convert: $out のチェーン呼び出しができる", async () => {
    const src = `<% $out("A")("B")("C"); %>`;
    const js = jhtml.convert(src);
    const exp = {};
    Function("exports", "module", js)(exp, { exports: exp });
    const result = await exp.handler();
    assert.equal(result.trim(), "ABC");
});

test("jhtml.convert: ${$include(...)} および <%= $include(...) %> に自動で await が補完される", () => {
    const src1 = `<div>\${$include("./header.mt.html")}</div>`;
    const js1 = jhtml.convert(src1);
    assert.match(js1, /\$out\(await \$include\("\.\/header\.mt\.html"\)\);/);

    const src2 = `<div><%= $include("./header.mt.html", { title: "abc" }) %></div>`;
    const js2 = jhtml.convert(src2);
    assert.match(js2, /\$out\(await \$include\("\.\/header\.mt\.html", \{ title: "abc" \}\)\);/);

    const src3 = `<div>\${await $include("./header.mt.html")}</div>`;
    const js3 = jhtml.convert(src3);
    assert.match(js3, /\$out\(await \$include\("\.\/header\.mt\.html"\)\);/);
    assert.doesNotMatch(js3, /await await/);
});

// $include ランタイム動作のテスト (lambda/src/index.js 連携)
test("$include: 開発モード (setJHTMLConvFunc) での相対パス・パラメータ受け渡し・ネスト", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-jhtml-test-"));
    try {
        const publicDir = path.join(tmpDir, "public");
        const partsDir = path.join(publicDir, "parts");
        fs.mkdirSync(partsDir, { recursive: true });

        // header.mt.html
        fs.writeFileSync(path.join(partsDir, "header.mt.html"), `<header><h1>\${$params.title}</h1></header>`);
        // nav.mt.html
        fs.writeFileSync(path.join(partsDir, "nav.mt.html"), `<nav>\${$include("./header.mt.html", { title: $params.pageTitle })}</nav>`);
        // footer.html (static HTML)
        fs.writeFileSync(path.join(partsDir, "footer.html"), `<footer>footer-content</footer>`);
        // index.mt.html
        fs.writeFileSync(path.join(publicDir, "index.mt.html"), `
\${$include("./parts/nav.mt.html", { pageTitle: "TopPage" })}
<main>Main Content</main>
\${$include("parts/footer.html")}
`);

        lambda.setBasePath(tmpDir);
        lambda.setJHTMLConvFunc(jhtml.convert);
        lambda.clearCache();

        const res = await lambda.handler({ rawPath: "/index" }, { awsRequestId: "req-1" });
        assert.equal(res.statusCode, 200);
        assert.match(res.body, /<header><h1>TopPage<\/h1><\/header>/);
        assert.match(res.body, /<nav>/);
        assert.match(res.body, /<main>Main Content<\/main>/);
        assert.match(res.body, /<footer>footer-content<\/footer>/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("$include: 拡張子省略 (/parts/header や header) でも解決できる", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-jhtml-test-"));
    try {
        const publicDir = path.join(tmpDir, "public");
        const partsDir = path.join(publicDir, "parts");
        fs.mkdirSync(partsDir, { recursive: true });

        fs.writeFileSync(path.join(partsDir, "header.mt.html"), `<header>\${$params.text}</header>`);
        fs.writeFileSync(path.join(publicDir, "index.mt.html"), `\${$include("/parts/header", { text: "NoExt" })}`);

        lambda.setBasePath(tmpDir);
        lambda.setJHTMLConvFunc(jhtml.convert);
        lambda.clearCache();

        const res = await lambda.handler({ rawPath: "/index" }, { awsRequestId: "req-2" });
        assert.equal(res.statusCode, 200);
        assert.match(res.body, /<header>NoExt<\/header>/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("$include: 本番モード (.jhtml.js にコンパイル済み) でも動作する", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-jhtml-test-"));
    try {
        const publicDir = path.join(tmpDir, "public");
        fs.mkdirSync(publicDir, { recursive: true });

        const headerSrc = `<header><h1>\${$params.title}</h1></header>`;
        const indexSrc = `\${$include("header.mt.html", { title: "ProdTitle" })}<div>Body</div>`;

        fs.writeFileSync(path.join(publicDir, "header.jhtml.js"), jhtml.convert(headerSrc));
        fs.writeFileSync(path.join(publicDir, "index.jhtml.js"), jhtml.convert(indexSrc));

        lambda.setBasePath(tmpDir);
        lambda.setJHTMLConvFunc(null); // 本番環境相当
        lambda.clearCache();

        const res = await lambda.handler({ rawPath: "/index" }, { awsRequestId: "req-3" });
        assert.equal(res.statusCode, 200);
        assert.match(res.body, /<header><h1>ProdTitle<\/h1><\/header>/);
        assert.match(res.body, /<div>Body<\/div>/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("$include: 循環インクルードを検知してエラーになる", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-jhtml-test-"));
    try {
        const publicDir = path.join(tmpDir, "public");
        fs.mkdirSync(publicDir, { recursive: true });

        fs.writeFileSync(path.join(publicDir, "a.mt.html"), `\${$include("b.mt.html")}`);
        fs.writeFileSync(path.join(publicDir, "b.mt.html"), `\${$include("a.mt.html")}`);

        lambda.setBasePath(tmpDir);
        lambda.setJHTMLConvFunc(jhtml.convert);
        lambda.clearCache();

        const res = await lambda.handler({ rawPath: "/a" }, { awsRequestId: "req-4" });
        assert.equal(res.statusCode, 500);
        assert.match(res.body, /Internal Server Error/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("$include: 存在しないファイルをインクルードするとエラーになる", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "minto-jhtml-test-"));
    try {
        const publicDir = path.join(tmpDir, "public");
        fs.mkdirSync(publicDir, { recursive: true });

        fs.writeFileSync(path.join(publicDir, "index.mt.html"), `\${$include("nonexistent.mt.html")}`);

        lambda.setBasePath(tmpDir);
        lambda.setJHTMLConvFunc(jhtml.convert);
        lambda.clearCache();

        const res = await lambda.handler({ rawPath: "/index" }, { awsRequestId: "req-5" });
        assert.equal(res.statusCode, 500);
        assert.match(res.body, /Internal Server Error/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
