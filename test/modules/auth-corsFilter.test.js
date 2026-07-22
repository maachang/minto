// modules/auth/corsFilter.js のテスト.
// $request()/$response() 依存のため、テスト用にスタブしてから読み込む.
let _headers;
let _reqHeaders;
global.$request = function () {
    return {
        header: function (name) {
            return _reqHeaders[name];
        }
    };
};
global.$response = function () {
    return {
        header: function (name, value) {
            _headers[name] = value;
        }
    };
};

const corsFilter = require("../../modules/auth/corsFilter.js");

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

beforeEach(() => {
    _headers = {};
    _reqHeaders = {};
});

test("corsFilter: Originヘッダーが無い場合はtrueを返しヘッダーを設定しない", () => {
    const ok = corsFilter.apply({ origins: ["https://a.example.com"] });
    assert.equal(ok, true);
    assert.deepEqual(_headers, {});
});

test("corsFilter: origins=\"*\"の場合は任意のOriginを許可する", () => {
    _reqHeaders["origin"] = "https://any.example.com";
    const ok = corsFilter.apply({ origins: "*" });
    assert.equal(ok, true);
    assert.equal(_headers["access-control-allow-origin"], "*");
});

test("corsFilter: 許可リストに含まれるOriginは許可されヘッダーが設定される", () => {
    _reqHeaders["origin"] = "https://a.example.com";
    const ok = corsFilter.apply({ origins: ["https://a.example.com", "https://b.example.com"] });
    assert.equal(ok, true);
    assert.equal(_headers["access-control-allow-origin"], "https://a.example.com");
    assert.equal(_headers["access-control-allow-methods"], "GET, POST, PUT, DELETE, OPTIONS");
    assert.equal(_headers["access-control-allow-headers"], "Content-Type, Authorization");
    assert.equal(_headers["access-control-allow-credentials"], undefined);
});

test("corsFilter: 許可リストに無いOriginはfalseを返しヘッダーを設定しない", () => {
    _reqHeaders["origin"] = "https://evil.example.com";
    const ok = corsFilter.apply({ origins: ["https://a.example.com"] });
    assert.equal(ok, false);
    assert.deepEqual(_headers, {});
});

test("corsFilter: options.credentials=trueの場合はAllow-Credentialsヘッダーを設定する", () => {
    _reqHeaders["origin"] = "https://a.example.com";
    corsFilter.apply({ origins: ["https://a.example.com"], credentials: true });
    assert.equal(_headers["access-control-allow-credentials"], "true");
});

test("corsFilter: methods/headersを指定した場合はデフォルト値を上書きする", () => {
    _reqHeaders["origin"] = "https://a.example.com";
    corsFilter.apply({
        origins: ["https://a.example.com"],
        methods: "GET",
        headers: "X-Custom"
    });
    assert.equal(_headers["access-control-allow-methods"], "GET");
    assert.equal(_headers["access-control-allow-headers"], "X-Custom");
});
