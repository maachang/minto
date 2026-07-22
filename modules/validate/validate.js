///////////////////////////////////////////////
// 汎用オブジェクトバリデーター.
//
// $request().params() で取得したリクエストパラメータに限らず、
// 任意のJSオブジェクトを対象に、フィールド単位のスキーマ定義に
// 沿って検証する. 型システムは modules/s3table/s3MasterTable.js /
// s3IndexTable.js と共通の string/int/float/boolean/date の
// 5種類のみをサポートする(json/array/ネストオブジェクトは対象外).
//
// GETリクエストの$request().params()(=queryStringParameters)は値が
// 全て文字列で渡ってくるため、int/floatは数値型に加えて「数字として
// 妥当な文字列」(例: "20", "-1.5")も型チェックOKとする(値そのものは
// 文字列のまま保持し、数値へは変換しない。min/maxの範囲比較のみ内部で
// 数値化して行う)。boolean/dateは文字列を許容しない(true/falseや日付
// 文字列の解釈は曖昧さがあるため、呼び出し側で事前にBoolean/Dateへ
// 変換すること)。
//
// スキーマ定義例:
//   validate.check(data, {
//     name: { type: "string", required: true, minLen: 1, maxLen: 50,
//             messages: { required: "名前は必須です" } },
//     age:  { type: "int", min: 0, max: 150 }
//   });
//
// 戻り値: { valid, errors: [{field, rule, message}], data }
//   - dataはdefault値を補完したオブジェクト(元のdataは変更しない).
//   - スキーマに定義の無いプロパティはチェック対象外で、そのまま
//     dataに素通りする(strictチェックは行わない).
//   - 1フィールドにつき最初に失敗したルールのみをerrorsに積む
//     (同一フィールドで複数エラーは重ねない).
///////////////////////////////////////////////
(function () {
    'use strict';

    // デフォルトエラーメッセージ生成.
    // rule 対象のルール名を設定します.
    // field 対象のフィールド名を設定します.
    // params ルールに応じた付加情報(min/max/minLen/maxLen等)を設定します.
    const _defaultMessage = function (rule, field, params) {
        switch (rule) {
            case "required":
                return field + "は必須です";
            case "type":
                return field + "の型が不正です";
            case "minLen":
                return field + "は" + params.minLen + "文字以上で入力してください";
            case "maxLen":
                return field + "は" + params.maxLen + "文字以内で入力してください";
            case "min":
                return field + "は" + params.min + "以上で入力してください";
            case "max":
                return field + "は" + params.max + "以下で入力してください";
            case "pattern":
                return field + "の形式が不正です";
            case "enum":
                return field + "は許可された値ではありません";
            case "custom":
                return field + "の値が不正です";
            default:
                return field + "が不正です";
        }
    };

    // 文字列が整数表記(符号+数字のみ)かチェック.
    const _isIntString = function (s) {
        return /^-?[0-9]+$/.test(s);
    };

    // 文字列が数値表記(整数/小数)かチェック.
    const _isFloatString = function (s) {
        return s.trim() !== "" && isFinite(Number(s));
    };

    // 値の型チェック.
    // $request().params()のGETパラメータ(queryStringParameters)はJSの
    // 型を持たず全て文字列で渡ってくるため、int/floatは数値型に加えて
    // 「数字として妥当な文字列」も許容する(値そのものは文字列のまま扱い、
    // 数値へは変換しない。変換無しで済むよう_numeric側で比較時のみ数値化する).
    // type スキーマで指定された型名を設定します.
    // value 検証対象の値を設定します.
    // 戻り値: 型が一致する場合true.
    const _checkType = function (type, value) {
        switch (type) {
            case "string":
                return typeof value === "string";
            case "int":
                return (typeof value === "number" && Number.isInteger(value)) ||
                    (typeof value === "string" && _isIntString(value));
            case "float":
                return (typeof value === "number" && isFinite(value)) ||
                    (typeof value === "string" && _isFloatString(value));
            case "boolean":
                return typeof value === "boolean";
            case "date":
                return value instanceof Date && !isNaN(value.getTime());
            default:
                throw new Error("Unknown type: " + type);
        }
    };

    // min/max比較用に値を数値化(date型はgetTime()、数字文字列はNumber化、
    // それ以外はそのまま).
    const _numeric = function (value) {
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof value === "string" && _isFloatString(value)) {
            return Number(value);
        }
        return value;
    };

    // 1フィールド分の検証を実施.
    // field フィールド名を設定します.
    // rule スキーマ定義({type, required, default, minLen, maxLen,
    //      min, max, pattern, enum, custom, messages})を設定します.
    // value 検証対象の値(dataからの取得値)を設定します.
    // hasValue dataにこのフィールドのキー自体が存在するかを設定します.
    // data 検証対象のオブジェクト全体を設定します(rule.customへ
    //      フィールド間の相関チェック用に渡すため).
    // 戻り値: { error: {field, rule, message} または null, value: 補完後の値 }
    const _checkField = function (field, rule, value, hasValue, data) {
        const messages = rule.messages || {};

        const makeError = function (ruleName, params) {
            const message = messages[ruleName] != undefined ?
                messages[ruleName] : _defaultMessage(ruleName, field, params || {});
            return { field: field, rule: ruleName, message: message };
        };

        // 値が存在しない(undefined/null)場合.
        if (!hasValue || value === undefined || value === null) {
            if (rule.required == true) {
                return { error: makeError("required"), value: value };
            }
            // defaultが定義されている場合は補完する(以降の検証は行わない).
            if (rule.default !== undefined) {
                const def = typeof rule.default === "function" ?
                    rule.default() : rule.default;
                return { error: null, value: def };
            }
            // 未設定かつrequiredでもdefaultでも無い場合はそのまま許容.
            return { error: null, value: value };
        }

        // 型チェック.
        if (rule.type != undefined && !_checkType(rule.type, value)) {
            return { error: makeError("type"), value: value };
        }

        // 文字列長チェック.
        if (rule.type === "string") {
            if (rule.minLen != undefined && value.length < rule.minLen) {
                return { error: makeError("minLen", { minLen: rule.minLen }), value: value };
            }
            if (rule.maxLen != undefined && value.length > rule.maxLen) {
                return { error: makeError("maxLen", { maxLen: rule.maxLen }), value: value };
            }
        }

        // 数値/日付の範囲チェック.
        if (rule.type === "int" || rule.type === "float" || rule.type === "date") {
            const n = _numeric(value);
            if (rule.min != undefined && n < _numeric(rule.min)) {
                return { error: makeError("min", { min: rule.min }), value: value };
            }
            if (rule.max != undefined && n > _numeric(rule.max)) {
                return { error: makeError("max", { max: rule.max }), value: value };
            }
        }

        // 正規表現チェック(string限定).
        if (rule.type === "string" && rule.pattern != undefined) {
            if (!rule.pattern.test(value)) {
                return { error: makeError("pattern"), value: value };
            }
        }

        // enumチェック.
        if (rule.enum != undefined && rule.enum.indexOf(value) === -1) {
            return { error: makeError("enum"), value: value };
        }

        // カスタム検証.
        // rule.custom(value, data) が false を返した場合エラー、
        // 文字列を返した場合はそれをそのままメッセージとして採用する.
        if (typeof rule.custom === "function") {
            const customRet = rule.custom(value, data);
            if (customRet === false) {
                return { error: makeError("custom"), value: value };
            }
            if (typeof customRet === "string") {
                return { error: { field: field, rule: "custom", message: customRet }, value: value };
            }
        }

        return { error: null, value: value };
    };

    // dataをschemaに従って検証する.
    // data 検証対象のJSオブジェクトを設定します.
    // schema { フィールド名: ルール定義 } のオブジェクトを設定します.
    // 戻り値: { valid, errors: [{field, rule, message}], data }
    //         data はdefault値を補完したオブジェクト(元のdataは変更しない).
    exports.check = function (data, schema) {
        if (data == undefined || data == null) {
            data = {};
        }
        const result = Object.assign({}, data);
        const errors = [];
        for (let field in schema) {
            const hasValue = Object.prototype.hasOwnProperty.call(data, field);
            const ret = _checkField(field, schema[field], data[field], hasValue, data);
            if (ret.error != null) {
                errors.push(ret.error);
            } else {
                result[field] = ret.value;
            }
        }
        return {
            valid: errors.length === 0,
            errors: errors,
            data: result
        };
    };
})();
