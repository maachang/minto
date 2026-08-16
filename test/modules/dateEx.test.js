// modules/util/dateEx.js のテスト.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const DateEx = require("../../modules/util/dateEx.js");

test("dateEx: インスタンス生成と基本パース", () => {
    // 1. 引数なし (現在日時)
    const now = DateEx();
    assert.equal(DateEx.isDateEx(now), true);
    assert.equal(typeof now.getTime(), "number");

    // 2. 数値 (タイムスタンプ)
    const ts = 1755310800000;
    const d1 = DateEx(ts);
    assert.equal(d1.getTime(), ts);

    // 3. Date / DateEx インスタンス
    const nativeDate = new Date(2025, 7, 16, 12, 30, 45);
    const d2 = DateEx(nativeDate);
    assert.equal(d2.getFullYear(), 2025);
    assert.equal(d2.getMonth(), 7);
    assert.equal(d2.getDate(), 16);
    assert.equal(d2.getHours(), 12);
    assert.equal(d2.getMinutes(), 30);
    assert.equal(d2.getSeconds(), 45);

    const d3 = DateEx(d2);
    assert.equal(d3.getTime(), d2.getTime());

    // 4. 複数数値引数 (year, monthIndex, date, hours, minutes, seconds, ms)
    const d4 = DateEx(2025, 7, 16, 9, 15, 30, 250);
    assert.equal(d4.getFullYear(), 2025);
    assert.equal(d4.getMonth(), 7); // 8月
    assert.equal(d4.getDate(), 16);
    assert.equal(d4.getHours(), 9);
    assert.equal(d4.getMinutes(), 15);
    assert.equal(d4.getSeconds(), 30);
    assert.equal(d4.getMilliseconds(), 250);

    // 5. 不正な値
    assert.throws(() => {
        DateEx("invalid-date-string-xyz");
    });
});

test("dateEx: 各種日付文字列のパース (ローカル時間解釈・時差防止)", () => {
    // 1. ハイフン区切り日付 (YYYY-MM-DD) -> ローカル0時として解釈
    const d1 = DateEx("2025-08-16");
    assert.equal(d1.getFullYear(), 2025);
    assert.equal(d1.getMonth(), 7);
    assert.equal(d1.getDate(), 16);
    assert.equal(d1.getHours(), 0);
    assert.equal(d1.getMinutes(), 0);
    assert.equal(d1.getSeconds(), 0);

    // 2. スラッシュ区切り (YYYY/MM/DD)
    const d2 = DateEx("2025/08/16");
    assert.equal(d2.getFullYear(), 2025);
    assert.equal(d2.getMonth(), 7);
    assert.equal(d2.getDate(), 16);

    // 3. ドット区切り (YYYY.MM.DD)
    const d3 = DateEx("2025.8.16");
    assert.equal(d3.getFullYear(), 2025);
    assert.equal(d3.getMonth(), 7);
    assert.equal(d3.getDate(), 16);

    // 4. 日本語日付 (YYYY年MM月DD日)
    const d4 = DateEx("2025年08月16日");
    assert.equal(d4.getFullYear(), 2025);
    assert.equal(d4.getMonth(), 7);
    assert.equal(d4.getDate(), 16);

    // 5. 8桁数値文字列 (YYYYMMDD)
    const d5 = DateEx("20250816");
    assert.equal(d5.getFullYear(), 2025);
    assert.equal(d5.getMonth(), 7);
    assert.equal(d5.getDate(), 16);
    assert.equal(d5.getHours(), 0);

    // 6. 日時文字列 (YYYY-MM-DD HH:mm:ss.sss)
    const d6 = DateEx("2025-08-16 14:35:20.123");
    assert.equal(d6.getFullYear(), 2025);
    assert.equal(d6.getMonth(), 7);
    assert.equal(d6.getDate(), 16);
    assert.equal(d6.getHours(), 14);
    assert.equal(d6.getMinutes(), 35);
    assert.equal(d6.getSeconds(), 20);
    assert.equal(d6.getMilliseconds(), 123);

    // 7. 日本語日時文字列
    const d7 = DateEx("2025年8月16日 14時35分20秒");
    assert.equal(d7.getFullYear(), 2025);
    assert.equal(d7.getMonth(), 7);
    assert.equal(d7.getDate(), 16);
    assert.equal(d7.getHours(), 14);
    assert.equal(d7.getMinutes(), 35);
    assert.equal(d7.getSeconds(), 20);
});

