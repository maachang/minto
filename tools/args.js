////////////////////////////////////////////////
// nodejs 起動パラメータ解釈.
////////////////////////////////////////////////
(function () {
    'use strict';

    // 数値チェック.
    // num : チェック対象の情報を設定します.
    // 戻り値 : [true]の場合、文字列情報です.
    const isNumeric = (function () {
        const _IS_NUMERIC_REG = /[^0-9.0-9]/g;
        return function (num) {
            let n = "" + num;
            if (num == null || num == undefined) {
                return false;
            } else if (typeof (num) == "number") {
                return true;
            } else if (n.indexOf("-") == 0) {
                n = n.substring(1);
            }
            return !(n.length == 0 || n.match(_IS_NUMERIC_REG))
                && !(targetCharCount(0, n, ".") > 1);
        }
    })();

    // 0x0d, 0x0d が終端に設定されている場合削除.
    // 何故かnodejsの実行パラメータで取得すると、一番最後の内容に
    // 対して 0x0d 0x0d がセットされて、対象文字列しとして認識されない
    // ことがあったなのでこの処理を行うようにした.
    // ※どうやらLinux上でcrlf改行のbashファイルから呼び出した場合
    //   プロセスパラメータ(process.argv)の最後0x0d, 0x0dが入る
    //   みたい.
    // pms 対象のパラメータを設定します.
    // 戻り値: 変換内容が返却されます.
    const cut0x0d0x0d = function (pms) {
        let bpms = Buffer.from(pms);
        if (bpms.length >= 2 &&
            bpms[bpms.length - 1] == 0x0d && bpms[bpms.length - 2] == 0x0d) {
            pms = pms.substring(0, pms.length - 2);
        }
        bpms = null;
        return pms;
    }

    // 初期処理.
    const init = function () {
        const list = process.argv;
        const pms = [];
        const len = list.length;
        for (var i = 1; i < len; i++) {
            pms[i] = cut0x0d0x0d(list[i]).trim();
        }
        return pms;
    }

    // 起動パラメータ情報をセット.
    const args = init();

    // 戻り値.
    const o = {};

    // 指定ヘッダ名を設定して、要素を取得します.
    // get("-y", "--yes")
    //   -y xxxx or --yes xxxx のxxxxの条件を取得します.
    // 戻り値: 文字列が返却されます.
    o.get = function () {
        if (arguments == null) {
            return null;
        }
        const len = arguments.length;
        const params = [0]; // next(0, ...);
        for (let i = 0; i < len; i++) {
            params[i + 1] = arguments[i];
        }
        return o.next.apply(null, params);
    }

    // 指定ヘッダ名を設定して、要素を取得します.
    // 引数条件はgetと同じです.
    // 戻り値: 数字が返却されます.
    o.getNumber = function () {
        const v = o.get.apply(null, arguments);
        if (v == null) {
            return null;
        }
        return parseFloat(v);
    }

    // 指定ヘッダ名を設定して、要素を取得します.
    // 引数条件はgetと同じです.
    // 戻り値: Booleanが返却されます.
    o.getBoolean = function () {
        let v = o.get.apply(null, arguments);
        if (v == null) {
            return false;
        }
        v = v.trim().toLowerCase();
        if (v == "true" || v == "on") {
            return true;
        }
        return false;
    }


    // 番号指定での指定ヘッダ名を指定した要素取得処理.
    // たとえば
    // > -i abc -i def -i xyz
    //
    // このような情報が定義されてる場合にたとえば
    // next(0, "-i") なら "abc" が返却され
    // next(1, "-i") なら "def" が返却され
    // next(2, "-i") なら "xyz" が返却されます.
    //
    // 戻り値: 文字列が返却されます.
    o.next = function () {
        if (arguments == null) {
            return null;
        }
        const no = arguments[0];
        // next(0, ...)なので、実際の引数の長さを-1する.
        const len = arguments.length - 1;
        // 数字で直接指定している場合.
        if (len == 1 && isNumeric(arguments[1])) {
            const pos = arguments[1] | 0;
            if (pos >= 0 && pos < args.length) {
                // args[0] = undefined
                // args[1] = node xxx.js だと xxx.js が格納される.
                // なので、開始位置を+2する.
                return args[pos + 2];
            }
            return null;
        }
        let i, j;
        let cnt = 0;
        const lenJ = args.length - 1;
        for (i = 0; i < len; i++) {
            for (j = 2; j < lenJ; j++) {
                if (arguments[i + 1] == args[j]) {
                    if (no <= cnt) {
                        return args[j + 1];
                    }
                    cnt++;
                }
            }
        }
        return null;
    }

    // 指定ヘッダ名を設定して、要素を取得します.
    // 引数条件はnextと同じです.
    // 戻り値: 数字が返却されます.
    o.nextNumber = function () {
        const v = o.next.apply(null, arguments);
        if (v == null) {
            return -1;
        }
        return parseFloat(v);
    }

    // 指定ヘッダ名を設定して、要素を取得します.
    // 引数条件はnextと同じです.
    // 戻り値: Booleanが返却されます.
    o.nextBoolean = function () {
        let v = o.next.apply(null, arguments);
        if (v == null) {
            return false;
        }
        v = v.trim().toLowerCase();
        if (v == "true" || v == "on") {
            return true;
        }
        return false;
    }

    // 番号指定での指定ヘッダ名を指定した要素取得処理.
    // たとえば
    // > -i abc -i def -i xyz
    // この場合 ["abc", "xyz"] = getArray("-i"); が返却されます.
    // names 対象のヘッダ名を設定します.
    // 戻り値: Array型が返却されます.
    o.getArray = function () {
        const ret = [];
        const args = [0];
        const len = arguments.length;
        for (let i = 0; i < len; i++) {
            args[args.length] = arguments[i];
        }
        for (let i = 0; ; i++) {
            args[0] = i;
            const v = o.next.apply(null, args);
            if (v == null) {
                return ret;
            }
            ret[ret.length] = v;
        }
    }

    // 指定起動パラメータ名を指定して、存在するかチェックします.
    // names 対象のヘッダ名を設定します.
    // 戻り値: 存在する場合 true.
    o.isValue = function () {
        if (arguments == null) {
            return false;
        }
        let i, j, no;
        const len = arguments.length;
        const lenJ = args.length;
        for (i = 0; i < len; i++) {
            if (isNumeric(arguments[i])) {
                no = arguments[i] | 0;
                if (no >= 0 && no < args.length) {
                    return true;
                }
            } else {
                for (j = 0; j < lenJ; j++) {
                    if (arguments[i] == args[j]) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // 最初の起動パラメータを取得.
    // 戻り値 最初の起動パラメータが返却されます.
    o.getFirst = function () {
        if (args.length == 0) {
            return "";
        }
        return args[0];
    }

    // 最後の起動パラメータを取得.
    // 戻り値 最後の起動パラメータが返却されます.
    o.getLast = function () {
        if (args.length == 0) {
            return "";
        }
        return args[args.length - 1];
    }

    // 起動パラメータ数を取得.
    // 戻り値: 起動パラメータ数が返却されます.
    o.length = function () {
        return args.length;
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    for (let k in o) {
        exports[k] = o[k];
    }

})();