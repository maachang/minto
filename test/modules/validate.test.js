// modules/validate/validate.js のテスト.
const validate = require("../../modules/validate/validate.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("validate: 全フィールドが妥当な場合はvalid=trueでdataが返る", () => {
    const result = validate.check(
        { name: "taro", age: 20 },
        {
            name: { type: "string", required: true },
            age: { type: "int" }
        }
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, { name: "taro", age: 20 });
});

test("validate: requiredのフィールドが欠損しているとエラーになる", () => {
    const result = validate.check({}, {
        name: { type: "string", required: true }
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, "name");
    assert.equal(result.errors[0].rule, "required");
});

test("validate: required違反時にmessagesでカスタムメッセージを指定できる", () => {
    const result = validate.check({}, {
        name: { type: "string", required: true, messages: { required: "名前は必須です" } }
    });
    assert.equal(result.errors[0].message, "名前は必須です");
});

test("validate: 未設定かつdefault指定がある場合はdataに補完される", () => {
    const result = validate.check({}, {
        role: { type: "string", default: "user" }
    });
    assert.equal(result.valid, true);
    assert.equal(result.data.role, "user");
});

test("validate: defaultが関数の場合は呼び出し結果が補完される", () => {
    const result = validate.check({}, {
        createdAt: { type: "int", default: () => 123 }
    });
    assert.equal(result.data.createdAt, 123);
});

test("validate: 未設定かつrequiredでもdefaultでも無い場合はそのまま許容される", () => {
    const result = validate.check({}, {
        nickname: { type: "string" }
    });
    assert.equal(result.valid, true);
    assert.equal(result.data.nickname, undefined);
});

test("validate: 型が不正な場合はtypeエラーになる", () => {
    const result = validate.check({ age: "twenty" }, {
        age: { type: "int" }
    });
    assert.equal(result.errors[0].rule, "type");
});

test("validate: 文字列長がminLen/maxLenの範囲外だとエラーになる", () => {
    const tooShort = validate.check({ name: "a" }, {
        name: { type: "string", minLen: 2, maxLen: 10 }
    });
    assert.equal(tooShort.errors[0].rule, "minLen");

    const tooLong = validate.check({ name: "abcdefghijk" }, {
        name: { type: "string", minLen: 2, maxLen: 10 }
    });
    assert.equal(tooLong.errors[0].rule, "maxLen");
});

test("validate: 数値がmin/maxの範囲外だとエラーになる", () => {
    const tooSmall = validate.check({ age: -1 }, {
        age: { type: "int", min: 0, max: 150 }
    });
    assert.equal(tooSmall.errors[0].rule, "min");

    const tooLarge = validate.check({ age: 200 }, {
        age: { type: "int", min: 0, max: 150 }
    });
    assert.equal(tooLarge.errors[0].rule, "max");
});

test("validate: date型はmin/maxをDate同士で比較できる", () => {
    const result = validate.check({ birthday: new Date("2030-01-01") }, {
        birthday: { type: "date", max: new Date("2026-01-01") }
    });
    assert.equal(result.errors[0].rule, "max");
});

test("validate: patternに一致しない文字列はエラーになる", () => {
    const result = validate.check({ zip: "abcde" }, {
        zip: { type: "string", pattern: /^[0-9]{5}$/ }
    });
    assert.equal(result.errors[0].rule, "pattern");
});

test("validate: enumに含まれない値はエラーになる", () => {
    const result = validate.check({ role: "guest" }, {
        role: { type: "string", enum: ["admin", "user"] }
    });
    assert.equal(result.errors[0].rule, "enum");
});

test("validate: customがfalseを返した場合はcustomエラーになる", () => {
    const result = validate.check({ password: "123" }, {
        password: { type: "string", custom: (v) => v.length >= 8 }
    });
    assert.equal(result.errors[0].rule, "custom");
});

test("validate: customが文字列を返した場合はそれがそのままmessageになる", () => {
    const result = validate.check({ password: "123" }, {
        password: { type: "string", custom: (v) => v.length >= 8 ? true : "パスワードは8文字以上必要です" }
    });
    assert.equal(result.errors[0].message, "パスワードは8文字以上必要です");
});

test("validate: 1フィールドにつき最初に失敗したルールのみを記録する", () => {
    const result = validate.check({ age: -1 }, {
        age: { type: "int", min: 0, max: 150 }
    });
    assert.equal(result.errors.length, 1);
});

test("validate: スキーマに定義の無いプロパティはそのままdataに素通りする", () => {
    const result = validate.check({ name: "taro", extra: "x" }, {
        name: { type: "string" }
    });
    assert.equal(result.data.extra, "x");
});

test("validate: 元のdataオブジェクトは変更されない", () => {
    const data = {};
    validate.check(data, { role: { type: "string", default: "user" } });
    assert.equal(data.role, undefined);
});
