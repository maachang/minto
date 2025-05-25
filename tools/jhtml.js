//////////////////////////////////////////////////////////
// jhtml.js
// jhtml = javascript html template.
// jhtmlファイルを mt.js ファイルに変換する.
//
// - jhtml組み込みタグ説明.
//   <% ... %>
//     基本的な組み込みタグ情報
//   <%= ... %>
//     実行結果をhtmlとして出力する組み込みタグ.
//   <%# ... %>
//     コメント用の組み込みタグ.
//   ${ ... }
//     実行結果をテンプレートとして出力する組み込みタグ.
//     <%= ... %> これと内容は同じ.
//     ただ利用推奨としては、変数出力時に利用する.
//
// - jhtml組み込み機能.
//   $out = function(string)
//     stringをhtmlとして出力するFunction.
//     戻り値が$outのfunctionなので
//     > $out("abc")(def) ... 的に実装が出来る.
//   $request = object
//     リクエストオブジェクトが利用できる.
//   $response = object
//     レスポンスオブジェクトが利用できる.
//////////////////////////////////////////////////////////
(function () {
    'use strict';

    // [デフォルト]jhtml出力メソッド名.
    const _OUT = "$out";

    // jhtml拡張子.
    const _EXTENSION = ".mt.html";

    // jhtmlをjs変換後の拡張子.
    const JHTML_JS = ".jhtml.js";

    // クォーテーションに対するインデントの増減を行う.
    // string 対象の文字列を設定します.
    // dc [true]の場合は["], [false]の場合は['].
    // 戻り値: 変換された内容が返却されます.
    const indentQuote = function (string, dc) {
        const len = string.length;
        if (len <= 0) {
            return string;
        }
        const target = (dc) ? '\"' : '\'';
        let c, j, yenLen, buf;
        yenLen = 0;
        buf = "";
        for (let i = 0; i < len; i++) {
            if ((c = string[i]) == target) {
                if (yenLen > 0) {
                    yenLen <<= 1;
                    for (j = 0; j < yenLen; j++) {
                        buf += "\\";
                    }
                    yenLen = 0;
                }
                buf += "\\" + target;
            } else if ('\\' == c) {
                yenLen++;
            } else {
                if (yenLen != 0) {
                    for (j = 0; j < yenLen; j++) {
                        buf += "\\";
                    }
                    yenLen = 0;
                }
                buf += c;
            }
        }
        if (yenLen != 0) {
            for (j = 0; j < yenLen; j++) {
                buf += "\\";
            }
        }
        return buf;
    }

    // 改行に対するインデントの増減を行う.
    // string 対象の文字列を設定します.
    // 戻り値: 変換された内容が返却されます.
    const indentEnter = function (s) {
        const len = s.length;
        if (len <= 0) {
            return s;
        }
        let c, ret;
        ret = "";
        for (let i = 0; i < len; i++) {
            if ((c = s[i]) == "\n") {
                ret += "\\n";
            } else {
                ret += c;
            }
        }
        return ret;
    }

    // ${ ... } を <% ... %>変換する.
    // jhtml 変換対象のjhtml内容を設定します.
    // 戻り値: 変換された内容が返却されます.
    const analysis$braces = function (jhtml) {
        let ret = "";
        let c, qt, by, $pos, braces;
        by = false;
        $pos = -1;
        braces = 0;
        const len = jhtml.length;
        for (let i = 0; i < len; i++) {
            c = jhtml[i];

            // ${ 検出中
            if ($pos != -1) {
                // クォーテーション内.
                if (qt != undefined) {
                    // 今回の文字列が対象クォーテーション終端.
                    if (!by && qt == c) {
                        qt = undefined;
                    }
                    // クォーテーション開始.
                } else if (c == "\"" || c == "\'") {
                    qt = c;
                    // 波括弧開始.
                } else if (c == "{") {
                    braces++;
                    // 波括弧終了.
                } else if (c == "}") {
                    braces--;
                    // 波括弧が終わった場合.
                    if (braces == 0) {
                        // <%= ... %> に置き換える.
                        ret += "<%=" + jhtml.substring($pos + 2, i) + "%>";
                        $pos = -1;
                    }
                }
                // ${ ... }の開始位置を検出.
            } else if (c == "$" && i + 1 < len && jhtml[i + 1] == "{") {
                $pos = i;
                // それ以外.
            } else {
                ret += c;
            }
            // 円マークの場合.
            by = (c == "\\");
        }
        return ret;
    }

    // jhtmlを解析して実行可能なjs変換を行う.
    // jhtml 対象のjhtmlを設定します.
    // out jhtmlを出力するためのメソッド名を設定します.
    // 戻り値: 実行可能なjs形式の情報が返却されます.
    const analysisJHtml = function (jhtml, out) {
        let c, n, start, bef, ret;
        const len = jhtml.length;
        bef = 0;
        start = -1;
        ret = "";
        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if (start != -1) {
                if (c == "%" && i + 1 < len && jhtml[i + 1] == ">") {
                    if (ret.length != 0) {
                        ret += "\n";
                    }
                    n = jhtml.substring(bef, start);
                    n = indentEnter(n);
                    n = indentQuote(n, true);
                    // HTML部分を出力.
                    ret += out + "(\"" + n + "\");\n";
                    bef = i + 2;

                    // 実行処理部分を実装.
                    n = jhtml[start + 2];
                    if (n == "=") {
                        // 直接出力.
                        n = jhtml.substring(start + 3, i).trim();
                        if (n.endsWith(";")) {
                            n = n.substring(0, n.length - 1).trim();
                        }
                        ret += out + "(" + n + ");\n";
                    } else if (n == "#") {
                        // コメントなので、何もしない.
                    } else {
                        // 出力なしの実行部分.
                        ret += jhtml.substring(start + 2, i).trim() + "\n";
                    }
                    start = -1;
                }
            } else if (c == "<" && i + 1 < len && jhtml[i + 1] == "%") {
                start = i;
                i += 1;
            }
        }
        // のこりのHTML部分を出力.
        n = jhtml.substring(bef);
        n = indentEnter(n);
        n = indentQuote(n, true);
        // HTML部分を出力.
        ret += out + "(\"" + n + "\");\n";

        return ret;
    }

    // jhtmlをjsに変換.
    // jhtml 対象のjhtmlを設定します.
    // outFunc 出力関数名(function(string)) の名前を設定します.
    // noOut trueの場合、outメソッドを実行時に直接設定します.
    // 戻り値: 実行可能なjs形式の情報が返却されます.
    const convert = function (jhtml, outFunc, noOut) {
        if (outFunc == undefined) {
            outFunc = _OUT;
        }
        // jhtmlから js 変換.
        let ret = analysisJHtml(analysis$braces(jhtml), outFunc);
        // outメソッドが実行時に設定しない場合.
        if (noOut != true) {
            // メモリ上にoutメソッドを出力する形で設定します.
            ret = "exports.handler = async function() {\n" +
                "let _$outString = \"\";\n" +
                "const " + outFunc + " = function(n) { _$outString += n; };\n" +
                ret +
                "\nreturn _$outString;\n" +
                "}\n";
        }
        return ret;
    }

    // jhtml拡張子かチェック.
    // name ファイル名を設定します.
    // 戻り値: trueの場合は拡張子がjhtmlです.
    const isExtension = function (name) {
        return name.endsWith(_EXTENSION);
    }

    // jhtml拡張子をjs拡張子に変換.
    const changeExtensionByJhtmlToJs = function (name) {
        if (name.endsWith(_EXTENSION)) {
            return name.substring(
                0, name.length - _EXTENSION.length)
                + JHTML_JS;
        }
        throw new Error(
            "The specified extension is not a jhtml extension: "
            + name);
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.convert = convert;
    exports.isExtension = isExtension;
    exports.changeExtensionByJhtmlToJs = changeExtensionByJhtmlToJs;

})();