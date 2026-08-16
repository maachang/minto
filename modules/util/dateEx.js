/**
 * AIメモ:
 * - DateEx: JavaScript 標準の Date オブジェクトを拡張し、日付操作・フォーマット・期間判定を支援するユーティリティ。
 * - GAS 版から Node.js / Bun (CommonJS) 向けにリファクタリング。
 * - 主な機能:
 *   - 日付生成: DateEx.create(...) または DateEx(...)
 *   - ハイフン・スラッシュ・8桁・日本語日付のパース正規化 (UTC時差の罠を解消し、常にローカル0時として解釈)
 *   - 加減算: .change("date", 1), .change("month", -1), .change("hours", 3) 等 (チェーン可能)
 *   - リセット: .clear("hours"), .clear("date"), .clear("month") 等 (チェーン可能)
 *   - フォーマット出力: .toString(mode, format), .toFormatString("{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}")
 *   - 期間計算・内外判定: DateEx.between(date, "month").isBetween(targetDate)
 * - CommonJS 形式。
 */

'use strict';

// 基本出力フォーマット
const _FORMAT = {
    year: '-',
    month: '-',
    date: '',
    hour: ':',
    minutes: ':',
    seconds: '.',
    milliseconds: '',
    end: false,
    none: false
};

/**
 * 基本フォーマットを設定
 * @param {Object} [setting]
 */
function setFormat(setting = {}) {
    _FORMAT.year = setting.year !== undefined ? setting.year : '-';
    _FORMAT.month = setting.month !== undefined ? setting.month : '-';
    _FORMAT.date = setting.date !== undefined ? setting.date : '';
    _FORMAT.hour = setting.hour !== undefined ? setting.hour : ':';
    _FORMAT.minutes = setting.minutes !== undefined ? setting.minutes : ':';
    _FORMAT.seconds = setting.seconds !== undefined ? setting.seconds : '.';
    _FORMAT.milliseconds = setting.milliseconds !== undefined ? setting.milliseconds : '';
    _FORMAT.end = !!setting.end;
    _FORMAT.none = !!setting.none;
}

/**
 * 日本語フォーマットを設定
 */
function setFormatToJp() {
    setFormat({
        year: '年',
        month: '月',
        date: '日',
        hour: '時',
        minutes: '分',
        seconds: '秒',
        milliseconds: '',
        end: true,
        none: false
    });
}

function _noneSet(a, b) {
    return (a === undefined || a === null) ? b : a;
}

function _getMixedFormat(values) {
    const ret = { ..._FORMAT };
    if (!values) return ret;

    ret.year = _noneSet(values.year, ret.year);
    ret.month = _noneSet(values.month, ret.month);
    ret.date = _noneSet(values.date, ret.date);
    ret.hour = _noneSet(values.hour, ret.hour);
    ret.minutes = _noneSet(values.minutes, ret.minutes);
    ret.seconds = _noneSet(values.seconds, ret.seconds);
    ret.milliseconds = _noneSet(values.milliseconds, ret.milliseconds);
    ret.end = values.end !== undefined ? !!values.end : ret.end;
    ret.none = values.none !== undefined ? !!values.none : ret.none;
    return ret;
}

/**
 * 対象オブジェクトが DateEx かどうか判定
 * @param {*} o 
 * @returns {boolean}
 */
function isDateEx(o) {
    return !!(o && o.DATE_EX_SYMBOL === 'DateEx');
}

/**
 * 日付文字列をローカル時間として安全にパース
 * (JavaScript標準の "2025-01-01" が UTC 扱いになって時差が生じる罠を解消)
 * @param {string} str 
 * @returns {Date|null}
 */
