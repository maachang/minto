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

test("validate: int/floatは数字として妥当な文字列も許容する(値はそのまま文字列で保持)", () => {
    const result = validate.check(
        { age: "20", price: "12.5" },
        {
            age: { type: "int", min: 0, max: 150 },
            price: { type: "float", min: 0 }
        }
    );
    assert.equal(result.valid, true);
    assert.equal(result.data.age, "20");
    assert.equal(result.data.price, "12.5");
});

test("validate: int型は小数を含む文字列や数字でない文字列はエラーになる", () => {
    const result = validate.check({ age: "20.5" }, { age: { type: "int" } });
    assert.equal(result.errors[0].rule, "type");

    const result2 = validate.check({ age: "twenty" }, { age: { type: "int" } });
    assert.equal(result2.errors[0].rule, "type");
});

test("validate: 数字文字列でもmin/maxの範囲比較が数値として行われる", () => {
    const tooSmall = validate.check({ age: "-1" }, { age: { type: "int", min: 0 } });
    assert.equal(tooSmall.errors[0].rule, "min");

    const ok = validate.check({ age: "9" }, { age: { type: "int", min: 0, max: 10 } });
    assert.equal(ok.valid, true);
});

test("validate: boolean/dateは文字列を許容しない", () => {
    const boolResult = validate.check({ active: "true" }, { active: { type: "boolean" } });
    assert.equal(boolResult.errors[0].rule, "type");

    const dateResult = validate.check({ birthday: "2030-01-01" }, { birthday: { type: "date" } });
    assert.equal(dateResult.errors[0].rule, "type");
});

test("validate: customにはvalueに加えてdataオブジェクト全体が渡される(フィールド間チェック用)", () => {
    const result = validate.check(
        { password: "abcdefgh", confirmPassword: "different" },
        {
            confirmPassword: {
                type: "string",
                custom: (v, data) => v === data.password ? true : "パスワードが一致しません"
            }
        }
    );
    assert.equal(result.errors[0].message, "パスワードが一致しません");
});

test("validate: 元のdataオブジェクトは変更されない", () => {
    const data = {};
    validate.check(data, { role: { type: "string", default: "user" } });
    assert.equal(data.role, undefined);
});

test("validate: range で数値・日付の範囲を検証できる", () => {
    // 配列指定 [min, max]
    const ok = validate.check({ age: 20 }, { age: { type: "int", range: [18, 65] } });
    assert.equal(ok.valid, true);

    const tooSmall = validate.check({ age: 17 }, { age: { type: "int", range: [18, 65] } });
    assert.equal(tooSmall.valid, false);
    assert.equal(tooSmall.errors[0].rule, "range");
    assert.equal(tooSmall.errors[0].message, "ageは18〜65の範囲で入力してください");

    const tooLarge = validate.check({ age: 66 }, { age: { type: "int", range: [18, 65] } });
    assert.equal(tooLarge.valid, false);
    assert.equal(tooLarge.errors[0].rule, "range");

    // オブジェクト指定 { min, max }
    const objOk = validate.check({ score: 85.5 }, { score: { type: "float", range: { min: 0, max: 100 } } });
    assert.equal(objOk.valid, true);

    const objErr = validate.check({ score: 105.0 }, { score: { type: "float", range: { min: 0, max: 100 } } });
    assert.equal(objErr.valid, false);
    assert.equal(objErr.errors[0].rule, "range");
});

test("validate: mail でメールアドレス形式を検証できる", () => {
    const ok = validate.check({ email: "user@example.com" }, { email: { type: "string", mail: true } });
    assert.equal(ok.valid, true);

    const subOk = validate.check({ email: "test.user+tag@sub.domain.co.jp" }, { email: { type: "string", mail: true } });
    assert.equal(subOk.valid, true);

    const ng = validate.check({ email: "invalid-email" }, { email: { type: "string", mail: true } });
    assert.equal(ng.valid, false);
    assert.equal(ng.errors[0].rule, "mail");
    assert.equal(ng.errors[0].message, "emailはメールアドレスの形式で入力してください");

    const ngNoDomain = validate.check({ email: "user@" }, { email: { type: "string", mail: true } });
    assert.equal(ngNoDomain.valid, false);
});

test("validate: url で http/https URL形式を検証できる", () => {
    const httpOk = validate.check({ site: "http://example.com" }, { site: { type: "string", url: true } });
    assert.equal(httpOk.valid, true);

    const httpsOk = validate.check({ site: "https://example.com/path?foo=bar#hash" }, { site: { type: "string", url: true } });
    assert.equal(httpsOk.valid, true);

    const ftpNg = validate.check({ site: "ftp://example.com" }, { site: { type: "string", url: true } });
    assert.equal(ftpNg.valid, false);
    assert.equal(ftpNg.errors[0].rule, "url");
    assert.equal(ftpNg.errors[0].message, "siteはURLの形式で入力してください");

    const plainNg = validate.check({ site: "example.com" }, { site: { type: "string", url: true } });
    assert.equal(plainNg.valid, false);
});

