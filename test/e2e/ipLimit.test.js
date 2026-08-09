const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const lambdaIndex = require("../../lambda/src/index.js");

test("IP制限: ipLimit.jsonが無い、またはenabled=falseの場合は全てのIPが許可される", async () => {
    // global.$loadConf をスタブ/モック
    const originalLoadConf = global.$loadConf;
    global.$loadConf = (name) => {
        if (name === "ipLimit.json") {
            return { enabled: false, allow: ["127.0.0.1"] };
        }
        return null;
    };

    try {
        const event = {
            rawPath: "/hello",
            requestContext: {
                http: {
                    sourceIp: "203.0.113.195"
                }
            }
        };
        const res = await lambdaIndex.handler(event, {});
        assert.notEqual(res.statusCode, 403);
    } finally {
        global.$loadConf = originalLoadConf;
    }
});

test("IP制限: 対象IPアドレス以外の場合は 403 返却になる", async () => {
    const originalLoadConf = global.$loadConf;
    global.$loadConf = (name) => {
        if (name === "ipLimit.json") {
            return {
                enabled: true,
                allow: ["192.168.1.0/24", "127.0.0.1", "2001:db8::/32"]
            };
        }
        return null;
    };

    try {
        // 許可IP (127.0.0.1)
        const resAllowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "127.0.0.1" } }
        }, {});
        assert.notEqual(resAllowed.statusCode, 403);

        // 許可IP (IPv4 CIDR 192.168.1.50)
        const resCidrAllowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "192.168.1.50" } }
        }, {});
        assert.notEqual(resCidrAllowed.statusCode, 403);

        // 許可IP (IPv6 CIDR 2001:db8::1)
        const resV6Allowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "2001:db8::1" } }
        }, {});
        assert.notEqual(resV6Allowed.statusCode, 403);

        // 拒否IP (10.0.0.1 -> 範囲外)
        const resDenied = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "10.0.0.1" } }
        }, {});
        assert.equal(resDenied.statusCode, 403);

        // 拒否IP (接続先IPが取得できない場合)
        const resNoIp = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: {}
        }, {});
        assert.equal(resNoIp.statusCode, 403);
    } finally {
        global.$loadConf = originalLoadConf;
    }
});

test("IP制限: 配列形式のipLimit.json設定にも対応する", async () => {
    const originalLoadConf = global.$loadConf;
    global.$loadConf = (name) => {
        if (name === "ipLimit.json") {
            return ["10.0.0.0/8"];
        }
        return null;
    };

    try {
        const resAllowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "10.1.2.3" } }
        }, {});
        assert.notEqual(resAllowed.statusCode, 403);

        const resDenied = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "192.168.1.1" } }
        }, {});
        assert.equal(resDenied.statusCode, 403);
    } finally {
        global.$loadConf = originalLoadConf;
    }
});

test("IP制限: ローカル接続(127.0.0.1や::1)では許可リストに含まれていなくてもIP制限が無効化される", async () => {
    const originalLoadConf = global.$loadConf;
    global.$loadConf = (name) => {
        if (name === "ipLimit.json") {
            return {
                enabled: true,
                allow: ["203.0.113.1"] // 127.0.0.1 や ::1 を含めない
            };
        }
        return null;
    };

    try {
        // 127.0.0.1 からの接続 -> 無効化(許可)
        const resV4Local = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "127.0.0.1" } }
        }, {});
        assert.notEqual(resV4Local.statusCode, 403);

        // ::1 からの接続 -> 無効化(許可)
        const resV6Local = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "::1" } }
        }, {});
        assert.notEqual(resV6Local.statusCode, 403);
    } finally {
        global.$loadConf = originalLoadConf;
    }
});
