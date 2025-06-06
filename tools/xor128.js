//////////////////////////////////////////
// xor128.
//////////////////////////////////////////
(function () {
    'use strict'

    // unix時間を取得.
    const getTime = function () {
        return Date.now();
    }
    exports.getTime = getTime;

    // ナノ時間を取得.
    const getNanoTime = function () {
        const ret = process.hrtime()
        return parseInt(((ret[0] * 10000000000) + ret[1]) / 1000);
    }
    exports.getNanoTime + getNanoTime;

    // xor128演算乱数装置.
    // seed 乱数初期値(number)を設定します.
    const create = function (seed) {
        let _a = 123456789;
        let _b = 362436069;
        let _c = 521288629;
        let _d = 88675123;
        // シードセット.
        const setSeed = function (s) {
            if (typeof (s) == "number") {
                let hs = ((s / 1812433253) | 0) + 1;
                let ls = ((s % 1812433253) | 0) - 1;
                if ((ls & 0x01) == 0) {
                    hs = (~hs) | 0;
                }
                _a = hs = (((_a * (ls)) * hs) + 1) | 0;
                if ((_a & 0x01) == 1) {
                    _c = (((_c * (hs)) * ls) - 1) | 0;
                }
            }
        }
        // 乱数取得.
        const next = function () {
            let t = _a;
            let r = t;
            t = (t << 11);
            t = (t ^ r);
            r = t;
            r = (r >> 8);
            t = (t ^ r);
            r = _b;
            _a = r;
            r = _c;
            _b = r;
            r = _d;
            _c = r;
            t = (t ^ r);
            r = (r >> 19);
            r = (r ^ t);
            _d = r;
            return r;
        }
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
        }
        // ランダムバイナリを指定数取得.
        const getBytes = function (len) {
            const ret = Buffer.alloc(len);
            outByteList(ret, 0, len);
            return ret;
        }
        // ランダムバイナリをout(Array)に格納.
        const getArray = function (out, len) {
            outByteList(out, out.length, len);
        }
        // ゼロサプレス.
        const _z2 = function (n) {
            return "00".substring(n.length) + n;
        }
        // UUIDで取得,
        const getUUID = function () {
            const a = next();
            const b = next();
            const c = next();
            const d = next();
            return _z2((((a & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((a & 0x00ff0000) >> 16).toString(16)) +
                _z2(((a & 0x0000ff00) >> 8).toString(16)) +
                _z2(((a & 0x000000ff)).toString(16)) +
                "-" +
                _z2((((b & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((b & 0x00ff0000) >> 16).toString(16)) +
                "-" +
                _z2(((b & 0x0000ff00) >> 8).toString(16)) +
                _z2(((b & 0x000000ff)).toString(16)) +
                "-" +
                _z2((((c & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((c & 0x00ff0000) >> 16).toString(16)) +
                "-" +
                _z2(((c & 0x0000ff00) >> 8).toString(16)) +
                _z2(((c & 0x000000ff)).toString(16)) +
                _z2((((d & 0xff000000) >> 24) & 0x00ff).toString(16)) +
                _z2(((d & 0x00ff0000) >> 16).toString(16)) +
                _z2(((d & 0x0000ff00) >> 8).toString(16)) +
                _z2(((d & 0x000000ff)).toString(16));
        }

        // 初期乱数のコードをセット.
        if (seed != undefined) {
            setSeed(seed);
        }
        return {
            setSeed: setSeed,
            next: next,
            nextInt: next,
            getBytes: getBytes,
            getArray: getArray,
            getUUID: getUUID
        }
    };
    // 指定条件を設定してランダムジェネレーターを生成します.
    exports.create = create;

    // [default]標準利用xor128ランダムジェネレーターオブジェクトを取得します.
    exports.random = function () {
        // UnixTime(ms)をセット.
        const ret = create(getTime());
        // 乱数実行.
        ret.next();
        // ナノ秒をセット.
        ret.setSeed(getNanoTime());
        // 乱数実行.
        ret.next();
        return ret;
    }

})();