//////////////////////////////////////////////////////////
// JSON-BinaryI/O用オブジェクト (Ultra-Optimized Version)
// 
// 【設計思想】
// 通常のJSON.stringify/parseは文字列操作とメモリ確保を大量に行うため、
// リアルタイム処理（低遅延・高フレームレートが要求される環境）では
// ガベージコレクション(GC)スパイクの原因となります。
// 本モジュールは以下の技術を用いてゼロアロケーションに近い動作を実現し、
// V8やLLRTなどのランタイムで極限のパフォーマンスを発揮します。
//
// 1. DataViewと事前割り当てバッファによるメモリ使い回し（GC抑制）
// 2. BigIntによる安全で正確な64bit整数(Long)処理
// 3. TextEncoder/Decoderによるネイティブかつマルチバイト安全な文字列処理
//
// 【注意事項】
// ⚠️ encode() はスレッドセーフではありません。
//    内部バッファ(buffer/offset)をモジュールグローバルで共有しているため、
//    Worker Threads等で encode() を並行呼び出しするとデータが破損します。
//    並行処理が必要な場合は、スレッドごとに本モジュールのインスタンスを
//    分離してください。
//
// ⚠️ decodeLong() はBigInt→Numberに変換するため、
//    Number.MAX_SAFE_INTEGER(2^53-1)を超える整数値は精度が失われます。
//    巨大な整数をそのまま扱う必要がある場合は、encodeLong/decodeLong を
//    BigIntのまま返すよう拡張してください。
//////////////////////////////////////////////////////////
(function (global) {
    'use strict'

    // ========================================================
    // 定数定義 (データ型のビットマスクと識別子)
    // ========================================================
    // 数値型の範囲: 0x11〜0x1f
    const MASK_NUMBER = 0x10;
    // 文字列型の範囲: 0x21〜0x2f
    const MASK_STRING = 0x20;

    // データタイプ一覧 (1バイトで表現)
    const TYPE_NULL = 0x00;
    const TYPE_FLOAT = MASK_NUMBER | 0x01; // 0x11: 64bit浮動小数点(IEEE 754)
    const TYPE_LONG = MASK_NUMBER | 0x02;  // 0x12: 64bit符号付き整数
    const TYPE_INT32 = MASK_NUMBER | 0x03; // 0x13: 32bit符号付き整数
    const TYPE_UINT16 = MASK_NUMBER | 0x04; // 0x14: 16bit符号なし整数
    const TYPE_UINT8 = MASK_NUMBER | 0x05;  // 0x15: 8bit符号なし整数

    const TYPE_STRING = MASK_STRING | 0x01; // 0x21: 一般的な文字列(長さ制限なし)
    const TYPE_KEY = MASK_STRING | 0x02;    // 0x22: Objectのキー用文字列(最大255バイト)

    const TYPE_BOOLEAN = 0x30; // 真偽値
    const TYPE_DATE = 0x40;    // 日付オブジェクト(内部的にはLong型のミリ秒)
    const TYPE_ARRAY = 0xe0;   // 配列
    const TYPE_OBJECT = 0xf0;  // オブジェクト(連想配列)
    const TYPE_EOF_OBJECT = 0xfe; // オブジェクトの終端マーカー
    //  ↑ 修正: 旧値 0xf1 は TYPE_OBJECT(0xf0) と隣接しバッファ破損時の誤検知リスクがあった。
    //          TYPE_ARRAY(0xe0)〜TYPE_OBJECT(0xf0) レンジから離れた 0xfe に変更。

    // ========================================================
    // 内部バッファ管理 (GCスパイク抑制の要)
    // ========================================================
    // 毎回のエンコードで new Uint8Array() を行うとゴミ(Garbage)が発生するため、
    // 巨大な共有メモリ（スクラッチパッド）を最初に1つだけ用意して使い回します。
    let bufferSize = 1024 * 1024; // 初期サイズ: 1MB
    let buffer = new ArrayBuffer(bufferSize);
    let view = new DataView(buffer);       // 異なる型の高速書き込み用
    let uint8Array = new Uint8Array(buffer); // メモリコピーや文字列操作用
    let offset = 0; // 現在の書き込み位置を示すカーソル

    /**
     * バッファ容量の確保
     * @param {number} size - これから書き込むバイト数
     * 書き込みに必要なサイズが現在のバッファ容量を超える場合、
     * バッファサイズを倍増させて古いデータを新しいバッファにコピーします。
     */
    const ensureCapacity = function (size) {
        if (offset + size > bufferSize) {
            // 必要なサイズを満たすまで倍々で拡張
            while (offset + size > bufferSize) {
                bufferSize *= 2;
            }
            const newBuffer = new ArrayBuffer(bufferSize);
            const newUint8Array = new Uint8Array(newBuffer);
            newUint8Array.set(uint8Array); // 既存のデータを新バッファへ退避

            // 参照を新しいバッファに切り替え
            buffer = newBuffer;
            view = new DataView(buffer);
            uint8Array = newUint8Array;
        }
    };

    // ========================================================
    // 高速な型判定ユーティリティ
    // ========================================================
    // 修正: 旧実装はビット演算ベースで TYPE_BOOLEAN(0x30) が isMaskNumber を
    //       通過してしまう脆弱性があった。
    //       TYPE_BOOLEAN は MASK_NUMBER(0x10) と MASK_STRING(0x20) の両ビットを持つため、
    //       (0x30 & 0x10) !== 0 が true になり誤判定が発生していた。
    //       新実装は各型の割り当て範囲(0x11〜0x1f / 0x21〜0x2f)を
    //       シンプルな範囲チェックで判定するため、誤検知が起きない。
    const isMaskNumber = type => type >= 0x11 && type <= 0x1f;
    const isMaskString = type => type >= 0x21 && type <= 0x2f;

    // JSエンジンの最適化が効きやすい標準関数や単純な比較を使用
    const isInteger = value => Number.isInteger(value);
    const isUint8 = value => value >= 0 && value <= 255 && isInteger(value);
    const isUint16 = value => value >= 0 && value <= 65535 && isInteger(value);
    // 32bit整数の範囲(-2147483648 〜 2147483647)
    const isInt32 = value => value >= -2147483648 && value <= 2147483647 && isInteger(value);

    // GAS環境かどうかの安全な判定
    const isGAS = typeof Utilities !== 'undefined';

    // GAS環境対応 TextEncoder / TextDecoder ポリフィル
    // GASにはネイティブのTextEncoderがないため、Utilitiesクラスを使って代用します。
    const _TEXT_ENCODER = isGAS ? {
        encode: function (value) {
            // Utilities.newBlob().getBytes() は Java仕様の「符号付きバイト(-128〜127)」を返すため、
            // Uint8Array でラップして「符号なしバイト(0〜255)」にキャストします。
            return new Uint8Array(Utilities.newBlob(value).getBytes());
        }
    } : new TextEncoder();

    const _TEXT_DECODER = isGAS ? {
        decode: function (uint8Array) {
            // GASのBlobは「符号付きバイト(-128〜127)」の配列を期待します。
            // Uint8Array(0〜255)のままArray.from()で渡すと、128以上の値でGASがエラーを吐くため、
            // Int8Arrayのビューを通して符号付きにキャストしてから配列化します。
            const signedBytes = new Int8Array(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
            return Utilities.newBlob(Array.from(signedBytes)).getDataAsString();
        }
    } : new TextDecoder();

    // ========================================================
    // エンコード（シリアライズ）処理群
    // ========================================================

    // 浮動小数点のエンコード (8バイト)
    const encodeFloat = function (value) {
        ensureCapacity(8);
        // true = リトルエンディアンで書き込み (x86/ARM等多くのアーキテクチャで高速)
        view.setFloat64(offset, value, true);
        offset += 8;
    }

    // 64bit整数のエンコード (8バイト)
    const encodeLong = function (value) {
        ensureCapacity(8);
        // JSの通常のNumber(Float64)からBigIntへ変換。
        // 小数点が含まれていると例外を吐くため Math.trunc で切り捨てて安全に処理。
        view.setBigInt64(offset, BigInt(Math.trunc(value)), true);
        offset += 8;
    }

    // 一般文字列のエンコード
    const encodeString = function (value) {
        const encoded = _TEXT_ENCODER.encode(value);
        const len = encoded.length;
        // 文字列長(4バイト: Uint32) + 実際の文字列データ
        ensureCapacity(4 + len);
        view.setUint32(offset, len, true);
        offset += 4;
        uint8Array.set(encoded, offset);
        offset += len;
    }

    // オブジェクトキー用文字列のエンコード (省スペース化)
    const encodeKey = function (value) {
        const encoded = _TEXT_ENCODER.encode(value);
        let len = encoded.length;

        // 修正: 旧実装は単純に「255バイト目で切り捨て」ていたため、
        //       マルチバイト文字(UTF-8では1文字2〜4バイト)の途中でカットされると
        //       不正なUTF-8シーケンスが生成され、デコード時に文字化けまたは例外が発生した。
        //       新実装は255バイト以内に収まる文字境界(先頭バイト)まで巻き戻すことで
        //       常に正当なUTF-8シーケンスのみを書き込む。
        //
        //       UTF-8の継続バイトは 10xxxxxx (0x80〜0xBF) のビットパターンを持つ。
        //       len を後ろから走査し、継続バイトを踏んでいる間は1ずつ戻すことで
        //       マルチバイト文字の先頭バイトまで安全に到達できる。
        if (len > 255) {
            len = 255;
            while (len > 0 && (encoded[len] & 0xc0) === 0x80) len--;
        }

        ensureCapacity(1 + len);
        view.setUint8(offset, len); // 長さを1バイトで書き込み
        offset += 1;
        uint8Array.set(encoded.subarray(0, len), offset); // 有効バイト分だけ書き込み
        offset += len;
    }

    // 配列のエンコード
    const encodeArray = function (value) {
        const len = value.length;
        // 配列の要素数を最適な数値型で書き込み
        encodeNumberAndType(len);
        // 各要素を再帰的にエンコード
        for (let i = 0; i < len; i++) {
            encodeValue(value[i]);
        }
    }

    // オブジェクトのエンコード
    const encodeObject = function (value) {
        for (let k in value) {
            ensureCapacity(1);
            view.setUint8(offset++, TYPE_KEY); // キーが来ることを宣言
            encodeKey(k);                      // キーを書き込み
            encodeValue(value[k]);             // 値を書き込み
        }
        ensureCapacity(1);
        view.setUint8(offset++, TYPE_EOF_OBJECT); // オブジェクトの終了マーク
    }

    // 数値の最適化エンコード
    // 値の大きさに応じて最もバイト数を食わない型を自動選択します。
    // ペイロード（通信量）削減に直結する重要な処理です。
    const encodeNumberAndType = function (value) {
        if (!isInteger(value)) {
            // 小数点がある場合はFloat64 (8バイト)
            ensureCapacity(1); view.setUint8(offset++, TYPE_FLOAT);
            encodeFloat(value);
        } else if (isUint8(value)) {
            // 0〜255ならUint8 (1バイト)
            ensureCapacity(2);
            view.setUint8(offset++, TYPE_UINT8);
            view.setUint8(offset++, value);
        } else if (isUint16(value)) {
            // 0〜65535ならUint16 (2バイト)
            ensureCapacity(3);
            view.setUint8(offset++, TYPE_UINT16);
            view.setUint16(offset, value, true);
            offset += 2;
        } else if (isInt32(value)) {
            // 32bit範囲ならInt32 (4バイト)
            ensureCapacity(5);
            view.setUint8(offset++, TYPE_INT32);
            view.setInt32(offset, value, true);
            offset += 4;
        } else {
            // それ以上はLong型 (8バイト)
            ensureCapacity(1); view.setUint8(offset++, TYPE_LONG);
            encodeLong(value);
        }
    }

    // 値の型を判定し、適切なエンコード関数へディスパッチする中核処理
    const encodeValue = function (value) {
        if (value === null || value === undefined) {
            ensureCapacity(1); view.setUint8(offset++, TYPE_NULL);
        } else if (typeof value === "number") {
            encodeNumberAndType(value);
        } else if (typeof value === "string") {
            ensureCapacity(1); view.setUint8(offset++, TYPE_STRING);
            encodeString(value);
        } else if (value instanceof Date || (value !== undefined && value !== null && value.isUTCDate === true)) {
            ensureCapacity(1); view.setUint8(offset++, TYPE_DATE);
            encodeLong(value.getTime()); // Dateはミリ秒(Long)にして保存
        } else if (typeof value === "boolean") {
            ensureCapacity(2);
            view.setUint8(offset++, TYPE_BOOLEAN);
            view.setUint8(offset++, value ? 1 : 0); // 真偽値は 1 か 0
        } else if (Array.isArray(value)) {
            ensureCapacity(1); view.setUint8(offset++, TYPE_ARRAY);
            encodeArray(value);
        } else if (typeof value === "object") {
            ensureCapacity(1); view.setUint8(offset++, TYPE_OBJECT);
            encodeObject(value);
        } else {
            // 未知の型（関数など）はとりあえずnullとして扱う
            ensureCapacity(1); view.setUint8(offset++, TYPE_NULL);
        }
    }

    // ========================================================
    // デコード（デシリアライズ）処理群
    // ========================================================
    // デコード処理では、pos[0] に現在の読み込み位置（オフセット）を保持し、
    // 参照渡しのように扱ってカーソルを進めていきます。

    const decodeFloat = function (pos, targetView) {
        const val = targetView.getFloat64(pos[0], true);
        pos[0] += 8;
        return val;
    }

    const decodeLong = function (pos, targetView) {
        const val = targetView.getBigInt64(pos[0], true);
        pos[0] += 8;
        // ⚠️ BigInt → Number 変換のため Number.MAX_SAFE_INTEGER(2^53-1) を超える
        //    整数値は精度が失われます。巨大な整数をそのまま扱う場合は BigInt のまま
        //    返すよう本関数を拡張してください。
        return Number(val);
    }

    const decodeString = function (pos, targetView, targetUint8Array) {
        const len = targetView.getUint32(pos[0], true); // 最初の4バイトで長さを取得
        pos[0] += 4;
        // TextDecoderに部分配列(subarray)を渡してネイティブ変換
        const str = _TEXT_DECODER.decode(targetUint8Array.subarray(pos[0], pos[0] + len));
        pos[0] += len;
        return str;
    }

    const decodeKey = function (pos, targetView, targetUint8Array) {
        const len = targetView.getUint8(pos[0]); // キー長は1バイト
        pos[0] += 1;
        const str = _TEXT_DECODER.decode(targetUint8Array.subarray(pos[0], pos[0] + len));
        pos[0] += len;
        return str;
    }

    const decodeArray = function (pos, targetView, targetUint8Array) {
        const type = targetView.getUint8(pos[0]++);
        const len = decodeNumberByType(pos, type, targetView);

        // 修正: 配列長として不正な値（負数・小数・範囲外）が来た場合に
        //       new Array(len) で例外やメモリ枯渇が起きるのを防ぐ。
        //       0x7fffffff(約2.1億)はJSエンジンが扱える配列の現実的な上限。
        if (!Number.isInteger(len) || len < 0 || len > 0x7fffffff) {
            throw new Error("Invalid array length: " + len);
        }

        // V8エンジンの最適化：配列サイズが分かっている場合は事前に確保する（Pushより高速）
        const ret = new Array(len);
        for (let i = 0; i < len; i++) {
            ret[i] = decodeValue(pos, targetView, targetUint8Array);
        }
        return ret;
    }

    const decodeObject = function (pos, targetView, targetUint8Array) {
        let type;
        const ret = {};
        while (true) {
            type = targetView.getUint8(pos[0]++);
            // 終端マーカーが来たらオブジェクトパース完了
            if (type === TYPE_EOF_OBJECT) return ret;

            // キーと値を交互に読み込んでセット
            const key = decodeStringOrKeyByType(pos, type, targetView, targetUint8Array);
            ret[key] = decodeValue(pos, targetView, targetUint8Array);
        }
    }

    const decodeNumberByType = function (pos, type, targetView) {
        switch (type) {
            case TYPE_FLOAT: return decodeFloat(pos, targetView);
            case TYPE_UINT8: return targetView.getUint8(pos[0]++);
            case TYPE_UINT16:
                const u16 = targetView.getUint16(pos[0], true);
                pos[0] += 2;
                return u16;
            case TYPE_INT32:
                const i32 = targetView.getInt32(pos[0], true);
                pos[0] += 4;
                return i32;
            case TYPE_LONG: return decodeLong(pos, targetView);
        }
        throw new Error("Type mismatch for numeric conversion: 0x" + type.toString(16));
    }

    const decodeStringOrKeyByType = function (pos, type, targetView, targetUint8Array) {
        switch (type) {
            case TYPE_STRING: return decodeString(pos, targetView, targetUint8Array);
            case TYPE_KEY: return decodeKey(pos, targetView, targetUint8Array);
        }
        throw new Error("Type mismatch for transliteration: 0x" + type.toString(16));
    }

    const decodeValue = function (pos, targetView, targetUint8Array) {
        const type = targetView.getUint8(pos[0]++);
        if (type === TYPE_NULL) return null;
        if (isMaskNumber(type)) return decodeNumberByType(pos, type, targetView);
        if (isMaskString(type)) return decodeStringOrKeyByType(pos, type, targetView, targetUint8Array);
        if (type === TYPE_DATE) return new Date(decodeLong(pos, targetView));
        if (type === TYPE_BOOLEAN) return targetView.getUint8(pos[0]++) === 1;
        if (type === TYPE_ARRAY) return decodeArray(pos, targetView, targetUint8Array);
        if (type === TYPE_OBJECT) return decodeObject(pos, targetView, targetUint8Array);
        throw new Error("Conversion type mismatch: 0x" + type.toString(16));
    }

    // ========================================================
    // エントリポイント (外部から呼ばれる主処理)
    // ========================================================

    /**
     * JSオブジェクトをバイナリ配列に変換します。
     * ⚠️ スレッドセーフではありません。並行呼び出し禁止。
     * @param {any} value - 変換対象のデータ
     * @returns {Uint8Array} - 変換されたバイナリデータ
     */
    const encode = function (value) {
        // スクラッチパッド（共有メモリ）のカーソルをリセット。
        // これにより、前回のゴミを残したまま新しいデータを上書きでき、
        // 毎回 new ArrayBuffer するコストをゼロに抑えられます。
        offset = 0;
        encodeValue(value);

        // 実際に書き込んだ部分だけを切り取って返す。
        // ※ slice() は新しいメモリを確保しますが、出力結果として返す以上
        // 最小限のコピーは避けられないため、ここで一度だけ行います。
        return new Uint8Array(buffer, 0, offset).slice();
    }

    /**
     * バイナリ配列をJSオブジェクトに復元します。
     * @param {Uint8Array | Array} bin - デコード対象のバイナリデータ
     * @returns {any} - 復元されたJSオブジェクト
     */
    const decode = function (bin) {
        // 標準のArrayが渡された場合へのフォールバック（型安全の担保）
        const u8bin = bin instanceof Uint8Array ? bin : Uint8Array.from(bin);
        // DataViewを使うことで、エンディアンを指定した高速な復元が可能
        const targetView = new DataView(u8bin.buffer, u8bin.byteOffset, u8bin.byteLength);

        // 参照渡しでカーソルを管理するため、配列でラップして渡す
        const pos = [0];
        return decodeValue(pos, targetView, u8bin);
    }

    // ========================================================
    // モジュールエクスポート
    // ========================================================
    // Node.js(CommonJS)環境とブラウザ環境の両方に対応
    if (typeof exports !== 'undefined') {
        exports.encode = encode;
        exports.decode = decode;
    } else {
        global.jsonb = { encode, decode };
    }

})(typeof window !== 'undefined' ? window : globalThis || this);



