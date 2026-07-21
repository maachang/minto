////////////////////////////////////////////////////////////
// convert-binaryライブラリ.
// 主要なjsの型をバイナリ変換する.
// バイナリで、データ格納する事で１つのファイル容量を減らします.
////////////////////////////////////////////////////////////
(function() {
'use strict'

// 数字マスク.
const MASK_NUMBER = 0x10;
// 文字マスク.
const MASK_STRING = 0x20;

// null.
const TYPE_NULL = 0x00;
// 浮動小数点や整数を含む64bit値.
const TYPE_FLOAT = MASK_NUMBER | 0x01;
// 整数64bit値.
const TYPE_LONG = MASK_NUMBER | 0x02;
// 32bit整数.
const TYPE_INT32 = MASK_NUMBER | 0x03;
// 16bit unsigined 整数.
const TYPE_UINT16 = MASK_NUMBER | 0x04;
// 8bit unsigined 整数.
const TYPE_UINT8 = MASK_NUMBER | 0x05;
// 文字列.
const TYPE_STRING = MASK_STRING | 0x01;
// Object.key用文字列(英数で256文字以内).
const TYPE_KEY = MASK_STRING | 0x02;
// Boolean型.
const TYPE_BOOLEAN = 0x30;
// Date型.
const TYPE_DATE = 0x40;
// Calendar型.
const TYPE_CALENDAR = 0x41;
// Time型.
const TYPE_TIME = 0x42;
// Timestamp型.
const TYPE_TIMESTAMP = 0x43;
// Array型.
const TYPE_ARRAY = 0xe0;
// Object型.
const TYPE_OBJECT = 0xf0;
// Object型の終端.
const TYPE_EOF_OBJECT = 0xf1;

// 外部定義.
exports.TYPE_NULL = TYPE_NULL;
exports.TYPE_FLOAT = TYPE_FLOAT;
exports.TYPE_LONG = TYPE_LONG;
exports.TYPE_INT32 = TYPE_INT32;
exports.TYPE_UINT16 = TYPE_UINT16;
exports.TYPE_UINT8 = TYPE_UINT8;
exports.TYPE_STRING = TYPE_STRING;
exports.TYPE_KEY = TYPE_KEY;
exports.TYPE_BOOLEAN = TYPE_BOOLEAN;
exports.TYPE_DATE = TYPE_DATE;
exports.TYPE_CALENDAR = TYPE_CALENDAR;
exports.TYPE_TIME = TYPE_TIME;
exports.TYPE_TIMESTAMP = TYPE_TIMESTAMP;
exports.TYPE_DATE = TYPE_DATE;
exports.TYPE_ARRAY = TYPE_ARRAY;
exports.TYPE_OBJECT = TYPE_OBJECT;


// 数字タイプかマスクチェック.
// type 対象のタイプを設定します.
// 戻り値: 対象タイプが数値タイプの場合 true.
const isMaskNumber = function(type) {
    return (type & MASK_NUMBER) != 0 &&
        ((type - MASK_NUMBER) & 0xf0) == 0;
}
// 外部定義.
exports.isMaskNumber = isMaskNumber;

// 文字タイプかマスクチェック.
// type 対象のタイプを設定します.
// 戻り値: 対象タイプが文字タイプの場合 true.
const isMaskString = function(type) {
    return (type & MASK_STRING) != 0 &&
        ((type - MASK_STRING) & 0xf0) == 0;
}
// 外部定義.
exports.isMaskString = isMaskString;

// 指定valueが数字型かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合数字型です.
const isNumber = function(value) {
    return typeof(value) == "number";
}
// 外部定義.
exports.isNumber = isNumber;

// 指定valueが浮動小数点かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合浮動小数点です.
const isFloat = function(value){
  return Number(value) === value
    && value % 1 !== 0;
}
// 外部定義.
exports.isFloat = isFloat;

// 指定valueが整数かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合整数です.
const isInteger = function(value) {
    return Number.isInteger(value);
}
// 外部定義.
exports.isInteger = isInteger;

// 指定valueが32bit整数かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合32bit整数です.
const isInt32 = function(value) {
    return value == (value|0);
}
// 外部定義.
exports.isInt32 = isInt32;

// 指定valueが16bitのunsigned整数かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合16bitのunsigned整数です.
const isUint16 = function(value) {
    return isInt32(value) &&
        value == (value & 0x0ffff);
}
// 外部定義.
exports.isUint16 = isUint16;

// 指定valueが8bitのunsigned整数かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合8bitのunsigned整数です.
const isUint8 = function(value) {
    return isInt32(value) &&
        value == (value & 0x0ff);
}
// 外部定義.
exports.isUint8 = isUint8;

// 指定valueが文字列かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合文字列です.
const isString = function(value) {
    return typeof(value) == "string";
}
// 外部定義.
exports.isString = isString;

// 指定valueがBoolean型かチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Boolean型です.
const isBoolean = function(value) {
    return typeof(value) == "boolean"; 
}
// 外部定義.
exports.isBoolean = isBoolean;

// 指定valueがDateオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Dateオブジェクトです.
const isDate = function(value) {
    return value instanceof Date;
}
// 外部定義.
exports.isDate = isDate;

// 指定valueがCalendarオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Calendarオブジェクトです.
const isCalendar = function(value) {
    return value instanceof Calendar;
}
// 外部定義.
exports.isCalendar = isCalendar;

// 指定valueがTimeオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Timeオブジェクトです.
const isTime = function(value) {
    return value instanceof Time;
}
// 外部定義.
exports.isTime = isTime;

// 指定valueがTimestampオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Timeオブジェクトです.
const isTimestamp = function(value) {
    return value instanceof Timestamp;
}
// 外部定義.
exports.isTimestamp = isTimestamp;

// 指定valueがArrayオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合Arrayオブジェクトです.
const isArray = function(value) {
    return value instanceof Array;
}
// 外部定義.
exports.isArray = isArray;

// 指定valueがオブジェクトかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合オブジェクトです.
const isObject = function(value) {
    return typeof(value) == "object" &&
        !isString(value) && !isDate(value) &&
        !isArray(value);
}
// 外部定義.
exports.isObject = isObject;

// 指定valueがnull or undefinedかチェック.
// value チェック条件を設定します.
// 戻り値: true の場合null or undefinedです.
const isNull = function(value) {
    return value == null || value == undefined;
}
// 外部定義.
exports.isNull = isNull;

// 浮動小数点エンコード.
// out バイナリをセットするArrayを設定します.
// value 数字を設定します.
const encodeFloat = function(out, value) {
    ///////////////////////////////////////////////////////////////////////
    // 数字の変換ルール.
    // 数字をバイナリ変換する場合、以下のように設定する.
    // 1234 => [0x04, 0x12, 0x34]
    // 先頭の１バイトに長さ、この場合は "1234".length == 4 がセットされる.
    // 次の２バイト目は 0x12 だが、これは "1234"[0] と "1234[1]" を１バイト
    // に変換した結果である。
    // 
    // このように単純に１バイトに２桁の数字を入れていくようにする.
    //
    // また数字を扱う場合は例外が存在する.
    //  - = 0x0a
    //  . = 0x0b
    // それ以外にたとえば "123" の場合 [0x12, 0x3f] と言う形で奇数の場合は
    // 最後に 0x0f が格納される.
    // このようなルールで数字変換を行う.
    ///////////////////////////////////////////////////////////////////////

    let n, c, len;

    // 数字を文字列変換.
    value = value.toString();

    // ヘッダ１バイトで長さをセット.
    len = (value.length + 1) >> 1;
    out[out.length] = (len & 0x0ff);

    // 文字列の数字をバイナリ変換で出力.
    len = value.length - 1;
    c = out.length;
    for(let i = 0; i < len; i += 2) {
        if(value[i] == "-" || value[i] == ".") {
            n = value[i] == "-" ? 0xa0 : 0xb0;
        } else {
            n = (value[i] - "0") << 4; 
        }
        if(value[i + 1] == "-" || value[i + 1] == ".") {
            n |= value[i + 1] == "-" ? 0x0a : 0x0b;
        } else {
            n |= (value[i + 1] - "0"); 
        }
        out[c ++] = n;
    }
    // 奇数.
    if((len & 0x01) == 0) {
        n = ((value[len] - "0") << 4) | 0x0f;
    // 偶数.
    } else {
        n = ((value[len - 1] - "0") << 4) |
            (value[len] - "0");
    }
    out[c ++] = n;
}
// 外部定義.
exports.encodeFloat = encodeFloat;

// 浮動小数点デコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされた浮動小数点が返却されます.
const decodeFloat = function(pos, bin) {
    let p, b, n, str;
    p = pos[0];
    const len = bin[p ++] & 0x0ff;
    str = "";
    for(let i = 0; i < len; i ++) {
        b = bin[p ++];
        if((n = (b & 0xf0) >> 4) >= 0x0a) {
            if(n == 0x0a) {
                str += "-";
            } else if(n == 0x0b) {
                str += ".";
            }
        } else {
            str += n;
        }
        if((n = (b & 0x0f)) >= 0x0a) {
            if(n == 0x0a) {
                str += "-";
            } else if(n == 0x0b) {
                str += ".";
            }
        } else {
            str += n;
        }
    }
    pos[0] = p;
    return parseFloat(str);
}
// 外部定義.
exports.decodeFloat = decodeFloat;

// long型の32bit計算係数.
// 0x100000000の数字.
const _LONG_BY32 = 4294967296;

// long(64bit整数)のエンコード.
// out バイナリをセットするArrayを設定します.
// value long(64bit整数)を設定します.
const encodeLong = function(out, value) {
    let p = out.length;
    // マイナスの場合は文字列で保存.
    // 微妙にjsの64bit計算が面倒なので.
    if(value < 0) {
        // 文字列変換.
        value = value.toString();
        const len = value.length;
        out[p ++] = 1; // マイナスセット.
        out[p ++] = (len - 1) & 0x0ff; // 長さセット.
        // -を加えない.
        for(let i = 1; i < len; i ++) {
            out[p ++] = value[i] - "0";
        }
        return out;
    }
    // プラスの数字の場合.
    const low = value & 0xffffffff;
    const high = (value / _LONG_BY32)|0;
    out[p ++] = 0; // プラス.
    out[p ++] = low & 0x0ff;
    out[p ++] = ((low & 0x0ff00) >> 8) & 0x0ff;
    out[p ++] = ((low & 0x0ff0000) >> 16) & 0x0ff;
    out[p ++] = ((low & 0x0ff000000) >> 24) & 0x0ff;
    out[p ++] = high & 0x0ff;
    out[p ++] = ((high & 0x0ff00) >> 8) & 0x0ff;
    out[p ++] = ((high & 0x0ff0000) >> 16) & 0x0ff;
    out[p ++] = ((high & 0x0ff000000) >> 24) & 0x0ff;
    return out;
}
// 外部定義.
exports.encodeLong = encodeLong;

// long(64bit整数)のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたlong(64bit整数)が返却されます.
const decodeLong = function(pos, bin) {
    let p = pos[0];
    const type = bin[p ++];
    // プラスの数字の場合.
    if(type == 0) {
        const low = ((bin[p ++] & 0x0ff) +
            ((bin[p ++] & 0x0ff) * (1 << 8)) +
            ((bin[p ++] & 0x0ff) * (1 << 16)) +
            ((bin[p ++] & 0x0ff) * (1 << 24)));
        const high = ((bin[p ++] & 0x0ff) +
            ((bin[p ++] & 0x0ff) * (1 << 8)) +
            ((bin[p ++] & 0x0ff) * (1 << 16)) +
            ((bin[p ++] & 0x0ff) * (1 << 24)));
        pos[0] = p;
        return (high * _LONG_BY32) + low;
    // マイナスの場合.
    } else if(type == 1) {
        // 長さを取得.
        const len = bin[p ++] & 0x0ff;
        let str = "-";
        for(let i = 0; i < len; i ++) {
            str = str + bin[p ++];
        }
        return parseInt(str);
    }
    throw new Error("Unknown long decoding type: " + type);
}
// 外部定義.
exports.decodeLong = decodeLong;

// int(32bit整数)のエンコード.
// out バイナリをセットするArrayを設定します.
// value int(32bit整数)を設定します.
const encodeInt32 = function(out, value) {
    let p = out.length;
    out[p ++] = value & 0x0ff;
    out[p ++] = (value & 0x0ff00) >> 8;
    out[p ++] = (value & 0x0ff0000) >> 16;
    out[p ++] = (value & 0x0ff000000) >> 24;
}
// 外部定義.
exports.encodeInt32 = encodeInt32;

// int(32bit整数)のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたint(32bit整数)が返却されます.
const decodeInt32 = function(pos, bin) {
    let p = pos[0];
    const ret = ((bin[p ++] & 0x0ff) |
        ((bin[p ++] & 0x0ff) << 8) |
        ((bin[p ++] & 0x0ff) << 16) |
        ((bin[p ++] & 0x0ff) << 24));
    pos[0] = p;
    return ret;
}
// 外部定義.
exports.decodeInt32 = decodeInt32;

// int(16bit整数)のエンコード.
// out バイナリをセットするArrayを設定します.
// value int(16bitのunsigned整数)を設定します.
const encodeUint16 = function(out, value) {
    let p = out.length;
    out[p ++] = value & 0x0ff;
    out[p ++] = (value & 0x0ff00) >> 8;
}
// 外部定義.
exports.encodeUint16 = encodeUint16;

// int(16bitのunsigned整数)のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたint(16bitのunsigned整数)が返却されます.
const decodeUint16 = function(pos, bin) {
    let p = pos[0];
    const ret = ((bin[p ++] & 0x0ff) |
        ((bin[p ++] & 0x0ff) << 8));
    pos[0] = p;
    return ret;
}
// 外部定義.
exports.decodeUint16 = decodeUint16;

// int(8bitのunsigned整数)のエンコード.
// out バイナリをセットするArrayを設定します.
// value int(8bitのunsigned整数)を設定します.
const encodeUint8 = function(out, value) {
    out[out.length] = value & 0x0ff;
}
// 外部定義.
exports.encodeUint8 = encodeUint8;

// int(8bitのunsigned整数)のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたint(8bitのunsigned整数)が返却されます.
const decodeUint8 = function(pos, bin) {
    return bin[pos[0] ++] & 0x0ff;
}
// 外部定義.
exports.decodeUint8 = decodeUint8;

// 文字エンコード.
// out バイナリをセットするArrayを設定します.
// value 文字列を設定します.
const encodeString = function(out, value) {
    const bin = Buffer.from(value);
    const len = bin.length;
    out[out.length] = len & 0x0ff;
    out[out.length] = (len & 0x0ff00) >> 8;
    out[out.length] = (len & 0x0ff0000) >> 16;
    let pos = out.length;
    for(let i = 0; i < len; i ++) {
        out[pos ++] = bin[i];
    }
}
// 外部定義.
exports.encodeString = encodeString;

// Calendarオブジェクトをエンコード.
// out バイナリをセットするArrayを設定します.
// value オブジェクトを設定します.
const encodeCalendar = function(out, value) {
    value.exportBinary(out, out.length);
}
// 外部定義.
exports.encodeCalendar = encodeCalendar;

// Timeオブジェクトをエンコード.
// out バイナリをセットするArrayを設定します.
// value オブジェクトを設定します.
const encodeTime = function(out, value) {
    value.exportBinary(out, out.length);
}
// 外部定義.
exports.encodeTime = encodeTime;

// Timestampオブジェクトをエンコード.
// out バイナリをセットするArrayを設定します.
// value オブジェクトを設定します.
const encodeTimestamp = function(out, value) {
    value.exportBinary(out, out.length);
}
// 外部定義.
exports.encodeTimestamp = encodeTimestamp;

// デコード文字列を取得.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: 文字列長が返却されます.
const decodeStringLength = function(pos, bin) {
    let p = pos[0];
    return (bin[p] |
        (bin[p+1] << 8) |
        (bin[p+2] << 16));
}
exports.decodeStringLength = decodeStringLength;

// 文字デコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされた文字列が返却されます.
const decodeString = function(pos, bin) {
    let p = pos[0];
    const len = (bin[p] |
        (bin[p+1] << 8) |
        (bin[p+2] << 16));
    p += 3;
    const b = Buffer.alloc(len);
    for(let i = 0; i < len; i ++) {
        b[i] = bin[p++];
    }
    pos[0] = p;
    return b.toString()
}
// 外部定義.
exports.decodeString = decodeString;

// Key(String)のエンコード.
// out バイナリをセットするArrayを設定します.
// value Key(String)を設定します.
const encodeKey = function(out, value) {
    const len = value.length;
    out[out.length] = len & 0x0ff;
    let pos = out.length;
    for(let i = 0; i < len; i ++) {
        out[pos ++] = value.charCodeAt(i) & 0x0ff
    }
}
// 外部定義.
exports.encodeKey = encodeKey;

// Key(String)のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたKey(String)が返却されます.
const decodeKey = function(pos, bin) {
    let p = pos[0];
    const len = bin[p ++] & 0x0ff;
    let ret = "";
    for(let i = 0; i < len; i ++) {
        ret += String.fromCharCode(bin[p ++] & 0x0ff);
    }
    pos[0] = p;
    return ret;
}
// 外部定義.
exports.decodeKey = decodeKey;

// boolean型のエンコード.
// out バイナリをセットするArrayを設定します.
// value Boolean型を設定します.
const encodeBoolean = function(out, value) {
    out[out.length] = value ? 1 : 0;
}
// 外部定義.
exports.encodeBoolean = encodeBoolean;

// boolean型のデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたboolean型が返却されます.
const decodeBoolean = function(pos, bin) {
    return bin[pos[0] ++] == 1;
}
// 外部定義.
exports.decodeBoolean = decodeBoolean;

// Arrayオブジェクトのエンコード.
// out バイナリをセットするArrayを設定します.
// value Arrayオブジェクトを設定します.
const encodeArray = function(out, value) {
    const len = value.length;
    // Arrayオブジェクトの長さを設定.
    encodeNumberAndType(out, len);
    for(let i = 0; i < len; i ++) {
        // valueの内容に対してエンコード.
        encodeValue(out, value[i]);
    }
}
// 外部定義.
exports.encodeArray = encodeArray;

// Arrayオブジェクトのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたArrayオブジェクトが返却されます.
const decodeArray = function(pos, bin) {
    // 数字タイプを取得.
    const type = bin[pos[0] ++];
    // 数値タイプに合わせて変換.
    const len = decodeNumberByType(pos, type, bin);
    const ret = [];
    for(let i = 0; i < len; i ++) {
        ret[i] = decodeValue(pos, bin);
    }
    return ret;
}
// 外部定義.
exports.decodeArray = decodeArray;

// Calendarオブジェクトのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたオブジェクトが返却されます.
const decodeCalendar = function(pos, bin) {
    const ret = new Calendar();
    ret.importBinary(bin, pos[0]);
    pos[0] += ret.getByteLength();
    return ret;
}
// 外部定義.
exports.decodeCalendar = decodeCalendar;

// Timeオブジェクトのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたオブジェクトが返却されます.
const decodeTime = function(pos, bin) {
    const ret = new Time();
    ret.importBinary(bin, pos[0]);
    pos[0] += ret.getByteLength();
    return ret;
}
// 外部定義.
exports.decodeTime = decodeTime;

// Timestampオブジェクトのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたオブジェクトが返却されます.
const decodeTimestamp = function(pos, bin) {
    const ret = new Timestamp();
    ret.importBinary(bin, pos[0]);
    pos[0] += ret.getByteLength();
    return ret;
}
// 外部定義.
exports.decodeTimestamp = decodeTimestamp;

// オブジェクトのエンコード.
// out バイナリをセットするArrayを設定します.
// value オブジェクトを設定します.
const encodeObject = function(out, value) {
    for(let k in value) {
        out[out.length] = TYPE_KEY;
        encodeKey(out, k);
        encodeValue(out, value[k]);
    }
    // Objectの終端.
    out[out.length] = TYPE_EOF_OBJECT;
}
// 外部定義.
exports.encodeObject = encodeObject;

// オブジェクトのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたオブジェクトが返却されます.
const decodeObject = function(pos, bin) {
    let type;
    const ret = {};
    while(true) {
        // typeを取得.
        type = bin[pos[0] ++];
        // Objectの終端.
        if(type == TYPE_EOF_OBJECT) {
            return ret;
        }
        // keyを取得.
        ret[decodeStringOrKeyByType(pos, type, bin)] =
            decodeValue(pos, bin);
    }
}
// 外部定義.
exports.decodeObject = decodeObject;

// 最適な数字情報のエンコード.
// タイプも同時に設定される.
// out バイナリをセットするArrayを設定します.
// value 数字情報を設定します.
const encodeNumberAndType = function(out, value) {
    // 整数でない場合.
    if(!isInteger(value)) {
        // 整数でないのでこの方法でエンコード.
        encodeUint8(out, TYPE_FLOAT);
        encodeFloat(out, value);
    // unsigned 8bit 整数.
    } else if(isUint8(value)) {
        encodeUint8(out, TYPE_UINT8);
        encodeUint8(out, value);
    // unsigned 16bit 整数.
    } else if(isUint16(value)) {
        encodeUint8(out, TYPE_UINT16);
        encodeUint16(out, value);
    // 32bit整数.
    } else if(isInt32(value)) {
        encodeUint8(out, TYPE_INT32);
        encodeInt32(out, value);
    // 64bit整数.
    } else {
        encodeUint8(out, TYPE_LONG);
        encodeLong(out, value);
    }
}

// 最適な数字情報のエンコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// type 対象の型タイプを設定します.
// bin バイナリを設定します.
// 戻り値: デコードされた最適な数字が返却されます.
const decodeNumberByType = function(pos, type, bin) {
    switch(type) {
        case TYPE_FLOAT:
            return decodeFloat(pos, bin);
        case TYPE_UINT8:
            return decodeUint8(pos, bin);
        case TYPE_UINT16:
            return decodeUint16(pos, bin);
        case TYPE_INT32:
            return decodeInt32(pos, bin);
        case TYPE_LONG:
            return decodeLong(pos, bin);
    }
    throw new Error(
        "Type mismatch for numeric conversion: 0x" +
        type.toString(16));
}

// 最適な数字情報のエンコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// type 対象の型タイプを設定します.
// bin バイナリを設定します.
// 戻り値: デコードされた最適な数字が返却されます.
const decodeStringOrKeyByType = function(pos, type, bin) {
    switch(type) {
        case TYPE_STRING:
            return decodeString(pos, bin);
        case TYPE_KEY:
            return decodeKey(pos, bin);
    }
    throw new Error(
        "Type mismatch for transliteration: 0x" +
        type.toString(16));
}

// valueのエンコード.
// out バイナリをセットするArrayを設定します.
// value valueを設定します.
const encodeValue = function(out, value) {
    // null or undefined.
    if(isNull(value)) {
        out[out.length] = TYPE_NULL;
    // number型.
    } else if(isNumber(value)) {
        // 最適な数字情報でエンコード.
        encodeNumberAndType(out, value);
    // string型.
    } else if(isString(value)) {
        out[out.length] = TYPE_STRING;
        encodeString(out, value);
    // date型.
    } else if(isDate(value)) {
        /////////////////////////////////////////////////////
        // calendar, time, timestamp はDateオブジェクトの派生.
        /////////////////////////////////////////////////////
        // calendar
        if(isCalendar(value)) {
            out[out.length] = TYPE_CALENDAR;
            encodeCalendar(out, value);
        // time.
        } else if(isTime(value)) {
            out[out.length] = TYPE_TIME;
            encodeTime(out, value);
        // timestamp.
        } else if(isTimestamp(value)) {
            out[out.length] = TYPE_TIMESTAMP;
            encodeTimestamp(out, value);
        // date.
        } else {
            out[out.length] = TYPE_DATE;
            // long値の値をセット.
            encodeLong(out, value.getTime());
        }
    // boolean型.
    } else if(isBoolean(value)) {
        out[out.length] = TYPE_BOOLEAN;
        encodeBoolean(out, value);
    // array型.
    } else if(isArray(value)) {
        out[out.length] = TYPE_ARRAY;
        encodeArray(out, value);
    // object型.
    } else if(isObject(value)) {
        out[out.length] = TYPE_OBJECT;
        encodeObject(out, value);
    // その他.
    } else {
        // nullをセット.
        out[out.length] = TYPE_NULL;
    }
}
// 外部定義.
exports.encodeValue = encodeValue;

// valueのデコード.
// pos Array[number] バイナリのポジションを設定します.
//                   またこの処理が終わった場合、バイナリのポジションは
//                   更新されます.
// bin バイナリを設定します.
// 戻り値: デコードされたvalueが返却されます.
const decodeValue = function(pos, bin) {
    const type = bin[pos[0] ++];
    // null.
    if(type == TYPE_NULL) {
        return null;
    // number型.
    } else if(isMaskNumber(type)) {
        return decodeNumberByType(pos, type, bin);
    // string型.
    } else if(isMaskString(type)) {
        return decodeStringOrKeyByType(pos, type, bin);
    // date型.
    } else if(type == TYPE_DATE) {
        let tm = decodeLong(pos, bin);
        return new Date(tm);
    // calendar型.
    } else if(type == TYPE_CALENDAR) {
        return decodeCalendar(pos, bin);
    // time型.
    } else if(type == TYPE_TIME) {
        return decodeTime(pos, bin);
    // timestamp型.
    } else if(type == TYPE_TIMESTAMP) {
        return decodeTimestamp(pos, bin);
    // boolean型.
    } else if(type == TYPE_BOOLEAN) {
        return decodeBoolean(pos, bin);
    // array型.
    } else if(type == TYPE_ARRAY) {
        return decodeArray(pos, bin);
    // object型.
    } else if(type == TYPE_OBJECT) {
        return decodeObject(pos, bin);
    // 当てはまらない情報.
    } else {
        throw new Error(
            "Conversion type mismatch: 0x" +
            type.toString(16));
    }
}
// 外部定義.
exports.decodeValue = decodeValue;

})();
