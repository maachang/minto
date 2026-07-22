// 携帯２段階認証用.
// 携帯電話番号のSMSを使って認証コードを送付して、
// この値を２段階認証として利用します.
//
// この内容を利用する流れの想定として以下の感じです.
//  1. user / passwordでログインを行う.
//  2. 二段階認証画面を表示
//  2.1. 二段階認証用QRコードが表示される
//  2.2. 二段階認証コード入力枠が表示される
//  2.3. 初回ログイン時に登録したスマホで2.1のQRコードを読み取る.
//  2.4. 2.3でスマホで表示されたコードを2.2に入力
//  2.5. 2.4の入力が終わったら、確認ボタンを押下する.
//  3. 2.5. が成功した場合はログイン完了.
//
// また、LFUの二段階認証ではパスワード初回ログイン時において、
// スマホに二段階認証のための登録を行う必要があり、これについて
// 以下より流れを説明する.
//  1. user / passwordでログインを行う.
//  2. 初回ログイン時において、新しい二段階認証用のためのスマホ登録
//     を行うためのQRコードが表示されるので、スマホで読み取る
//  3. スマホでの読み取りが完了すると SUCCESS と出るのでこれで終わり
//  4. その後に本パスワード入力を行い登録ボタンを押下する.
//
// このような形により登録が完了となる.
//
(function() {
'use strict'

/**
mfa 先のURLは、以下の `@public/js/raw.githubusercontent.js` を使ってQRコードを利用すれば
jsでスマホでの二段階認証ができる.
(理由としてgithubからの raw.githubusercontent.com アクセスだと mimetype が text/plainが
レスポンス返却されるので、これを回避するためのjs.)
<html>
<head>
...
<script type="text/javascript"
  src="@public/js/raw.githubusercontent.js?src=davidshimjs/qrcodejs/master/qrcode.min.js">
</script>
</head>
<body>
...

<script>
var qrcode = new QRCode(document.getElementById("$id"), {
   text: "$qrcode-text",
   width: 128,
   height: 128,
   colorDark : "#ffffff",
   colorLight : "#000000",
   correctLevel : QRCode.CorrectLevel.H
})
</script>
**/

// crypto.
const crypto = $require("crypto")

// xor128ランダム.
const xor128 =  function (seed) {
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

    // ランダムバイナリを指定数取得.
    const getBytes = function (len) {
        const ret = Buffer.alloc(len);
        let n, i, cnt = 0;
        const len4 = len >> 2;
        const lenEtc = len & 0x03;
        for (i = 0; i < len4; i++) {
            n = next();
            ret[cnt++] = n & 0x0ff;
            ret[cnt++] = (n & 0x0ff00) >> 8;
            ret[cnt++] = (n & 0x0ff0000) >> 16;
            ret[cnt++] = ((n & 0xff000000) >> 24) & 0x0ff;
        }
        for (i = 0; i < lenEtc; i++) {
            ret[cnt++] = next() & 0x0ff;
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
        getBytes,
    };
};

// updateTimeに対する現在時間の値を取得.
// updateTime 認証コードの更新タイミングを秒で指定します.
// 戻り値: 現在時間に対して、一定条件で区切られた現在時間(ミリ秒)が
//        返却されます.
const nowTiming = function(updateTime) {
    updateTime = parseInt(updateTime);
    const ret = parseInt((Date.now() / 1000) / updateTime);
    return ret * updateTime;
}

// sha256.
const sha256 = function(value) {
    return crypto.createHash('sha256')
        .update(value).digest("hex");
}

// hmacSHA256.
const hmacSHA256 = function(key, message) {
    return crypto.createHmac('sha256', key)
        .update(message).digest("hex");
}

// user, key1, key2 を計算して64bit数字変換.
// keyCode mfa固有のkeyCodeを設定します.
// user ユーザー名を設定します.
// key1 固有のkey1条件(たとえばドメイン名)を設定します.
// key2 固有のkey2条件(たとえばMFA先携帯電話番号や固有番号)を設定します.
// 戻り値: 64bit数字が返却されます.
const userAndKey1_2ToLong = function(keyCode, user, key1, key2) {
    // sha256化.
    keyCode = sha256(keyCode);
    user = sha256(user);
    key1 = sha256(key1);
    key2 = sha256(key2);
    // code生成.
    let code = hmacSHA256(user, key2);
    code = hmacSHA256(code, key1);
    code = hmacSHA256(code, keyCode);
    // 最後の14文字を数字変換.
    return parseInt(code.substring(64 - 14), 16);
}

// 指定数字を文字列に変換してlen以下の場合、ヘッダに0を穴埋め.
// code 対象数字を設定します.
// len 指定長を設定します.
// 戻り値: 文字列が返却されます.
const appendHeadZero = function(code, len) {
    code = "" + code;
    if(code.length >= len) {
        return code;
    }
    len = len - code.length;
    let zero = "";
    for(let i = 0; i < len; i ++) {
        zero += "0";
    }
    return zero + code;
}

// 1つのシグニチャコードを生成.
// mfaLen 長さを設定します.
// time　タイミング値を設定します.
// src 主コードを設定します.
// 戻り値: シグニチャコードが数字の文字列でmfaLenの長さで返却されます.
const createSignatureCode = function(mfaLen, time, src) {
    // xor128乱数発生装置を利用.
    const r = xor128(time);
    // 最大16回乱数生成をループ.
    let i, n, nn, len;
    len = (src - time) & 0x0f;
    for(i = 0; i < len; i ++) {
        r.next();
    }
    // 指定数の数字文字列を生成.
    let ret = "";
    mfaLen = mfaLen & 0x7fffffff;
    if((mfaLen & 0x01) != 0) {
        len = mfaLen - 1;
    } else {
        len = mfaLen;
    }
    // シグニチャコードを生成(2文字)
    for(i = 0; i < len; i +=2) {
        nn = r.next();
        n = (i & 0x01) == 1 ?
            src - nn+1 : (~src) - nn;
        src = (i & 0x01) == 1 ?
            src + (~(nn+1)) : src - nn;
        n = (n & 0x7fffffff);
        ret += "" + ((n % 10)|0);
        ret += "" + (((n / 100) % 10)|0);
    }
    // 残りのシグニチャコード生成が必要な場合.
    if((mfaLen & 0x01) != 0) {
        // シグニチャコードを生成(1文字)
        ret += "" + (((r.next() & 0x7fffffff) % 10)|0);
    }
    // 対象シグニチャーコードの文字列長がmfaLen以下の場合
    // 先頭に0埋めを行う.
    return appendHeadZero(ret, mfaLen);
}

// ランダムコードを生成.
// count 生成桁数を設定します.
//       桁数が数字じゃない場合はデフォルト値が設定されます.
//       設定値が 8 以下の場合は 8 が設定されます.
// 戻り値: ランダムなコードが文字列で返却されます.
const generateRandomCode = function(count) {
    if(typeof(count) != "number") {
        count = 24;
    } else if(count <= 8) {
        count = 8;
    }
    const r = xor128(process.hrtime()[1]);
    const n = r.getBytes(count);
    return n.toString('base64').substring(0, count);
}

// ２段階認証コードを生成.
// outNextTime 次の更新時間(ミリ秒)がArray(2)に返却されます.
//             [0] 次の更新残り時間.
//             [1] 最大更新時間.
// keyCode mfa固有のkeyCodeを設定します.
// user ユーザー名を設定します.
// key1 固有のkey1条件(たとえばドメイン名)を設定します.
// key2 固有のkey2条件(たとえばMFA先携帯電話番号)を設定します.
// mfaLen 生成する２段階認証コード長を設定します.
// updateTime 生成更新されるタイミング(秒)を設定します.
// 戻り値: 二段階認証コードがArray(3)で返却されます.
//        [0]は、生成更新タイミングより１つ前のコードです.
//        [1]は、生成更新タイミングのコードです.
//        [2]は、生成更新タイミングより１つ後のコードです.
//        通常２段階認証をする場合は[1]を返却します.
const create = function(
    outNextTime, keyCode, user, key1, key2, mfaLen, updateTime) {
    keyCode = "" + keyCode;
    user = "" + user;
    key1 = "" + key1;
    key2 = "" + key2;
    mfaLen = parseInt(mfaLen)
    updateTime = parseInt(updateTime);
    // 引数チェック.
    if(isNaN(mfaLen) || mfaLen <= 0) {
        throw new Error(
            "The number of number frames is 0 or less.");
    } else if(isNaN(updateTime) || updateTime <= 0) {
        throw new Error(
            "The generation update timing second is 0 or less.");
    } else if(keyCode == "") {
        throw new Error(
            "The target keyCode has not been set.");
    } else if(user == "") {
        throw new Error("The user name has not been set.");
    } else if(key1 == "") {
        throw new Error(
            "The target key1 has not been set.");
    } else if(key2 == "") {
        throw new Error(
            "The target key2 has not been set.");
    }
    // updateTimeに対する現在時間の値を取得.
    const now = nowTiming(updateTime);
    // 更新残り時間を取得.
    if(Array.isArray(outNextTime)) {
        outNextTime[0] = 
            (updateTime * 1000) - (Date.now() - (now * 1000));
        outNextTime[1] = updateTime * 1000;
    }
    // user, key1, key2を数値化.
    const code = userAndKey1_2ToLong(keyCode, user, key1, key2);
    // before, now, nextの２段階認証コードを返却.
    return [
        createSignatureCode(mfaLen, now - updateTime, code)
        ,createSignatureCode(mfaLen, now, code)
        ,createSignatureCode(mfaLen, now + updateTime, code)
    ];
}

////////////////////////////////////////////////////////////////
// 外部定義.
////////////////////////////////////////////////////////////////
exports.generateRandomCode = generateRandomCode;
exports.create = create;

})();
