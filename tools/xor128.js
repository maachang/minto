//////////////////////////////////////////
// xor128.
//////////////////////////////////////////
(function (global) {
    "use strict";

    // unix時間を取得.
    const getTime = function () {
        return Date.now();
    };

    // ナノ時間を取得.
    const getNanoTime = function () {
        return Number(process.hrtime.bigint() / 1000n);
    };

    // xor128演算乱数装置.
    // seed 乱数初期値(number)を設定します.
    const create = function (seed) {
        let _a = 123456789;
        let _b = 362436069;
        let _c = 521288629;
        let _d = 88675123;

        // シードセット.
        const setSeed = function (s) {
            if (typeof s == "number") {
                let hs = ((s / 1812433253) | 0) + 1;
                let ls = ((s % 1812433253) | 0) - 1;
                if ((ls & 0x01) == 0) {
                    hs = ~hs | 0;
                }
                _a = hs = (_a * ls * hs + 1) | 0;
                if ((_a & 0x01) == 1) {
                    _c = (_c * hs * ls - 1) | 0;
                }
            }
        };

        // 乱数取得.
        const next = function () {
            let t = _a;
            let r = t;
            t = t << 11;
            t = t ^ r;
            r = t;
            r = r >> 8;
            t = t ^ r;
            r = _b;
            _a = r;
            r = _c;
            _b = r;
            r = _d;
            _c = r;
            t = t ^ r;
            r = r >> 19;
            r = r ^ t;
            _d = r;
            return r;
        };

        // Byteリストの乱数を生成.
        const outByteList = function (out, cnt, len) {
            let n, i;
            const len4 = len >> 2;
            const lenEtc = len & 0x03;
            for (i = 0; i < len4; i++) {
                n = next();
                out[cnt++] = n & 0x0ff;
                out[cnt++] = (n & 0x0ff00) >> 8;
                out[cnt++] = (n & 0x0ff0000) >> 16;
                out[cnt++] = ((n & 0xff000000) >> 24) & 0x0ff;
            }
            for (i = 0; i < lenEtc; i++) {
                out[cnt++] = next() & 0x0ff;
            }
        };

        // ランダムバイナリを指定数取得.
        const getBytes = function (len) {
            const ret = Buffer.alloc(len);
            outByteList(ret, 0, len);
            return ret;
        };

        // ランダムバイナリをout(Array)に格納.
        const getArray = function (out, len) {
            outByteList(out, out.length, len);
        };

        // ゼロサプレス.
        const _z2 = function (n) {
            return "00".substring(n.length) + n;
        };

        // UUIDで取得.
        const getUUID = function () {
            const a = next();
            const b = next();
            const c = next();
            const d = next();
            return (
                _z2((((a & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((a & 0x00ff0000) >> 16).toString(16)) +
                _z2(((a & 0x0000ff00) >> 8).toString(16)) +
                _z2((a & 0x000000ff).toString(16)) +
                "-" +
                _z2((((b & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((b & 0x00ff0000) >> 16).toString(16)) +
                "-" +
                _z2(((b & 0x0000ff00) >> 8).toString(16)) +
                _z2((b & 0x000000ff).toString(16)) +
                "-" +
                _z2((((c & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((c & 0x00ff0000) >> 16).toString(16)) +
                "-" +
                _z2(((c & 0x0000ff00) >> 8).toString(16)) +
                _z2((c & 0x000000ff).toString(16)) +
                _z2((((d & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((d & 0x00ff0000) >> 16).toString(16)) +
                _z2(((d & 0x0000ff00) >> 8).toString(16)) +
                _z2((d & 0x000000ff).toString(16))
            );
        };

        // パスワード合成文字列.
        const _NUM_LIST = "0123456789";
        const _ENGB = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const _ENGS = "abcdefghijklmnopqrstuvwxyz";
        const _SIMBOLA = "-_/*+.,!#$%&()~|@^=";

        // パスワードを取得.
        const getPassword = function (
            size,
            num,
            engb,
            engs,
            symbolAll,
            customSymbol,
        ) {
            size = size | 0;
            if (size <= 0) {
                return "";
            } else if (size > 9999) {
                return null;
            }
            let arrayCode = "";
            if (num == true) {
                arrayCode += _NUM_LIST;
            }
            if (engb == true) {
                arrayCode += _ENGB;
            }
            if (engs == true) {
                arrayCode += _ENGS;
            }
            if (symbolAll == true) {
                arrayCode += _SIMBOLA;
            } else if (
                typeof customSymbol == "string" &&
                customSymbol.length > 0
            ) {
                const len = customSymbol.length;
                for (let i = 0; i < len; i++) {
                    const n = customSymbol[i];
                    if (_SIMBOLA.indexOf(n) != -1) {
                        arrayCode += n;
                    }
                }
            }
            const len = arrayCode.length;
            let ret = "";
            for (let i = 0; i < size; i++) {
                ret += arrayCode[next() % len];
            }
            return ret;
        };

        // 初期乱数のコードをセット.
        if (seed != undefined) {
            setSeed(seed);
        }

        return {
            setSeed,
            next,
            nextInt: next,
            getBytes,
            getArray,
            getUUID,
            getPassword,
        };
    };

    // [default]標準利用xor128ランダムジェネレーターオブジェクトを取得します.
    const random = function () {
        const ret = create(getTime());
        ret.next();
        ret.setSeed(getNanoTime());
        ret.next();
        return ret;
    };

    // ========================================================
    // モジュールエクスポート
    // ========================================================
    // Node.js(CommonJS)環境とブラウザ環境の両方に対応
    if (typeof exports !== "undefined") {
        module.exports = { getTime, getNanoTime, create, random };
    } else {
        global.xor128 = { getTime, getNanoTime, create, random };
    }
})(typeof window !== "undefined" ? window : globalThis || this);