test("dateEx: ゲッターと曜日文字列取得", () => {
    // 2025-08-16 は土曜日 (getDay() === 6)
    const d = DateEx("2025-08-16 10:20:30.400");
    assert.equal(d.getFullYear(), 2025);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getDate(), 16);
    assert.equal(d.getDay(), 6);
    assert.equal(d.getHours(), 10);
    assert.equal(d.getMinutes(), 20);
    assert.equal(d.getSeconds(), 30);
    assert.equal(d.getMilliseconds(), 400);

    // 曜日文字列 (日本語 / 英語)
    assert.equal(d.getDayToString(true), "土");
    assert.equal(d.getDayToString(false), "Sat");

    // 日曜日の確認 (2025-08-17)
    const sunday = DateEx("2025-08-17");
    assert.equal(sunday.getDay(), 0);
    assert.equal(sunday.getDayToString(true), "日");
    assert.equal(sunday.getDayToString(false), "Sun");
});

test("dateEx: セッターとクローン・ネイティブ変換", () => {
    const d = DateEx("2025-08-16 10:00:00");

    // セッター (チェーン可能)
    d.setFullYear(2026).setMonth(0).setDate(5).setHours(15).setMinutes(45).setSeconds(30).setMilliseconds(100);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 0);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 15);
    assert.equal(d.getMinutes(), 45);
    assert.equal(d.getSeconds(), 30);
    assert.equal(d.getMilliseconds(), 100);

    // clone() による独立インスタンス生成
    const cloned = d.clone();
    assert.equal(DateEx.isDateEx(cloned), true);
    assert.equal(cloned.getTime(), d.getTime());

    cloned.setDate(10);
    assert.equal(cloned.getDate(), 10);
    assert.equal(d.getDate(), 5); // 元のインスタンスは不変

    // toDate() / rawDate() でネイティブ Date を取得
    const native1 = d.toDate();
    const native2 = d.rawDate();
    assert.equal(native1 instanceof Date, true);
    assert.equal(native2 instanceof Date, true);
    assert.equal(native1.getTime(), d.getTime());
});

test("dateEx: 日時加減算 (change)", () => {
    const d = DateEx("2025-08-16 12:00:00");

    // 年加算
    d.change("year", 1);
    assert.equal(d.getFullYear(), 2026);

    // 月加算
    d.change("month", -2); // 2026年6月
    assert.equal(d.getMonth(), 5);

    // 週加算 (+2週間 = 14日)
    d.change("week", 2);
    assert.equal(d.getDate(), 30);

    // 日加算
    d.change("day", 2); // 2026年7月2日
    assert.equal(d.getMonth(), 6);
    assert.equal(d.getDate(), 2);

    // 時間加減算
    d.change("hours", 3);
    assert.equal(d.getHours(), 15);

    // 分加減算
    d.change("minutes", 30);
    assert.equal(d.getMinutes(), 30);

    // 秒加減算
    d.change("seconds", -15);
    assert.equal(d.getSeconds(), 45);
    assert.equal(d.getMinutes(), 29);

    // ミリ秒加減算
    d.change("milliseconds", 500);
    assert.equal(d.getMilliseconds(), 500);
});

