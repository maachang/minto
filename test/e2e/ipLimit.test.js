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

test("IP制限: 最上位ビットが立つIPv6アドレス(0x80000000以上)のCIDR計算が正確に判定される", async () => {
    const originalLoadConf = global.$loadConf;
    global.$loadConf = (name) => {
        if (name === "ipLimit.json") {
            return {
                enabled: true,
                allow: [
                    "fe80::/10",         // 先頭 0xfe80 (最上位ビットが1)
                    "8000::/16",         // 先頭 0x8000 (最上位ビットが1)
                    "2001:db8:8000::/48" // 3ワード目の最上位ビットが1
                ]
            };
        }
        return null;
    };

    try {
        // fe80::/10 範囲内 -> 許可
        const resFe80Allowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "fe80::1ff:fe23:4567:890a" } }
        }, {});
        assert.notEqual(resFe80Allowed.statusCode, 403);

        // fe80::/10 範囲外 (fec0::1 は 1111 1110 11... で /10 のプレフィックス 1111 1110 10... と不一致) -> 拒否
        const resFe80Denied = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "fec0::1" } }
        }, {});
        assert.equal(resFe80Denied.statusCode, 403);

        // 8000::/16 範囲内 -> 許可
        const res8000Allowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "8000::abcd" } }
        }, {});
        assert.notEqual(res8000Allowed.statusCode, 403);

        // 8000::/16 範囲外 (8001::1) -> 拒否
        const res8000Denied = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "8001::1" } }
        }, {});
        assert.equal(res8000Denied.statusCode, 403);

        // 2001:db8:8000::/48 範囲内 -> 許可
        const resDb8Allowed = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "2001:db8:8000::1" } }
        }, {});
        assert.notEqual(resDb8Allowed.statusCode, 403);

        // 2001:db8:8000::/48 範囲外 -> 拒否
        const resDb8Denied = await lambdaIndex.handler({
            rawPath: "/hello",
            requestContext: { http: { sourceIp: "2001:db8:8001::1" } }
        }, {});
        assert.equal(resDb8Denied.statusCode, 403);
    } finally {
        global.$loadConf = originalLoadConf;
    }
});