function parseDateString(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim();
    if (!s) return null;

    // 1. 明示的なタイムゾーン指定付き ISO (例: 2025-01-01T15:30:00Z, +09:00, -05:00)
    if (/(?:T|\s)\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d;
    }

    // 2. 日付のみ: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY年MM月DD日
    const dateOnlyMatch = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
    if (dateOnlyMatch) {
        const y = parseInt(dateOnlyMatch[1], 10);
        const m = parseInt(dateOnlyMatch[2], 10) - 1;
        const d = parseInt(dateOnlyMatch[3], 10);
        return new Date(y, m, d, 0, 0, 0, 0);
    }

    // 3. 8桁数値文字列: YYYYMMDD
    const num8Match = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (num8Match) {
        const y = parseInt(num8Match[1], 10);
        const m = parseInt(num8Match[2], 10) - 1;
        const d = parseInt(num8Match[3], 10);
        return new Date(y, m, d, 0, 0, 0, 0);
    }

    // 4. 日時 (タイムゾーン無指定): YYYY-MM-DD HH:mm:ss[.sss], YYYY/MM/DDTHH:mm:ss など
    const dateTimeMatch = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s](\d{1,2})[:時](\d{1,2})(?:[:分](\d{1,2}))?秒?(?:\.(\d{1,3}))?)?$/.exec(s);
    if (dateTimeMatch && dateTimeMatch[4] !== undefined) {
        const y = parseInt(dateTimeMatch[1], 10);
        const m = parseInt(dateTimeMatch[2], 10) - 1;
        const d = parseInt(dateTimeMatch[3], 10);
        const h = parseInt(dateTimeMatch[4], 10);
        const min = parseInt(dateTimeMatch[5], 10);
        const sec = dateTimeMatch[6] ? parseInt(dateTimeMatch[6], 10) : 0;
        let ms = 0;
        if (dateTimeMatch[7]) {
            ms = parseInt(dateTimeMatch[7].padEnd(3, '0').slice(0, 3), 10);
        }
        return new Date(y, m, d, h, min, sec, ms);
    }

    // 5. フォールバック (標準 new Date)
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) {
        return fallback;
    }

    return null;
}

/**
 * Date オブジェクトを安全に生成
 * @param  {...any} args 
 * @returns {Date}
 */
