//////////////////////////////////////////////////////////
// jhtml.js
// jhtml = javascript html template.
// jhtmlファイルを jhtml.js ファイルに変換する.
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
                // \${ の場合はリテラルとして扱う（エスケープ）.
            } else if (c == "$" && i + 1 < len && jhtml[i + 1] == "{") {
                if (by) {
                    // 直前がバックスラッシュなら、先に追加した '\' を除去して
                    // リテラル '${' として出力.
                    ret = ret.substring(0, ret.length - 1);
                    ret += "${";
                    i++; // '{' をスキップ.
                } else {
                    $pos = i;
                }
                // それ以外.
            } else {
                ret += c;
            }
            // バックスラッシュフラグ更新.
            by = (c == "\\");
        }
        // 閉じられていない ${ が残っている場合、そのまま出力する.
        if ($pos != -1) {
            ret += jhtml.substring($pos);
        }
        return ret;
    }

    // jhtml 対象のjhtmlを設定します.
    // out jhtmlを出力するためのメソッド名を設定します.
    // 戻り値: 実行可能なjs形式の情報が返却されます.
    const analysisJHtml = function (jhtml, out) {
        let c, n, start, bef, ret;
        const len = jhtml.length;
        bef = 0;
        start = -1;
        ret = "";

        // タグ内部のクォーテーション追跡用.
        let tagQt = undefined;  // 現在のクォーテーション文字（ " or ' or `）
        let tagBy = false;      // 直前がバックスラッシュかどうか

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if (start != -1) {
                // <% %> タグ内部の解析.

                // クォーテーション内の場合.
                if (tagQt != undefined) {
                    if (!tagBy && c == tagQt) {
                        // クォーテーション終端.
                        tagQt = undefined;
                    }
                    tagBy = (c == "\\");
                    continue;
                }

                // クォーテーション開始の検出.
                if (c == "\"" || c == "\'" || c == "\`") {
                    tagQt = c;
                    tagBy = false;
                    continue;
                }

                // %> の検出（クォーテーション外でのみ有効）.
                if (c == "%" && i + 1 < len && jhtml[i + 1] == ">") {
                    // HTML部分を出力（空でなければ）.
                    n = jhtml.substring(bef, start);
                    if (n.length > 0) {
                        if (ret.length != 0) {
                            ret += "\n";
                        }
                        n = indentEnter(n);
                        n = indentQuote(n, true);
                        ret += out + "(\"" + n + "\");\n";
                    }
                    bef = i + 2;

                    // 実行処理部分を実装.
                    n = jhtml[start + 2];
                    if (n == "=") {
                        // 直接出力.
                        n = jhtml.substring(start + 3, i).trim();
                        if (n.endsWith(";")) {
                            n = n.substring(0, n.length - 1).trim();
                        }
                        if (ret.length != 0) {
                            ret += "\n";
                        }
                        ret += out + "(" + n + ");\n";
                    } else if (n == "#") {
                        // コメントなので、何もしない.
                    } else {
                        // 出力なしの実行部分.
                        if (ret.length != 0) {
                            ret += "\n";
                        }
                        ret += jhtml.substring(start + 2, i).trim() + "\n";
                    }
                    start = -1;
                    tagQt = undefined;
                    tagBy = false;
                    i++; // '>' をスキップ.
                }
            } else if (c == "<" && i + 1 < len && jhtml[i + 1] == "%") {
                start = i;
                i += 1;
            }
        }

        // 残りのHTML部分を出力（空でなければ）.
        n = jhtml.substring(bef);
        if (n.length > 0) {
            n = indentEnter(n);
            n = indentQuote(n, true);
            if (ret.length != 0) {
                ret += "\n";
            }
            ret += out + "(\"" + n + "\");\n";
        }

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