test("validate: zip で郵便番号形式を検証できる", () => {
    const hyphenOk = validate.check({ postal: "123-4567" }, { postal: { type: "string", zip: true } });
    assert.equal(hyphenOk.valid, true);

    const noHyphenOk = validate.check({ postal: "1234567" }, { postal: { type: "string", zip: true } });
    assert.equal(noHyphenOk.valid, true);

    const ng = validate.check({ postal: "12-3456" }, { postal: { type: "string", zip: true } });
    assert.equal(ng.valid, false);
    assert.equal(ng.errors[0].rule, "zip");
    assert.equal(ng.errors[0].message, "postalは郵便番号の形式で入力してください");
});

test("validate: tel で電話番号形式(固定・携帯・フリーダイヤル)を検証できる", () => {
    const mobileHyphen = validate.check({ tel: "090-1234-5678" }, { tel: { type: "string", tel: true } });
    assert.equal(mobileHyphen.valid, true);

    const mobileNoHyphen = validate.check({ tel: "08012345678" }, { tel: { type: "string", tel: true } });
    assert.equal(mobileNoHyphen.valid, true);

    const fixedHyphen = validate.check({ tel: "03-1234-5678" }, { tel: { type: "string", tel: true } });
    assert.equal(fixedHyphen.valid, true);

    const fixedLocalHyphen = validate.check({ tel: "0422-12-3456" }, { tel: { type: "string", tel: true } });
    assert.equal(fixedLocalHyphen.valid, true);

    const tollFree = validate.check({ tel: "0120-123-456" }, { tel: { type: "string", tel: true } });
    assert.equal(tollFree.valid, true);

    const ipPhone = validate.check({ tel: "050-1234-5678" }, { tel: { type: "string", tel: true } });
    assert.equal(ipPhone.valid, true);

    const ng = validate.check({ tel: "123-456" }, { tel: { type: "string", tel: true } });
    assert.equal(ng.valid, false);
    assert.equal(ng.errors[0].rule, "tel");
    assert.equal(ng.errors[0].message, "telは電話番号の形式で入力してください");
});

test("validate: date で日付文字列(yyyy-MM-dd / yyyy/MM/dd)を検証できる", () => {
    const hyphenOk = validate.check({ birth: "2026-08-19" }, { birth: { type: "string", date: true } });
    assert.equal(hyphenOk.valid, true);

    const slashOk = validate.check({ birth: "2026/08/19" }, { birth: { type: "string", date: true } });
    assert.equal(slashOk.valid, true);

    const singleDigitOk = validate.check({ birth: "2026/8/9" }, { birth: { type: "string", date: true } });
    assert.equal(singleDigitOk.valid, true);

    const leapYearOk = validate.check({ birth: "2024-02-29" }, { birth: { type: "string", date: true } });
    assert.equal(leapYearOk.valid, true);

    // 存在しない日付 (閏年でない2/29)
    const invalidLeap = validate.check({ birth: "2023-02-29" }, { birth: { type: "string", date: true } });
    assert.equal(invalidLeap.valid, false);
    assert.equal(invalidLeap.errors[0].rule, "date");
    assert.equal(invalidLeap.errors[0].message, "birthは日付の形式で入力してください");

    // 不正な月
    const invalidMonth = validate.check({ birth: "2026-13-01" }, { birth: { type: "string", date: true } });
    assert.equal(invalidMonth.valid, false);

    // 不正な日付フォーマット
    const invalidFormat = validate.check({ birth: "2026.08.19" }, { birth: { type: "string", date: true } });
    assert.equal(invalidFormat.valid, false);
});

test("validate: time で時間文字列(HH:mm / HH:mm:ss)を検証できる", () => {
    const secOk = validate.check({ time: "14:30:45" }, { time: { type: "string", time: true } });
    assert.equal(secOk.valid, true);

    const minOk = validate.check({ time: "09:05" }, { time: { type: "string", time: true } });
    assert.equal(minOk.valid, true);

    const midnightOk = validate.check({ time: "00:00:00" }, { time: { type: "string", time: true } });
    assert.equal(midnightOk.valid, true);

    const invalidHour = validate.check({ time: "24:00:00" }, { time: { type: "string", time: true } });
    assert.equal(invalidHour.valid, false);
    assert.equal(invalidHour.errors[0].rule, "time");
    assert.equal(invalidHour.errors[0].message, "timeは時間の形式で入力してください");

    const invalidMin = validate.check({ time: "12:60" }, { time: { type: "string", time: true } });
    assert.equal(invalidMin.valid, false);

    const invalidFormat = validate.check({ time: "12" }, { time: { type: "string", time: true } });
    assert.equal(invalidFormat.valid, false);
});

test("validate: alphaNum で半角英数字を検証できる", () => {
    const ok = validate.check({ code: "abcABC123" }, { code: { type: "string", alphaNum: true } });
    assert.equal(ok.valid, true);

    const ngSymbol = validate.check({ code: "abc_123" }, { code: { type: "string", alphaNum: true } });
    assert.equal(ngSymbol.valid, false);
    assert.equal(ngSymbol.errors[0].rule, "alphaNum");
    assert.equal(ngSymbol.errors[0].message, "codeは半角英数字で入力してください");

    const ngZenkaku = validate.check({ code: "ａｂｃ１２３" }, { code: { type: "string", alphaNum: true } });
    assert.equal(ngZenkaku.valid, false);
});
