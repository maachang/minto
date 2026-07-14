// llrt実行対象コードの互換性チェック.
//
// llrt(https://github.com/awslabs/llrt) は node.js の全機能を
// サポートしているわけではなく、「AWS Lambdaで動かすために不要な
// 機能は対応しない」という方針のランタイムのため、node.jsでは
// 動いても llrt では動かないAPIが存在する.
//
// ここでは、実際に llrt の API.md(2026年7月時点)で未サポートと
// 確認できたAPIの利用箇所を、lambda実行対象ディレクトリ
// (lambda/src, modules, プロジェクトの lib/public) から
// 正規表現ベースで検出する.
//
// AIメモ: llrtの正式サポートAPI一覧を網羅するallow-list方式では
// なく、既知のNG項目のみを検出するdeny-list方式とした. llrtの
// バージョンアップで対応状況が変わった場合は _RULES を更新すること.
//
(function () {
    'use strict';

    const fs = require("fs");
    const path = require("path");

    // mintoUtil.
    const mintoUtil = require("./mintoUtil.js");

    // args.
    const args = require("./args.js");

    // コマンド名.
    const COMMAND_NAME = "llrtCheck";

    // MINTO_HOMEパスを取得.
    const _MINTO_HOME = (function () {
        let ret = process.env["MINTO_HOME"];
        if (ret != undefined) {
            if (!ret.endsWith("/")) {
                ret += "/";
            }
            return ret;
        }
        return path.resolve(__dirname + "/../") + "/";
    })();

    // カレントパス.
    const _CURRENT_PATH = path.resolve() + "/";

    // 検出対象拡張子(mt.js, mt.html も含めて拾える範囲).
    const _TARGET_EXTENDS = [".js", ".html"];

    // 検出ルール一覧.
    // pattern: 1行ずつ判定する正規表現.
    // reason: 検出時に表示する理由.
    const _RULES = [
        {
            pattern: /crypto\s*\.\s*createCipheriv\s*\(/,
            reason: "llrtのnode:cryptoはcreateCipherivを未サポート(AES等の対称鍵暗号化にはcrypto.subtle(WebCrypto)の利用を検討してください)"
        },
        {
            pattern: /crypto\s*\.\s*createDecipheriv\s*\(/,
            reason: "llrtのnode:cryptoはcreateDecipherivを未サポート(crypto.subtle(WebCrypto)の利用を検討してください)"
        },
        {
            pattern: /crypto\s*\.\s*pbkdf2(Sync)?\s*\(/,
            reason: "llrtのnode:cryptoはpbkdf2/pbkdf2Syncを未サポート(modules/auth/password.jsのようにcreateHmacで自前実装するか、crypto.subtleのderiveBitsを検討してください)"
        },
        {
            pattern: /crypto\s*\.\s*scrypt(Sync)?\s*\(/,
            reason: "llrtのnode:cryptoはscrypt/scryptSyncを未サポート"
        },
        {
            pattern: /crypto\s*\.\s*createSign\s*\(/,
            reason: "llrtのnode:cryptoはcreateSignを未サポート"
        },
        {
            pattern: /crypto\s*\.\s*createVerify\s*\(/,
            reason: "llrtのnode:cryptoはcreateVerifyを未サポート"
        },
        {
            pattern: /crypto\s*\.\s*createDiffieHellman\s*\(/,
            reason: "llrtのnode:cryptoはcreateDiffieHellmanを未サポート"
        },
        {
            pattern: /crypto\s*\.\s*publicEncrypt\s*\(/,
            reason: "llrtのnode:cryptoはpublicEncryptを未サポート"
        },
        {
            pattern: /crypto\s*\.\s*privateDecrypt\s*\(/,
            reason: "llrtのnode:cryptoはprivateDecryptを未サポート"
        },
        {
            pattern: /for\s+await\s*\(/,
            reason: "llrtでは for-await-of 構文が動作しない事例が確認されています" +
                "(sample/login-logout/lib/s3client.js のコメント参照)。" +
                "stream.transformToString() 等の代替手段を検討してください"
        }
    ];

    // 対象ファイルかどうか判定.
    const _isTargetFile = function (fileName) {
        const len = _TARGET_EXTENDS.length;
        for (let i = 0; i < len; i++) {
            if (fileName.endsWith(_TARGET_EXTENDS[i])) {
                return true;
            }
        }
        return false;
    }

    // 1ファイルをチェック.
    // filePath 対象のファイルパスを設定します.
    // 戻り値: 検出結果のArray({file, line, reason})が返却されます.
    const _checkFile = function (filePath) {
        const ret = [];
        let content;
        try {
            content = fs.readFileSync(filePath, "utf-8");
        } catch (e) {
            return ret;
        }
        const lines = content.split("\n");
        const lineLen = lines.length;
        const ruleLen = _RULES.length;
        for (let i = 0; i < lineLen; i++) {
            for (let j = 0; j < ruleLen; j++) {
                if (_RULES[j].pattern.test(lines[i])) {
                    ret.push({
                        file: filePath,
                        line: i + 1,
                        reason: _RULES[j].reason
                    });
                }
            }
        }
        return ret;
    }

    // 指定ディレクトリ配下(存在しない場合は無視)をチェック.
    // dirPath 対象のディレクトリパスを設定します.
    // 戻り値: 検出結果のArrayが返却されます.
    const _checkDir = function (dirPath) {
        if (!mintoUtil.existsDirSync(dirPath)) {
            return [];
        }
        const files = mintoUtil.listFile(dirPath, false, true);
        let ret = [];
        const len = files.length;
        for (let i = 0; i < len; i++) {
            if (_isTargetFile(files[i])) {
                ret = ret.concat(_checkFile(files[i]));
            }
        }
        return ret;
    }

    // llrt実行対象ディレクトリ全体をチェック.
    // targetDir プロジェクトのカレントディレクトリを設定します
    //           (省略時は実行時のカレントディレクトリ).
    // 戻り値: 検出結果のArray({file, line, reason})が返却されます.
    const check = function (targetDir) {
        targetDir = targetDir || _CURRENT_PATH;
        if (!targetDir.endsWith("/")) {
            targetDir += "/";
        }
        let ret = [];
        // lambda本体.
        ret = ret.concat(_checkDir(_MINTO_HOME + "lambda/src/"));
        // 共通モジュール群.
        ret = ret.concat(_checkDir(_MINTO_HOME + "modules/"));
        // プロジェクト固有のlib/public.
        ret = ret.concat(_checkDir(targetDir + "lib/"));
        ret = ret.concat(_checkDir(targetDir + "public/"));
        return ret;
    }
    exports.check = check;

    // 標準出力.
    const p = function (out) {
        console.log(out);
    }

    // help表示.
    const help = function () {
        p("Usage: " + COMMAND_NAME + " [OPTION]...");
        p(" Check for node.js APIs known to be unsupported by llrt,");
        p(" within lambda/src, modules, and the current project's lib/public.");
        p("[OPTION]:");
        p("  -h or --help:");
        p("    Show this help.");
        p("");
    }

    // コマンド実行処理(単体実行された場合のみ).
    if (require.main === module) {
        if (args.isValue("-h", "--help")) {
            help();
        } else {
            const result = check();
            if (result.length == 0) {
                p("# " + COMMAND_NAME + ": OK (no issues found)");
            } else {
                p("# " + COMMAND_NAME + ": " + result.length + " issue(s) found");
                const len = result.length;
                for (let i = 0; i < len; i++) {
                    p("  " + result[i].file + ":" + result[i].line +
                        " - " + result[i].reason);
                }
                process.exitCode = 1;
            }
        }
    }
})();
