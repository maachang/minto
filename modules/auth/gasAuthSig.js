//////////////////////////////////////////
// ログイン用のシグニチャーを作成.
//////////////////////////////////////////
(function() {
'use strict'

// convb.
const convb = $loadLib("convb.js");

// 乱数キー数.
const _RAND_LENGTH = 16;

// ランダムバイナリをout(Array)に格納.
const getRandArray = function (out, len) {
    let n, i, cnt = 0;
    const len4 = len >> 2;
    const lenEtc = len & 0x03;
    for (i = 0; i < len4; i++) {
        n = rand.next();
        out[cnt++] = n & 0x0ff;
        out[cnt++] = (n & 0x0ff00) >> 8;
        out[cnt++] = (n & 0x0ff0000) >> 16;
        out[cnt++] = ((n & 0xff000000) >> 24) & 0x0ff;
    }
    for (i = 0; i < lenEtc; i++) {
        out[cnt++] = rand.next() & 0x0ff;
    }
};

// ランダムバイナリを指定数取得.
const getRandBytes = function (len) {
    const ret = Buffer.alloc(len);
    getRandArray(ret, len);
    return ret;
};

// フリップ.
// 主にencode系で利用します.
// code 1byte情報を設定.
// step stepCode(1byte)を設定.
// 戻り値: 1byte情報が返却されます.
const _flip = function(code, step) {
    switch (step & 0x00000007) {
    case 1:
        return ((((code & 0x00000003) << 6) & 0x000000c0) | (((code & 0x000000fc) >> 2) & 0x0000003f)) & 0x000000ff;
    case 2:
        return ((((code & 0x0000003f) << 2) & 0x000000fc) | (((code & 0x000000c0) >> 6) & 0x00000003)) & 0x000000ff;
    case 3:
        return ((((code & 0x00000001) << 7) & 0x00000080) | (((code & 0x000000fe) >> 1) & 0x0000007f)) & 0x000000ff;
    case 4:
        return ((((code & 0x0000000f) << 4) & 0x000000f0) | (((code & 0x000000f0) >> 4) & 0x0000000f)) & 0x000000ff;
    case 5:
        return ((((code & 0x0000007f) << 1) & 0x000000fe) | (((code & 0x00000080) >> 7) & 0x00000001)) & 0x000000ff;
    case 6:
        return ((((code & 0x00000007) << 5) & 0x000000e0) | (((code & 0x000000f8) >> 3) & 0x0000001f)) & 0x000000ff;
    case 7:
        return ((((code & 0x0000001f) << 3) & 0x000000f8) | (((code & 0x000000e0) >> 5) & 0x00000007)) & 0x000000ff;
    }
    return code & 0x000000ff;
}

// notフリップ.
// 主にdecode系で利用します.
// code 1byte情報を設定.
// step stepCode(1byte)を設定.
// 戻り値: 1byte情報が返却されます.
const _nflip = function(code, step) {
    switch (step & 0x00000007) {
    case 1:
        return ((((code & 0x0000003f) << 2) & 0x000000fc) | (((code & 0x000000c0) >> 6) & 0x00000003)) & 0x000000ff;
    case 2:
        return ((((code & 0x00000003) << 6) & 0x000000c0) | (((code & 0x000000fc) >> 2) & 0x0000003f)) & 0x000000ff;
    case 3:
        return ((((code & 0x0000007f) << 1) & 0x000000fe) | (((code & 0x00000080) >> 7) & 0x00000001)) & 0x000000ff;
    case 4:
        return ((((code & 0x0000000f) << 4) & 0x000000f0) | (((code & 0x000000f0) >> 4) & 0x0000000f)) & 0x000000ff;
    case 5:
        return ((((code & 0x00000001) << 7) & 0x00000080) | (((code & 0x000000fe) >> 1) & 0x0000007f)) & 0x000000ff;
    case 6:
        return ((((code & 0x0000001f) << 3) & 0x000000f8) | (((code & 0x000000e0) >> 5) & 0x00000007)) & 0x000000ff;
    case 7:
        return ((((code & 0x00000007) << 5) & 0x000000e0) | (((code & 0x000000f8) >> 3) & 0x0000001f)) & 0x000000ff;
    }
    return code & 0x000000ff;
}

// ハッシュ計算.
// code 対象条件(文字列 or バイナリ)を設定します.
// 戻り値: 16byteのバイナリが返却されます.
const hash = function(code) {
    let o = null;
    const n = [0x8F1BBCDC, 0x5A827999, 0xCA62C1D6, 0x6ED9EBA];
    if(typeof(code) == "string") {
        code = Buffer.from(code);
    }
    const len = code.length;
    for(let i = 0; i < len; i ++) {
        o = (code[i] & 0x000000ff);
        if((o & 1) == 1) {
            o = _flip(o, o) & 0x0ff;
        } else {
            o = _nflip(o, o) & 0x0ff;
        }
        if((i & 1) == 1) {
            n[0] = n[0] + o;
            n[1] = n[1] - (o << 8);
            n[2] = n[2] + (o << 16);
            n[3] = n[3] - (o << 24);
            n[3] = n[3] ^ (o);
            n[2] = n[2] ^ (o << 8);
            n[1] = n[1] ^ (o << 16);
            n[0] = n[0] ^ (o << 24);
            n[0] = (n[3]+1) + (n[0]);
            n[1] = (n[2]-1) + (n[1]);
            n[2] = (n[1]+1) + (n[2]);
            n[3] = (n[0]-1) + (n[3]);
        } else {
            n[3] = n[3] + o;
            n[2] = n[2] - (o << 8);
            n[1] = n[1] + (o << 16);
            n[0] = n[0] - (o << 24);
            n[0] = n[0] ^ (o);
            n[1] = n[1] ^ (o << 8);
            n[2] = n[2] ^ (o << 16);
            n[3] = n[3] ^ (o << 24);
            n[0] = (n[3]+1) - (n[0]);
            n[1] = (n[2]-1) - (n[1]);
            n[2] = (n[1]+1) - (n[2]);
            n[3] = (n[0]-1) - (n[3]);
        }
        n[3] = (n[0]+1) ^ (~n[3]);
        n[2] = (n[1]-1) ^ (~n[2]);
        n[1] = (n[2]+1) ^ (~n[1]);
        n[0] = (n[3]-1) ^ (~n[0]);
    }
    // バイナリで返却.
    return [
        (n[0] & 0x000000ff),
        ((n[0] & 0x0000ff00) >> 8),
        ((n[0] & 0x00ff0000) >> 16),
        (((n[0] & 0xff000000) >> 24) & 0x00ff),
        (n[1] & 0x000000ff),
        ((n[1] & 0x0000ff00) >> 8),
        ((n[1] & 0x00ff0000) >> 16),
        (((n[1] & 0xff000000) >> 24) & 0x00ff),  
        (n[2] & 0x000000ff),
        ((n[2] & 0x0000ff00) >> 8),
        ((n[2] & 0x00ff0000) >> 16),
        (((n[2] & 0xff000000) >> 24) & 0x00ff),  
        (n[3] & 0x000000ff),
        ((n[3] & 0x0000ff00) >> 8),
        ((n[3] & 0x00ff0000) >> 16),
        (((n[3] & 0xff000000) >> 24) & 0x00ff)
    ]
}
exports.hash = hash;

// 配列コピー.
// s 元の配列を設定します.
// sp 元の配列オフセット値を設定します.
// d 先の配列を設定します.
// dp 先の配列オフセット値を設定します.
// len コピー長を設定します.
const arraycopy = function(s, sp, d, dp, len) {
    len = len|0;
    sp = sp|0;
    dp = dp|0;
    for(let i = 0 ; i < len ; i ++) {
        d[(dp+i)] = s[(sp+i)];
    }
}

// base64の最後の=を削除.
// code 対象のbase64文字列を設定.
// 戻り値 最後の=を除いた値が返却.
const cutEndBase64Eq = function(code) {
    const len = code.length;
    for(let i = len - 1; i >= 0; i --) {
        if(code[i] != "=") {
            return code.substring(0, i + 1);
        }
    }
    return "";
}
exports.cutEndBase64Eq = cutEndBase64Eq;

// outのバイナリ情報にvalue内容を追加.
// out 格納先のバイナリを設定します.
// value 追加対象のバイナリを設定します.
const addValue = function(out, value) {
    let p = out.length;
    const len = value.length;
    for(let i = 0; i < len; i ++) {
        out[p + i] = value[i];
    }
}

// 指定キーの項番を指定して、条件に応じたバイナリを返却.
// key 対象のキーを設定します.
// len 対象のキー長を設定します.
// no 対象の項番を設定します.
//    この値がlenを超えた場合は折り返します.
// 戻り値: 指定位置のバイナリを設定します.
const getKey = function(key, len, no) {
    return key[no % len];
}

// 対象のoutに対してkeyをエンコード.
// out エンコード元の情報を設定します.
// off エンコード元のオフセット値を設定します.
// key エンコード対象のキーを設定します.
const encodeValue = function(out, off, key) {
    const keyLen = key.length;
    const len = out.length;
    for(let i = off; i < len; i ++) {
        if(i & 1 == 0) {
            out[i] = (out[i] ^ _nflip(getKey(key, keyLen, i))) & 0x0ff;
        } else {
            out[i] = (out[i] ^ _flip(getKey(key, keyLen, i))) & 0x0ff;
        }
    }
}

// 対象のbinaryに対してkeyでデコード.
// binary デコード元の情報を設定します.
// off デコード元のオフセット値を設定します.
// len デコード元の長さを設定します.
// key デコード対象のキーを設定します.
const decodeValue = function(binary, off, len, key) {
    const keyLen = key.length;
    for(let i = off; i < len; i ++) {
        if(i & 1 == 0) {
            binary[i] = (binary[i] ^ _flip(getKey(key, keyLen, i))) & 0x0ff;
        } else {
            binary[i] = (binary[i] ^ _nflip(getKey(key, keyLen, i))) & 0x0ff;
        }
    }
}

// ステップコードを取得.
// list 対象のバイナリリストを設定しました.
// off 対象のオフセット値を設定します.
// len 対象の長さを設定します.
// 戻り値: ステップコードが返却されます.
const getStepCode = function(list, off, len) {
    let ret = 0x007f;
    // 先頭はstepCode格納なのでそれ以降で計算.
    for(let i = off; i < len; i ++) {
        if((i & 0x02) == 0) {
            ret += i ^ _flip(list[i], (i * 1.5)|0);
        } else {
            ret -= i ^ _nflip(list[i], (i * 2.5)|0);
        }
    }
    return ret & 0x00ff;
}

// yyyyMMdd-Expoire時間(date)を取得.
// plusDate 対象の加算するDateを設定します.
// 戻り値: 8byteの範囲内条件が返却されます.
const ymdDatePlus = function(plusDate) {
    return Date.now() + (plusDate * 86400000);
}

// パスコードを取得.
// user 対象のユーザー名を設定します.
// password 対象のパスワードを設定します.
// hash化されたBase64変換されます.
const getPassCode = function(user, password) {
    return cutEndBase64Eq(
        Buffer.from(hash(user + "\n" + password))
            .toString("base64"));
}
exports.getPassCode = getPassCode;

// 最大セッションID長.
const MAX_SESSION_ID_LENGTH = 86;

// デフォルトセッションID長.
const DEF_SESSION_ID_LENGTH = 24;

// セッションIDを生成.
// len セッションID長を設定します.
// 戻り値: セッションIDが返却されます.
const createSessionId = function(len) {
    len = len|0;
    if(len <= 0) {
        // 設定されていない、もしくはマイナス値.
        // デフォルトセット.
        len = DEF_SESSION_ID_LENGTH;
    }
    if(len > MAX_SESSION_ID_LENGTH) {
        throw new Error(
            "The specified session ID length exceeds " +
            "the maximum value (" +
                MAX_SESSION_ID_LENGTH + ").")
    }
    const ret = [];
    getRandArray(ret, len);
    ret[ret.length] = ret & 0x0ff;
    convb.encodeLong(ret, Date.now());
    return cutEndBase64Eq(
        Buffer.from(ret)
            .toString("base64"));
}
exports.createSessionId = createSessionId;

// 最大文字列長.
const MAX_STRING_LENGTH = 128;

// エンコード処理.
// keyCode 対象のキー情報を設定します.
// user 対象のユーザ名を設定します.
// passCode 対象のパスコードを設定します.
// sessionId 対象のセッションIDを設定します.
// expireDate expire値(日付)を設定します.
//            この設定条件が日付の理由はs3の最低削除時間が日付のため、
//            この値に合わせたものになります.
//            ミリ秒設定を行う場合は、ここは null を設定します.
// expireMs ミリ秒単位でExpire値を設定したい場合は設定します.
//          この場合は `expireDate=null` を設定します.
// 戻り値: Buffer情報(base64)が返却されます.
const encodeToken = function(
    keyCode, user, passCode, sessionId, expireDate, expireMs) {
    if(typeof(user) != "string") {
        throw new Error("User is not set.");
    } else if(typeof(passCode) != "string") {
        throw new Error("PassCode is not set.");
    } else if(typeof(sessionId) != "string") {
        throw new Error("SessionId is not set.");
    } else if(user.length > MAX_STRING_LENGTH) {
        throw new Error(
            "The length of the user exceeds the specified value.");
    } else if(sessionId.length > MAX_STRING_LENGTH) {
        throw new Error(
            "The length of the sessionId exceeds the specified value.");
    }
    // expire値(日付単位)が設定されていない場合.
    if(expireDate != null && (expireDate|0) <= 0) {
        expireDate = 1;
    }
    // keyをハッシュ計算する.
    const hashKeyCode = hash(keyCode);
    const list = [0, 0]; // [0]stepCode, [1]keyCodeStepCode.
    // passCodeを設定します.
    convb.encodeString(list, passCode);
    // ユーザー名を設定します.
    convb.encodeString(list, user);
    // セッションIDを設定します.
    convb.encodeString(list, sessionId);
    // パスワードとユーザ名をkey変換.
    encodeValue(list, 2, hashKeyCode);
    // expire条件(日時)をセット.
    if(expireDate != null) {
        // 日付.
        convb.encodeLong(list, ymdDatePlus(expireDate|0));
    } else {
        // ミリ秒.
        convb.encodeLong(list, (expireMs|0) + Date.now());
    }
    // ランダムなバイナリを取得.
    const randBin = getRandBytes(_RAND_LENGTH);
    // パスワードとユーザ名と日付をランダム変換.
    encodeValue(list, 2, randBin);
    // 乱数情報をセット.
    addValue(list, randBin);
    // stepCode変換.
    list[1] = getStepCode(hashKeyCode, 0, hashKeyCode.length);
    list[0] = getStepCode(list, 1, list.length);
    // 返却.
    return cutEndBase64Eq(Buffer.from(list).toString("base64"));
}
exports.encodeToken = encodeToken;

// 対象のトークンをデコード処理.
// keyCode 対象のキー情報を設定します.
// token デコード対象のトークンを設定します.
// 戻り値: {passCode: string, sessionId: string, user: string, expire: number}
//        passCode パスコードが返却されます.
//        sessionId セッションIDが返却されます.
//        user ログインユーザー名が返却されます.
//        expire expire値(ミリ秒が返却されます)
const decodeToken = function(keyCode, token) {
    // base64からBuffer変換.
    token = Buffer.from(token, "base64");

    // トークン長を取得.
    const tokenLen = token.length;

    // キーコードハッシュを取得.
    const keyCodeHash = hash(keyCode);

    // stepコードチェック.
    if(token[0] != getStepCode(token, 1, tokenLen) ||
        token[1] != getStepCode(keyCodeHash, 0, keyCodeHash.length)) {
        // 不一致の場合.
        throw new Error("The contents of the token are invalid.");
    }

    // 乱数を取得.
    let key = Buffer.alloc(_RAND_LENGTH);
    let pos = _RAND_LENGTH;
    arraycopy(token, tokenLen - pos, key, 0, _RAND_LENGTH);
    
    // 乱数でデコード.
    decodeValue(token, 2, tokenLen - pos, key);
    key = null;
    
    // expire日付を取得
    pos += 9; // プラス値のみ(マイナスの場合はエラーとなる)
    const oPos = [tokenLen - pos];
    const expire = convb.decodeLong(oPos, token);

    // hashKeyCodeでデコード.
    decodeValue(token, 2, tokenLen - pos, keyCodeHash);
    
    // パスコードを取得.
    oPos[0] = 2;
    let len = convb.decodeStringLength(oPos, token);
    if(len > MAX_STRING_LENGTH || len <= 0) {
        // 文字列長が一定を超えた場合は例外とする.
        throw new Error("The contents of the token are invalid.");
    }
    const passCode = convb.decodeString(oPos, token);

    // ユーザー名を取得.
    len = convb.decodeStringLength(oPos, token);
    if(len > MAX_STRING_LENGTH || len <= 0) {
        // 文字列長が一定を超えた場合は例外とする.
        throw new Error("The contents of the token are invalid.");
    }
    const user = convb.decodeString(oPos, token);

    // セッションIDを取得.
    len = convb.decodeStringLength(oPos, token);
    if(len > MAX_STRING_LENGTH || len <= 0) {
        // 文字列長が一定を超えた場合は例外とする.
        throw new Error("The contents of the token are invalid.");
    }
    const sessionId = convb.decodeString(oPos, token);

    // 戻り値.
    return {
        expire: expire,
        passCode: passCode,
        user: user,
        sessionId: sessionId
    };
}
exports.decodeToken = decodeToken;

})();