test("dateEx: 日時リセット (clear)", () => {
    // 1. clear("hours") -> 当日の 00:00:00.000 にリセット
    const d1 = DateEx("2025-08-16 15:30:45.500");
    d1.clear("hours");
    assert.equal(d1.getFullYear(), 2025);
    assert.equal(d1.getMonth(), 7);
    assert.equal(d1.getDate(), 16);
    assert.equal(d1.getHours(), 0);
    assert.equal(d1.getMinutes(), 0);
    assert.equal(d1.getSeconds(), 0);
    assert.equal(d1.getMilliseconds(), 0);

    // 2. clear("date") -> 当月1日の 00:00:00.000 にリセット
    const d2 = DateEx("2025-08-16 15:30:45.500");
    d2.clear("date");
    assert.equal(d2.getDate(), 1);
    assert.equal(d2.getHours(), 0);

    // 3. clear("month") -> 当年1月1日の 00:00:00.000 にリセット
    const d3 = DateEx("2025-08-16 15:30:45.500");
    d3.clear("month");
    assert.equal(d3.getMonth(), 0);
    assert.equal(d3.getDate(), 1);
    assert.equal(d3.getHours(), 0);

    // 4. clear("minutes") -> 当時00分00秒000にリセット
    const d4 = DateEx("2025-08-16 15:30:45.500");
    d4.clear("minutes");
    assert.equal(d4.getHours(), 15);
    assert.equal(d4.getMinutes(), 0);
    assert.equal(d4.getSeconds(), 0);

    // 5. clear("seconds") -> 当分00秒000にリセット
    const d5 = DateEx("2025-08-16 15:30:45.500");
    d5.clear("seconds");
    assert.equal(d5.getMinutes(), 30);
    assert.equal(d5.getSeconds(), 0);
    assert.equal(d5.getMilliseconds(), 0);
});

test("dateEx: フォーマット文字列生成 (toString & toFormatString)", () => {
    const d = DateEx("2025-08-16 09:05:07.089");

    // デフォルト toString
    assert.equal(d.toString(), "2025-08-16 09:05:07");
    assert.equal(d.toString("date"), "2025-08-16");
    assert.equal(d.toString("year"), "2025");
    assert.equal(d.toString("month"), "2025-08");
    assert.equal(d.toString("hm"), "09:05");
    assert.equal(d.toString("hms"), "09:05:07");
    assert.equal(d.toString("full"), "2025-08-16 09:05:07.089");

    // カスタムデリミタ付き toString
    assert.equal(d.toString("date", { year: "/", month: "/" }), "2025/08/16");
    assert.equal(d.toString("date", { none: true }), "20250816");
    assert.equal(d.toString("hm", { none: true }), "0905");

    // テンプレート指定 toFormatString
    assert.equal(
        d.toFormatString("{yyyy}/{MM}/{dd} ({dj}) {hh}:{mm}:{ss}"),
        "2025/08/16 (土) 09:05:07"
    );
    assert.equal(
        d.toFormatString("{yyyy}年{MM}月{dd}日({dw}) {hh}時{mm}分{ss}秒.{sss}"),
        "2025年08月16日(Sat) 09時05分07秒.089"
    );
});

test("dateEx: 期間計算と内外判定 (between & isBetween)", () => {
    // 1. 日単位の between
    const d = DateEx("2025-08-16 15:30:00");
    const dayBetween = DateEx.between(d, "date");

    assert.equal(dayBetween.start.toString("full"), "2025-08-16 00:00:00.000");
    assert.equal(dayBetween.end.toString("full"), "2025-08-16 23:59:59.999");

    assert.equal(dayBetween.isBetween("2025-08-16 00:00:00"), true);
    assert.equal(dayBetween.isBetween("2025-08-16 12:00:00"), true);
    assert.equal(dayBetween.isBetween("2025-08-16 23:59:59.999"), true);
    assert.equal(dayBetween.isBetween("2025-08-15 23:59:59"), false);
    assert.equal(dayBetween.isBetween("2025-08-17 00:00:00"), false);

    // 2. 月単位の between
    const monthBetween = d.between("month");
    assert.equal(monthBetween.start.toString("full"), "2025-08-01 00:00:00.000");
    assert.equal(monthBetween.end.toString("full"), "2025-08-31 23:59:59.999");

    assert.equal(monthBetween.isBetween("2025-08-15"), true);
    assert.equal(monthBetween.isBetween("2025-07-31 23:59:59"), false);
    assert.equal(monthBetween.isBetween("2025-09-01 00:00:00"), false);

    // 3. 年単位の between
    const yearBetween = DateEx.between(d, "year");
    assert.equal(yearBetween.start.toString("full"), "2025-01-01 00:00:00.000");
    assert.equal(yearBetween.end.toString("full"), "2025-12-31 23:59:59.999");
    assert.equal(yearBetween.isBetween(new Date(2025, 5, 1)), true);
    assert.equal(yearBetween.isBetween(new Date(2024, 11, 31)), false);
});
