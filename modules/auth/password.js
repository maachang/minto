///////////////////////////////////////////////
// パスワードハッシュ化ユーティリティ.
//
// llrt では node.js標準の crypto.pbkdf2 / scrypt が
// サポートされていない(API.mdに記載が無い)ため、
// llrtでサポートが確認できている crypto.createHmac
// のみを使って PBKDF2-HMAC-SHA256 を自前実装する.
///////////////////////////////////////////////
(function () {
    'use strict';

    const crypto = $require("crypto");

    // ハッシュアルゴリズム(HMAC).
    const _HASH_ALGO = "sha256";

    // sha256の出力バイト数.
    const _HASH_LEN = 32;

    // デフォルトの反復回数.
    // Lambda(128mb)でのコールドスタート実行時間とのバランスを
    // 考慮したデフォルト値. 要件次第で呼び出し側から調整可能.
    const _DEFAULT_ITERATIONS = 10000;

    // デフォルトの導出鍵長(バイト).
    const _DEFAULT_KEY_LEN = 32;

    // salt生成(hex文字列).
    // bytes 生成するバイト数を設定します(デフォルト16).
    // 戻り値: hex文字列のsaltが返却されます.
    const genSalt = function (bytes) {
        bytes = bytes | 0;
        if (bytes <= 0) {
            bytes = 16;
        }
        return crypto.randomBytes(bytes).toString("hex");
    };

    // PBKDF2のF関数(1ブロック分の導出).
    // password 対象のパスワードを設定します.
    // saltBuf saltのBufferを設定します.
    // iterations 反復回数を設定します.
    // blockIndex ブロック番号(1始まり)を設定します.
    // 戻り値: 1ブロック分の導出結果(Buffer)が返却されます.
    const _f = function (password, saltBuf, iterations, blockIndex) {
        const blockNo = Buffer.alloc(4);
        blockNo.writeUInt32BE(blockIndex, 0);
        let u = crypto.createHmac(_HASH_ALGO, password)
            .update(Buffer.concat([saltBuf, blockNo])).digest();
        const t = Buffer.from(u);
        for (let i = 1; i < iterations; i++) {
            u = crypto.createHmac(_HASH_ALGO, password).update(u).digest();
            for (let j = 0; j < t.length; j++) {
                t[j] ^= u[j];
            }
        }
        return t;
    };

    // PBKDF2-HMAC-SHA256でパスワードを導出(hex文字列で返却).
    // password 対象のパスワードを設定します.
    // salt hex文字列のsaltを設定します.
    // iterations 反復回数を設定します(デフォルト10000).
    // keyLen 導出する鍵長(バイト)を設定します(デフォルト32).
    // 戻り値: hex文字列の導出結果が返却されます.
    const derive = function (password, salt, iterations, keyLen) {
        iterations = iterations | 0;
        if (iterations <= 0) {
            iterations = _DEFAULT_ITERATIONS;
        }
        keyLen = keyLen | 0;
        if (keyLen <= 0) {
            keyLen = _DEFAULT_KEY_LEN;
        }
        const saltBuf = Buffer.from(salt, "hex");
        const blocks = Math.ceil(keyLen / _HASH_LEN);
        const bufs = [];
        for (let i = 1; i <= blocks; i++) {
            bufs.push(_f(password, saltBuf, iterations, i));
        }
        return Buffer.concat(bufs).subarray(0, keyLen).toString("hex");
    };

    // タイミング攻撃を避けるための定数時間文字列比較.
    // a 比較対象の文字列を設定します.
    // b 比較対象の文字列を設定します.
    // 戻り値: 一致する場合true.
    const _timingSafeEqual = function (a, b) {
        if (typeof a != "string" || typeof b != "string" ||
            a.length != b.length) {
            return false;
        }
        let diff = 0;
        const len = a.length;
        for (let i = 0; i < len; i++) {
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
    };

    // パスワードをハッシュ化(新規登録・パスワード変更時に利用).
    // password 対象のパスワードを設定します.
    // iterations 反復回数を設定します(省略時デフォルト10000).
    // 戻り値: {salt, hash, iterations} が返却されます.
    //         この内容をそのまま保存し、verify() に渡してください.
    exports.hash = function (password, iterations) {
        iterations = iterations | 0;
        if (iterations <= 0) {
            iterations = _DEFAULT_ITERATIONS;
        }
        const salt = genSalt();
        const hash = derive(password, salt, iterations);
        return { salt: salt, hash: hash, iterations: iterations };
    };

    // パスワード検証(ログイン時に利用).
    // password 検証対象のパスワードを設定します.
    // stored hash() で生成した {salt, hash, iterations} を設定します.
    // 戻り値: 一致する場合true.
    exports.verify = function (password, stored) {
        if (stored == null || stored.salt == null || stored.hash == null) {
            return false;
        }
        const iterations = stored.iterations || _DEFAULT_ITERATIONS;
        const check = derive(password, stored.salt, iterations);
        return _timingSafeEqual(check, stored.hash);
    };

    // salt生成処理を個別に利用したい場合向けに公開.
    exports.genSalt = genSalt;

    // 導出処理を個別に利用したい場合向けに公開.
    exports.derive = derive;
})();