function createDate(...args) {
    let date;
    const len = args.length;

    if (len === 0 || args[0] === undefined || args[0] === null) {
        date = new Date();
    } else if (isDateEx(args[0])) {
        date = new Date(args[0].getTime());
    } else if (args[0] instanceof Date) {
        date = new Date(args[0].getTime());
    } else if (len === 1 && typeof args[0] === 'string') {
        date = parseDateString(args[0]);
    } else if (len === 1) {
        date = new Date(args[0]);
    } else if (len === 2) {
        date = new Date(args[0], args[1], 1, 0, 0, 0, 0);
    } else if (len === 3) {
        date = new Date(args[0], args[1], args[2], 0, 0, 0, 0);
    } else if (len === 4) {
        date = new Date(args[0], args[1], args[2], args[3], 0, 0, 0);
    } else if (len === 5) {
        date = new Date(args[0], args[1], args[2], args[3], args[4], 0, 0);
    } else if (len === 6) {
        date = new Date(args[0], args[1], args[2], args[3], args[4], args[5], 0);
    } else {
        date = new Date(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }

    if (!date || isNaN(date.getTime())) {
        throw new Error(`DateEx の作成に失敗しました: ${args.join(', ')}`);
    }

    return date;
}

/**
 * 日付を文字列に変換
 * @param {DateEx} object 
 * @param {string} [mode] 
 * @param {Object} [format] 
 * @returns {string}
 */
function dateToString(object, mode, format) {
    const fmt = _getMixedFormat(format);
    let ret = '';

    const y = String(object.getFullYear()).padStart(4, '0');
    const M = String(object.getMonth() + 1).padStart(2, '0');
    const d = String(object.getDate()).padStart(2, '0');
    const h = String(object.getHours()).padStart(2, '0');
    const m = String(object.getMinutes()).padStart(2, '0');
    const s = String(object.getSeconds()).padStart(2, '0');
    const sss = String(object.getMilliseconds()).padStart(3, '0');

    // 年のみ
    if (mode === 'year') {
        return fmt.none ? y : (fmt.end ? y + fmt.year : y);
    }
    // 月まで
    if (mode === 'month') {
        if (fmt.none) return y + M;
        return fmt.end ? y + fmt.year + M + fmt.month : y + fmt.year + M;
    }
    // 日まで
    if (mode === 'date' || mode === 'day') {
        if (fmt.none) return y + M + d;
        return fmt.end ? y + fmt.year + M + fmt.month + d + fmt.date : y + fmt.year + M + fmt.month + d;
    }
    // 時分のみ
    if (mode === 'hm') {
        if (fmt.none) return h + m;
        return fmt.end ? h + fmt.hour + m + fmt.minutes : h + fmt.hour + m;
    }
    // 時分秒のみ
    if (mode === 'hms') {
        if (fmt.none) return h + m + s;
        return fmt.end ? h + fmt.hour + m + fmt.minutes + s + fmt.seconds : h + fmt.hour + m + fmt.minutes + s;
    }

    // 日時 (デフォルト)
    if (fmt.none) {
        ret = y + M + d + h + m + s;
        if (mode === 'full' || mode === 'all' || mode === '*') {
            ret += sss;
        }
        return ret;
    }

    ret = y + fmt.year + M + fmt.month + d + (fmt.date ? fmt.date + ' ' : ' ') + h + fmt.hour + m + fmt.minutes + s;
    if (mode === 'full' || mode === 'all' || mode === '*') {
        ret += (fmt.seconds ? fmt.seconds : '.') + sss;
        if (fmt.end && fmt.milliseconds) ret += fmt.milliseconds;
    } else if (fmt.end && fmt.seconds) {
        ret += fmt.seconds;
    }

    return ret;
}

/**
 * テンプレート文字列に沿ってフォーマット出力
 * @param {DateEx} object 
 * @param {string} formatPattern 
 * @returns {string}
 */
function toFormatString(object, formatPattern) {
    if (!formatPattern) return object.toString();

    const y = String(object.getFullYear()).padStart(4, '0');
    const M = String(object.getMonth() + 1).padStart(2, '0');
    const d = String(object.getDate()).padStart(2, '0');
    const h = String(object.getHours()).padStart(2, '0');
    const m = String(object.getMinutes()).padStart(2, '0');
    const s = String(object.getSeconds()).padStart(2, '0');
    const sss = String(object.getMilliseconds()).padStart(3, '0');

    let ret = formatPattern;
    ret = ret.replaceAll('{yyyy}', y);
    ret = ret.replaceAll('{MM}', M);
    ret = ret.replaceAll('{dd}', d);
    ret = ret.replaceAll('{hh}', h);
    ret = ret.replaceAll('{mm}', m);
    ret = ret.replaceAll('{ss}', s);
    ret = ret.replaceAll('{sss}', sss);
    ret = ret.replaceAll('{dj}', object.getDayToString(true));
    ret = ret.replaceAll('{dw}', object.getDayToString(false));
    ret = ret.replaceAll('{E}', object.getDayToString(false));

    return ret;
}

/**
 * 開始日時・終了日時を計算
 * @param {*} targetDate 
 * @param {string} [mode='date'] 'year' | 'month' | 'week' | 'date'
 * @returns {{ start: DateEx, end: DateEx, isBetween: (t: any) => boolean }}
 */
function between(targetDate, mode = 'date') {
    const base = create(targetDate);
    const m = String(mode).trim().toLowerCase();

    let start, end;

    if (m === 'year') {
        start = create(base.getFullYear(), 0, 1, 0, 0, 0, 0);
        end = create(base.getFullYear() + 1, 0, 1, 0, 0, 0, 0).change('milliseconds', -1);
    } else if (m === 'month') {
        start = create(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
        end = create(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0).change('milliseconds', -1);
    } else if (m === 'week') {
        const day = base.getDay();
        start = create(base).change('date', -day).clear('hours');
        end = create(base).change('date', 6 - day).clear('hours').change('date', 1).change('milliseconds', -1);
    } else {
        // 'date' / 'day'
        start = create(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
        end = create(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0, 0).change('milliseconds', -1);
    }

    const range = { start, end };
    return {
        start,
        end,
        isBetween: (target) => isBetween(range, target)
    };
}

/**
 * between 範囲内にターゲット日時が含まれるか判定
 * @param {{ start: DateEx, end: DateEx }} range 
 * @param {*} target 
 * @returns {boolean}
 */
function isBetween(range, target) {
    let ttm;
    if (typeof target === 'number') {
        ttm = target;
    } else if (isDateEx(target)) {
        ttm = target.getTime();
    } else if (target instanceof Date) {
        ttm = target.getTime();
    } else if (typeof target === 'string') {
        const d = parseDateString(target) || new Date(target);
        if (!d || isNaN(d.getTime())) {
            throw new Error(`対象ターゲットの日付変換に失敗しました: ${target}`);
        }
        ttm = d.getTime();
    } else if (target && typeof target.getTime === 'function') {
        ttm = target.getTime();
    } else {
        throw new Error(`対象ターゲットの日付変換に失敗しました: ${target}`);
    }

    const startTm = range.start.getTime();
    const endTm = range.end.getTime();
    return startTm <= ttm && ttm <= endTm;
}

/**
 * DateEx インスタンスを生成
 * @param  {...any} args 
 * @returns {DateEx}
 */
function create(...args) {
    let date = createDate(...args);

    const instance = {
        DATE_EX_SYMBOL: 'DateEx',

        getFullYear: () => date.getFullYear(),
        getMonth: () => date.getMonth(),
        getDate: () => date.getDate(),
        getDay: () => date.getDay(),
        getHours: () => date.getHours(),
        getMinutes: () => date.getMinutes(),
        getSeconds: () => date.getSeconds(),
        getMilliseconds: () => date.getMilliseconds(),
        getTime: () => date.getTime(),
        getTimezoneOffset: () => date.getTimezoneOffset(),

        getDayToString: function (jp = false) {
            const day = date.getDay();
            if (jp) {
                const jpDays = ['日', '月', '火', '水', '木', '金', '土'];
                return jpDays[day] || '？';
            }
            const enDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            return enDays[day] || 'unknown';
        },

        set: function (...setArgs) {
            date = createDate(...setArgs);
            return instance;
        },
        setFullYear: function (v) { date.setFullYear(v); return instance; },
        setMonth: function (v) { date.setMonth(v); return instance; },
        setDate: function (v) { date.setDate(v); return instance; },
        setHours: function (v) { date.setHours(v); return instance; },
        setMinutes: function (v) { date.setMinutes(v); return instance; },
        setSeconds: function (v) { date.setSeconds(v); return instance; },
        setMilliseconds: function (v) { date.setMilliseconds(v); return instance; },

        clone: function () {
            return create(date.getTime());
        },
        create: function () {
            return create(date.getTime());
        },

        change: function (mode, value) {
            const m = String(mode).toLowerCase();
            if (m === 'year') {
                date.setFullYear(date.getFullYear() + value);
            } else if (m === 'month') {
                date.setMonth(date.getMonth() + value);
            } else if (m === 'week') {
                date.setDate(date.getDate() + value * 7);
            } else if (m === 'day' || m === 'date') {
                date.setDate(date.getDate() + value);
            } else if (m === 'hours' || m === 'hour') {
                date.setHours(date.getHours() + value);
            } else if (m === 'minutes' || m === 'minute' || m === 'min') {
                date.setMinutes(date.getMinutes() + value);
            } else if (m === 'seconds' || m === 'second' || m === 'sec') {
                date.setSeconds(date.getSeconds() + value);
            } else if (m === 'milliseconds' || m === 'ms') {
                date.setMilliseconds(date.getMilliseconds() + value);
            }
            return instance;
        },

        clear: function (mode) {
            const m = String(mode).toLowerCase();
            if (m === 'year') {
                date.setFullYear(1970, 0, 1);
                date.setHours(0, 0, 0, 0);
            } else if (m === 'month') {
                date.setMonth(0, 1);
                date.setHours(0, 0, 0, 0);
            } else if (m === 'week') {
                date.setDate(date.getDate() - date.getDay());
                date.setHours(0, 0, 0, 0);
            } else if (m === 'date' || m === 'day') {
                date.setDate(1);
                date.setHours(0, 0, 0, 0);
            } else if (m === 'hours' || m === 'hour') {
                date.setHours(0, 0, 0, 0);
            } else if (m === 'minutes' || m === 'minute' || m === 'min') {
                date.setMinutes(0, 0, 0);
            } else if (m === 'seconds' || m === 'second' || m === 'sec') {
                date.setSeconds(0, 0);
            } else if (m === 'milliseconds' || m === 'ms') {
                date.setMilliseconds(0);
            }
            return instance;
        },

        between: function (mode) {
            return between(date, mode);
        },

        rawDate: () => date,
        toDate: () => date,

        toFormatString: function (pattern) {
            return toFormatString(instance, pattern);
        },
        toString: function (mode, fmt) {
            return dateToString(instance, mode, fmt);
        }
    };

    return instance;
}

// ファクトリ関数 & プロパティのバインド
function DateEx(...args) {
    return create(...args);
}

DateEx.create = create;
DateEx.between = between;
DateEx.isBetween = isBetween;
DateEx.setFormat = setFormat;
DateEx.setFormatToJp = setFormatToJp;
DateEx.isDateEx = isDateEx;
DateEx.DateEx = DateEx;

module.exports = DateEx;
