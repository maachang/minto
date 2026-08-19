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
            case "range":
                return field + "は" + params.min + "〜" + params.max + "の範囲で入力してください";
            case "mail":
                return field + "はメールアドレスの形式で入力してください";
            case "url":
                return field + "はURLの形式で入力してください";
            case "zip":
                return field + "は郵便番号の形式で入力してください";
            case "tel":
                return field + "は電話番号の形式で入力してください";
            case "date":
                return field + "は日付の形式で入力してください";
            case "time":
                return field + "は時間の形式で入力してください";
            case "alphaNum":
                return field + "は半角英数字で入力してください";
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

    // 組み込み検証用正規表現パターン.
    const _PATTERNS = {
        // メールアドレス (簡易チェック: @ の前後に文字、ドメイン部にドットを含む)
        mail: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
        // URL (http:// または https:// から始まる)
        url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
        // 郵便番号 (7桁数字、ハイフンあり 123-4567 またはなし 1234567)
        zip: /^\d{3}-?\d{4}$/,
        // 電話番号 (固定電話・携帯電話・フリーダイヤル等のハイフンあり/なし)
        tel: /^(0\d{1,4}-?\d{1,4}-?\d{3,4}|0[789]0-?\d{4}-?\d{4}|0120-?\d{3}-?\d{3}|0800-?\d{3}-?\d{3}|050-?\d{4}-?\d{4})$/,
        // 日付 (yyyy-MM-dd または yyyy/MM/dd)
        date: /^\d{4}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])$/,
        // 時間 (HH:mm または HH:mm:ss)
        time: /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
        // 半角英数字
        alphaNum: /^[a-zA-Z0-9]+$/
    };

    // 日付文字列としての妥当性チェック(閏年や各月の日数確認).
    const _isValidDateString = function (s) {
        if (!_PATTERNS.date.test(s)) {
            return false;
        }
        const parts = s.split(/[-/]/).map(Number);
        const y = parts[0];
        const m = parts[1];
        const d = parts[2];
        const date = new Date(y, m - 1, d);
        return date.getFullYear() === y && (date.getMonth() + 1) === m && date.getDate() === d;
    };

    // 1フィールド分の検証を実施.
    // field フィールド名を設定します.
    // rule スキーマ定義({type, required, default, minLen, maxLen,
    //      min, max, range, mail, url, zip, tel, date, time, alphaNum,
    //      pattern, enum, custom, messages})を設定します.
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
            if (rule.range != undefined) {
                const min = Array.isArray(rule.range) ? rule.range[0] : rule.range.min;
                const max = Array.isArray(rule.range) ? rule.range[1] : rule.range.max;
                if ((min != undefined && n < _numeric(min)) || (max != undefined && n > _numeric(max))) {
                    return { error: makeError("range", { min: min, max: max }), value: value };
                }
            }
        }

        // 組み込み形式チェック(string限定).
        if (rule.type === "string") {
            if (rule.mail === true && !_PATTERNS.mail.test(value)) {
                return { error: makeError("mail"), value: value };
            }
            if (rule.url === true && !_PATTERNS.url.test(value)) {
                return { error: makeError("url"), value: value };
            }
            if (rule.zip === true && !_PATTERNS.zip.test(value)) {
                return { error: makeError("zip"), value: value };
            }
            if (rule.tel === true && !_PATTERNS.tel.test(value)) {
                return { error: makeError("tel"), value: value };
            }
            if (rule.date === true && !_isValidDateString(value)) {
                return { error: makeError("date"), value: value };
            }
            if (rule.time === true && !_PATTERNS.time.test(value)) {
                return { error: makeError("time"), value: value };
            }
            if (rule.alphaNum === true && !_PATTERNS.alphaNum.test(value)) {
                return { error: makeError("alphaNum"), value: value };
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
