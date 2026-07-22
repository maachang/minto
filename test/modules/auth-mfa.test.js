// modules/auth/mfa.js のテスト.
// $require("crypto") 依存のため、テスト用に $require をスタブしてから読み込む.
global.$require = function (name) {
    return require(name);
};
const mfa = require("../../modules/auth/mfa.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("mfa: create は指定mfaLenちょうどの桁数の数字コードを3つ返す", () => {
    const outNextTime = [];
    const codes = mfa.create(
        outNextTime, "keyCode123", "user1", "domain.example.com", "09012345678", 6, 30);
    assert.equal(codes.length, 3);
    for (const c of codes) {
        assert.equal(typeof c, "string");
        assert.equal(c.length, 6);
        assert.match(c, /^[0-9]+$/);
    }
});

test("mfa: create はmfaLenが奇数でも指定桁数ちょうどになる(先頭0埋め含む)", () => {
    // mfaLenを広い範囲で試し、appendHeadZeroの回帰(先頭0埋めが壊れて
    // 桁数が意図せず伸びる/縮む)が無いことを確認する.
    for (let mfaLen = 1; mfaLen <= 10; mfaLen++) {
        const codes = mfa.create(
            [], "keyCode123", "user1", "domain.example.com", "09012345678", mfaLen, 30);
        for (const c of codes) {
            assert.equal(c.length, mfaLen,
                `mfaLen=${mfaLen} で桁数不一致: "${c}"`);
            assert.match(c, /^[0-9]+$/);
        }
    }
});

test("mfa: 同一パラメータ・同一時間窓なら再現性がある(決定論的)", () => {
    const a = mfa.create(
        [], "keyCode123", "user1", "domain.example.com", "09012345678", 6, 3600);
    const b = mfa.create(
        [], "keyCode123", "user1", "domain.example.com", "09012345678", 6, 3600);
    // updateTimeを1時間にして、テスト実行中に時間窓をまたがない前提で比較する.
    assert.deepEqual(a, b);
});

test("mfa: keyCodeが異なれば生成されるコードも変わる", () => {
    const a = mfa.create(
        [], "keyCode-A", "user1", "domain.example.com", "09012345678", 6, 3600);
    const b = mfa.create(
        [], "keyCode-B", "user1", "domain.example.com", "09012345678", 6, 3600);
    assert.notDeepEqual(a, b);
});

test("mfa: userが異なれば生成されるコードも変わる", () => {
    const a = mfa.create(
        [], "keyCode123", "user1", "domain.example.com", "09012345678", 6, 3600);
    const b = mfa.create(
        [], "keyCode123", "user2", "domain.example.com", "09012345678", 6, 3600);
    assert.notDeepEqual(a, b);
});

test("mfa: key1(ドメイン等)が異なれば生成されるコードも変わる", () => {
    const a = mfa.create(
        [], "keyCode123", "user1", "domain-a.example.com", "09012345678", 6, 3600);
    const b = mfa.create(
        [], "keyCode123", "user1", "domain-b.example.com", "09012345678", 6, 3600);
    assert.notDeepEqual(a, b);
});

test("mfa: key2(電話番号等)が異なれば生成されるコードも変わる", () => {
    const a = mfa.create(
        [], "keyCode123", "user1", "domain.example.com", "09011111111", 6, 3600);
    const b = mfa.create(
        [], "keyCode123", "user1", "domain.example.com", "09022222222", 6, 3600);
    assert.notDeepEqual(a, b);
});

test("mfa: outNextTimeには次の更新までの残り時間と最大更新時間(ミリ秒)が入る", () => {
    const outNextTime = [];
    mfa.create(
        outNextTime, "keyCode123", "user1", "domain.example.com", "09012345678", 6, 30);
    assert.equal(outNextTime.length, 2);
    assert.equal(outNextTime[1], 30 * 1000);
    assert.equal(typeof outNextTime[0], "number");
    assert.ok(outNextTime[0] > 0 && outNextTime[0] <= outNextTime[1]);
});

test("mfa: mfaLenが0以下の場合は例外を投げる", () => {
    assert.throws(() => {
        mfa.create([], "keyCode123", "user1", "domain.example.com", "09012345678", 0, 30);
    });
    assert.throws(() => {
        mfa.create([], "keyCode123", "user1", "domain.example.com", "09012345678", -1, 30);
    });
});

test("mfa: updateTimeが0以下の場合は例外を投げる", () => {
    assert.throws(() => {
        mfa.create([], "keyCode123", "user1", "domain.example.com", "09012345678", 6, 0);
    });
});

test("mfa: keyCode/user/key1/key2のいずれかが未設定(空文字)の場合は例外を投げる", () => {
    assert.throws(() => {
        mfa.create([], "", "user1", "domain.example.com", "09012345678", 6, 30);
    });
    assert.throws(() => {
        mfa.create([], "keyCode123", "", "domain.example.com", "09012345678", 6, 30);
    });
    assert.throws(() => {
        mfa.create([], "keyCode123", "user1", "", "09012345678", 6, 30);
    });
    assert.throws(() => {
        mfa.create([], "keyCode123", "user1", "domain.example.com", "", 6, 30);
    });
});

test("mfa: generateRandomCode はデフォルト24文字のコードを生成する", () => {
    const code = mfa.generateRandomCode();
    assert.equal(typeof code, "string");
    assert.equal(code.length, 24);
});

test("mfa: generateRandomCode は指定文字数(9以上)のコードを生成する", () => {
    const code = mfa.generateRandomCode(16);
    assert.equal(code.length, 16);
});

test("mfa: generateRandomCode は8以下を指定した場合8文字になる", () => {
    assert.equal(mfa.generateRandomCode(8).length, 8);
    assert.equal(mfa.generateRandomCode(1).length, 8);
    assert.equal(mfa.generateRandomCode(0).length, 8);
});

test("mfa: generateRandomCode は数字以外を指定した場合デフォルト24文字になる", () => {
    assert.equal(mfa.generateRandomCode("not-a-number").length, 24);
    assert.equal(mfa.generateRandomCode(undefined).length, 24);
});

test("mfa: generateRandomCode は呼び出す毎に異なる値を返す(十分な連続呼び出しで)", () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) {
        codes.add(mfa.generateRandomCode(24));
    }
    // hrtimeのナノ秒成分をseedにしているため理論上衝突しうるが、
    // 20回程度の連続呼び出しで全て一致することは通常無い.
    assert.ok(codes.size > 1);
});
