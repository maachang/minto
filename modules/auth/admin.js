// 管理者情報を管理する機能.
// ここで「管理者となるユーザID: メールアドレスなど」を登録して、ここで
// ログインユーザが「管理者としてtrue返却された場合」は「管理者として扱う」
// みたいな形が行える機能を提供する。
//
// これによって「管理者＝管理者メニュー」が実行できるみたいな仕組みを作る
// ことができる。
//
// あと「内容として、これらの情報は永続化が必要なので、情報はS3に
// 「一応暗号化した内容で保存する」ようにする。
//
// この時の「暗号化キー」情報は環境変数に設定＝存在しない場合はデフォルト値
// を用いて、対応する。
//
// あと「初期の１人の管理者の定義は「環境変数」で定義できるようにして、
// そのユーザが「他の管理者を割り当てる」形で利用できるようにする。
//
// AIメモ:
// - llrtのnode:cryptoはcreateCipheriv/createDecipherivを未サポートのため、
//   modules/sdk/kmsSdk.jsと同様にglobalThis.crypto.subtle(WebCrypto)による
//   AES-256-GCM暗号化を利用する(node:cryptoのrandomBytes等ではなくWebCrypto
//   系で統一)。暗号化キー文字列はSHA-256でハッシュ化して32byteの生鍵にする
//   (crypto.subtle.importKeyはAES-256-GCM用に正確に32byteの鍵を要求するため)。
// - 環境変数ADMIN_ENCRYPT_KEYが未設定の場合はデフォルトキー文字列を使うが、
//   これは「意図せず弱い鍵のまま運用される」ことを許容する設計のため、
//   本番運用では必ずADMIN_ENCRYPT_KEYを設定すること。
// - 初期管理者(環境変数MINTO_ADMIN_INITIAL_MAILで定義)はS3側の管理者
//   一覧には含めない(env側の値と常に比較するだけ)。そのためremoveAdminで
//   初期管理者を除外することはできない(env設定を変更しない限り常に管理者)。
// - isAdmin()でmailを省略した場合、modules/auth/session.jsのgetCookie()で
//   ログイン中ユーザを取得しそのuserIdでチェックする。session.jsはconf/
//   session.json(bucket等)を自身で自動読み込みするため、admin.js側で
//   session用の設定を意識する必要は無い(詳細はdocs/session.md参照)。
///////////////////////////////////////////////
(function () {
    'use strict';

    // S3アクセス用.
    const s3sdk = $loadLib("s3sdk.js");

    // セッション情報用.
    const session = $loadLib("session.js");

    // [ENV]管理者情報の暗号化キー.
    const _ENCRYPT_KEY_ENV = "ADMIN_ENCRYPT_KEY";

    // [DEFAULT]環境変数が未設定の場合に使う暗号化キー.
    const _DEFAULT_ENCRYPT_KEY = "minto-default-admin-encrypt-key";

    // [ENV]初期管理者(メールアドレス)を定義する環境変数.
    const _INITIAL_ADMIN_ENV = "MINTO_ADMIN_INITIAL_MAIL";

    // 管理者一覧を保存するS3オブジェクトのファイル名(prefix配下固定).
    const _FILE_NAME = "admins.json";

    // AESのIV長(GCM推奨: 12Byte).
    const _IV_LEN = 12;

    // adminキャッシュ変数名.
    const _ADMIN_CACHE = "modules.auth.admin";

    // 暗号化キー文字列からAES-256-GCM用のCryptoKeyを生成する.
    // encryptKey 対象の暗号化キー文字列を設定します.
    // 戻り値: WebCryptoのCryptoKeyが返却されます.
    const _importAesKey = async function (encryptKey) {
        const digest = await globalThis.crypto.subtle.digest(
            "SHA-256", Buffer.from(encryptKey, "utf-8"));
        return await globalThis.crypto.subtle.importKey(
            "raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    };

    // 平文をAES-256-GCMで暗号化する.
    // aesKey _importAesKeyで生成したCryptoKeyを設定します.
    // plaintext 暗号化対象の文字列を設定します.
    // 戻り値: "iv(base64).ciphertext(base64)" 形式の文字列が返却されます.
    const _encrypt = async function (aesKey, plaintext) {
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(_IV_LEN));
        const cipherBuf = await globalThis.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            aesKey, Buffer.from(plaintext, "utf-8"));
        return Buffer.from(iv).toString("base64") + "." +
            Buffer.from(cipherBuf).toString("base64");
    };

    // _encryptで暗号化した内容を復号する.
    // aesKey _importAesKeyで生成したCryptoKeyを設定します.
    // encrypted _encryptが返却した文字列を設定します.
    // 戻り値: 復号された平文文字列が返却されます.
    const _decrypt = async function (aesKey, encrypted) {
        const p = encrypted.indexOf(".");
        const iv = Buffer.from(encrypted.substring(0, p), "base64");
        const cipherBuf = Buffer.from(encrypted.substring(p + 1), "base64");
        const plainBuf = await globalThis.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, aesKey, cipherBuf);
        return Buffer.from(plainBuf).toString("utf-8");
    };

    // StreamをStringに変換.
    // llrtでは for-await-of 構文が利用できないため
    // transformToString() を利用する.
    const _streamToString = function (stream) {
        return stream.transformToString("utf-8");
    };

    // 管理者ストアを生成します.
    // options.bucket 対象のS3バケット名を設定します(必須).
    // options.prefix 保存先prefixを設定します(デフォルト "admins/").
    // options.encryptKey 暗号化キー文字列を設定します
    //         (省略時は環境変数ADMIN_ENCRYPT_KEY、それも無い場合は
    //         デフォルトキーを使う).
    // options.initialAdmin 初期管理者のメールアドレスを設定します
    //         (省略時は環境変数MINTO_ADMIN_INITIAL_MAILを使う).
    // options.region S3接続先リージョンを設定します.
    // options.credentials S3接続用クレデンシャルを設定します.
    // 戻り値: {isAdmin, addAdmin, removeAdmin, listAdmins} を持つ
    //         管理者ストアオブジェクト.
    exports.create = function (options) {
        options = options || {};
        if (options.bucket == null) {
            throw new Error("options.bucket is required.");
        }
        const _bucket = options.bucket;
        const _prefix = options.prefix || "admins/";
        const _s3opts = {
            region: options.region,
            credentials: options.credentials
        };
        const _encryptKey = options.encryptKey ||
            process.env[_ENCRYPT_KEY_ENV] || _DEFAULT_ENCRYPT_KEY;
        const _initialAdmin = options.initialAdmin ||
            process.env[_INITIAL_ADMIN_ENV] || null;

        // AesKeyは初回利用時に1度だけ生成しキャッシュする.
        let _aesKeyPromise = null;
        const _getAesKey = function () {
            if (_aesKeyPromise == null) {
                _aesKeyPromise = _importAesKey(_encryptKey);
            }
            return _aesKeyPromise;
        };

        // キャッシュクリア.
        const _clearCache = function() {
            // キャッシュをクリア.
            $cache()[_ADMIN_CACHE] = undefined;
        }

        // S3から管理者一覧(メールアドレスの配列)を取得する.
        // 存在しない場合は空配列を返す.
        const _load = async function () {
            // キャッシュが存在する場合はキャッシュから取得
            // (nullという正当なキャッシュ結果と、未キャッシュ(undefined)を
            // 区別するため厳密不等価で判定する).
            const cs = $cache();
            if (cs[_ADMIN_CACHE] !== undefined) {
                return cs[_ADMIN_CACHE];
            }
            const res = await s3sdk.get(_bucket, _prefix, _FILE_NAME, _s3opts);
            if (res == null) {
                // 空のキャッシュをセット.
                cs[_ADMIN_CACHE] = [];
                return [];
            }
            const body = await _streamToString(res.Body);
            const aesKey = await _getAesKey();
            const decrypted = await _decrypt(aesKey, body);
            const ret = JSON.parse(decrypted);
            // 取得結果のキャッシュをセット.
            cs[_ADMIN_CACHE] = ret;
            return ret;
        };

        // 管理者一覧をS3へ暗号化して保存する.
        const _save = async function (list) {
            _clearCache(); // キャッシュをクリア.
            const aesKey = await _getAesKey();
            const encrypted = await _encrypt(aesKey, JSON.stringify(list));
            await s3sdk.put(_bucket, _prefix, _FILE_NAME, encrypted, _s3opts);
        };

        return {
            // 指定メールアドレスが管理者かどうかを判定します.
            // mail 判定対象のメールアドレスを設定します.
            //      設定しない場合は「ログイン中のユーザIDでチェック」します.
            // 戻り値: 管理者の場合true.
            isAdmin: async function (mail) {
                if (mail == undefined || mail == null || mail === "") {
                    // メールアドレスが指定されていない場合は、現在のログイン中ユーザから
                    // 情報を取得する.
                    const res = await session.getCookie();
                    if(res == null) {
                        return false;
                    }
                    // ログイン中のユーザIDを取得.
                    mail = res.userId;
                }
                // 環境変数で定義された初期管理者は常に管理者として扱う.
                if (_initialAdmin != null && mail === _initialAdmin) {
                    return true;
                }
                const list = await _load();
                return list.indexOf(mail) !== -1;
            },
            // 管理者を追加します(初期管理者、または既に登録済みの場合は
            // 何もしません).
            // mail 追加対象のメールアドレスを設定します.
            addAdmin: async function (mail) {
                if (mail == undefined || mail == null || mail === "") {
                    throw new Error("mail is required.");
                }
                if (_initialAdmin != null && mail === _initialAdmin) {
                    // 初期管理者は環境変数側の定義のみで管理するため、
                    // S3側の一覧には追加しない.
                    return;
                }
                _clearCache(); // キャッシュをクリア.
                const list = await _load();
                if (list.indexOf(mail) === -1) {
                    list.push(mail);
                    await _save(list);
                }
            },
            // 管理者を削除します(未登録の場合は何もしません).
            // 環境変数で定義された初期管理者はS3側の一覧に含まれないため
            // 削除できません(除外したい場合は環境変数側の設定を変更する).
            // mail 削除対象のメールアドレスを設定します.
            removeAdmin: async function (mail) {
                _clearCache(); // キャッシュをクリア.
                const list = await _load();
                const p = list.indexOf(mail);
                if (p !== -1) {
                    list.splice(p, 1);
                    await _save(list);
                }
            },
            // 登録されている管理者一覧(メールアドレスの配列)を取得します
            // (環境変数で定義された初期管理者を含む).
            // 戻り値: メールアドレスの配列.
            listAdmins: async function () {
                const list = await _load();
                if (_initialAdmin != null && list.indexOf(_initialAdmin) === -1) {
                    return [_initialAdmin].concat(list);
                }
                return list.slice();
            }
        };
    };
})();
