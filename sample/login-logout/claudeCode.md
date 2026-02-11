# README.md にある、claudeCodeで生成されたソース情報.

~~~js
// ============================================================
// minto ログイン・ログアウト Webアプリ
// AWS Lambda 関数URL + S3 + jhtml テンプレートエンジン
// ============================================================
//
// ■ ディレクトリ構成
//
//   lambda/
//   ├── src/
//   │   └── index.js                 (minto本体 ※既存)
//   ├── tools/
//   │   └── jhtml.js                 (jhtmlテンプレートエンジン ※既存)
//   ├── public/
//   │   ├── filter.mt.js             (認証フィルター)
//   │   ├── index.mt.html            (ログインページ)
//   │   ├── login.mt.js              (ログインAPI)
//   │   ├── logout.mt.js             (ログアウトAPI)
//   │   ├── mypage.mt.html           (マイページ)
//   │   ├── register.mt.html         (ユーザー登録ページ)
//   │   ├── api/
//   │   │   └── register.mt.js       (ユーザー登録API)
//   │   └── assets/
//   │       └── style.css            (スタイルシート)
//   ├── lib/
//   │   ├── s3client.js              (S3操作 共通モジュール)
//   │   ├── session.js               (S3セッション管理)
//   │   └── userStore.js             (S3ユーザー管理)
//   └── conf/
//       └── app.json                 (アプリ設定)
//
//
// ■ S3 バケット構成
//
//   s3://<BUCKET>/
//   ├── sessions/<sessionId>.json
//   └── users/<userId>.json
//
//
// ■ jhtml テンプレートエンジンの組み込み方法
//
//   Lambdaエントリポイント(起動スクリプト)で以下を実行:
//
//     const mintoIndex = require("./src/index.js");
//     const jhtml = require("./tools/jhtml.js");
//     mintoIndex.setJHTMLConvFunc(jhtml.convert);
//
//   これにより .mt.html ファイルが実行時に自動的に
//   jhtml.convert() で .jhtml.js 相当に変換され実行される.
//
//   ※ 事前変換する場合:
//     jhtml.convert(fs.readFileSync("xxx.mt.html").toString())
//     の結果を xxx.jhtml.js として保存してデプロイすれば
//     setJHTMLConvFunc は不要.
//
//
// ■ jhtml テンプレート構文 (tools/jhtml.js 準拠)
//
//   <% ... %>        JS実行(出力なし)
//   <%= expr %>      式の結果をHTML出力
//   <%# ... %>       コメント(何も出力しない)
//   ${ expr }        テンプレート出力 (<%= expr %> と同等)
//   $out("string")   プログラム的にHTML出力
//
//   変換後は以下の形になる:
//     exports.handler = async function() {
//         let _$outString = "";
//         const $out = function(n) { _$outString += n; };
//         ... (変換されたコード) ...
//         return _$outString;
//     }
//
//   ※ handler内では minto グローバル変数が利用可能:
//     $request(), $response(), $loadLib(), $loadConf(),
//     $require(), $mime(), $requestId(), $getNow(),
//     HttpError, rand, createRandom
//
//
// ■ Lambda 実行ロールに必要な IAM ポリシー
//
//   {
//     "Effect": "Allow",
//     "Action": [
//       "s3:GetObject", "s3:PutObject",
//       "s3:DeleteObject", "s3:ListBucket"
//     ],
//     "Resource": [
//       "arn:aws:s3:::<BUCKET>",
//       "arn:aws:s3:::<BUCKET>/*"
//     ]
//   }
//
// ============================================================
~~~

~~~js
// ************************************************************
// conf/app.json
// ************************************************************
// --- ファイル: conf/app.json ---
{
    "s3Bucket": "my-minto-app-bucket",
    "sessionPrefix": "sessions/",
    "userPrefix": "users/",
    "sessionTimeoutMin": 30,
    "region": "ap-northeast-1"
}
~~~

~~~js
// ************************************************************
// lib/s3client.js
// S3操作 共通モジュール
// ************************************************************
// --- ファイル: lib/s3client.js ---
(function() {
    'use strict';

    const { S3Client, GetObjectCommand, PutObjectCommand,
            DeleteObjectCommand, ListObjectsV2Command
    } = $require("@aws-sdk/client-s3");

    const _conf = $loadConf("app.json");
    const _BUCKET = _conf.s3Bucket;
    const _REGION = _conf.region || "ap-northeast-1";
    const _s3 = new S3Client({ region: _REGION });

    // StreamをStringに変換.
    const _streamToString = async function(stream) {
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString("utf-8");
    };

    // S3からJSON取得.
    exports.getJson = async function(key) {
        try {
            const res = await _s3.send(new GetObjectCommand({
                Bucket: _BUCKET, Key: key
            }));
            const body = await _streamToString(res.Body);
            return JSON.parse(body);
        } catch (e) {
            if (e.name === "NoSuchKey" ||
                e.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw e;
        }
    };

    // S3にJSON保存.
    exports.putJson = async function(key, data) {
        await _s3.send(new PutObjectCommand({
            Bucket: _BUCKET, Key: key,
            Body: JSON.stringify(data),
            ContentType: "application/json"
        }));
    };

    // S3オブジェクト削除.
    exports.remove = async function(key) {
        try {
            await _s3.send(new DeleteObjectCommand({
                Bucket: _BUCKET, Key: key
            }));
        } catch (e) {}
    };

    // S3キー一覧取得.
    exports.listKeys = async function(prefix) {
        const keys = [];
        let token = undefined;
        do {
            const res = await _s3.send(new ListObjectsV2Command({
                Bucket: _BUCKET, Prefix: prefix,
                ContinuationToken: token
            }));
            if (res.Contents) {
                for (let i = 0; i < res.Contents.length; i++) {
                    keys.push(res.Contents[i].Key);
                }
            }
            token = res.IsTruncated
                ? res.NextContinuationToken : undefined;
        } while (token);
        return keys;
    };

    exports.getBucket = function() { return _BUCKET; };
})();
~~~

~~~js
// ************************************************************
// lib/session.js
// S3ベース セッション管理
// ************************************************************
// --- ファイル: lib/session.js ---

(function() {
    'use strict';

    const s3 = $loadLib("s3client.js");
    const _conf = $loadConf("app.json");
    const _PREFIX = _conf.sessionPrefix || "sessions/";
    const _TIMEOUT = (_conf.sessionTimeoutMin || 30) * 60 * 1000;

    const _generateId = function() {
        const c =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let id = "";
        for (let i = 0; i < 48; i++) {
            id += c[(rand() >>> 0) % c.length];
        }
        return id + "_" + Date.now().toString(36);
    };

    const _key = function(sid) {
        return _PREFIX + sid + ".json";
    };

    // セッション作成 → セッションIDを返却.
    exports.create = async function(userId, userData) {
        const sid = _generateId();
        const now = Date.now();
        await s3.putJson(_key(sid), {
            sessionId: sid,
            userId: userId,
            name: userData.name || userId,
            role: userData.role || "user",
            createdAt: now,
            lastAccess: now
        });
        return sid;
    };

    // セッション取得 → ユーザー情報 or null.
    exports.get = async function(sid) {
        if (sid == null || sid == undefined || sid === "") {
            return null;
        }
        const ses = await s3.getJson(_key(sid));
        if (ses == null) return null;
        if (Date.now() - ses.lastAccess > _TIMEOUT) {
            await s3.remove(_key(sid));
            return null;
        }
        ses.lastAccess = Date.now();
        await s3.putJson(_key(sid), ses);
        return {
            userId: ses.userId,
            name: ses.name,
            role: ses.role
        };
    };

    // セッション破棄.
    exports.destroy = async function(sid) {
        if (sid != null && sid !== "") {
            await s3.remove(_key(sid));
        }
    };

    // 有効セッション数.
    exports.count = async function() {
        const keys = await s3.listKeys(_PREFIX);
        return keys.length;
    };
})();
~~~

~~~js
// ************************************************************
// lib/userStore.js
// S3ベース ユーザー管理
// ************************************************************
// --- ファイル: lib/userStore.js ---

(function() {
    'use strict';

    const crypto = $require("crypto");
    const s3 = $loadLib("s3client.js");
    const _conf = $loadConf("app.json");
    const _PREFIX = _conf.userPrefix || "users/";

    const _hashPw = function(pw, salt) {
        return crypto.createHash("sha256")
            .update(salt + ":" + pw).digest("hex");
    };

    const _genSalt = function() {
        return crypto.randomBytes(16).toString("hex");
    };

    const _key = function(uid) {
        return _PREFIX + uid + ".json";
    };

    // ユーザー登録.
    exports.register = async function(uid, pw, name, role) {
        const ex = await s3.getJson(_key(uid));
        if (ex != null) {
            return {
                success: false,
                message: "このユーザーIDは既に登録されています"
            };
        }
        const salt = _genSalt();
        await s3.putJson(_key(uid), {
            userId: uid,
            name: name || uid,
            role: role || "user",
            salt: salt,
            passwordHash: _hashPw(pw, salt),
            createdAt: new Date().toISOString()
        });
        return { success: true, message: "ユーザー登録が完了しました" };
    };

    // 認証(ログイン検証).
    exports.authenticate = async function(uid, pw) {
        const u = await s3.getJson(_key(uid));
        if (u == null) return null;
        if (_hashPw(pw, u.salt) !== u.passwordHash) return null;
        return { userId: u.userId, name: u.name, role: u.role };
    };

    // ユーザー情報取得(パスワード除く).
    exports.getUser = async function(uid) {
        const u = await s3.getJson(_key(uid));
        if (u == null) return null;
        return {
            userId: u.userId, name: u.name,
            role: u.role, createdAt: u.createdAt
        };
    };

    // ユーザー一覧(管理者向け).
    exports.listUsers = async function() {
        const keys = await s3.listKeys(_PREFIX);
        const ret = [];
        for (let i = 0; i < keys.length; i++) {
            const u = await s3.getJson(keys[i]);
            if (u != null) {
                ret.push({
                    userId: u.userId, name: u.name,
                    role: u.role, createdAt: u.createdAt
                });
            }
        }
        return ret;
    };

    // パスワード変更.
    exports.changePassword = async function(uid, oldPw, newPw) {
        const u = await s3.getJson(_key(uid));
        if (u == null) {
            return { success: false, message: "ユーザーが見つかりません" };
        }
        if (_hashPw(oldPw, u.salt) !== u.passwordHash) {
            return {
                success: false,
                message: "現在のパスワードが正しくありません"
            };
        }
        const newSalt = _genSalt();
        u.salt = newSalt;
        u.passwordHash = _hashPw(newPw, newSalt);
        await s3.putJson(_key(uid), u);
        return { success: true, message: "パスワードを変更しました" };
    };
})();
~~~

~~~js
// ************************************************************
// public/filter.mt.js
// 認証フィルター
// ************************************************************
// --- ファイル: public/filter.mt.js ---

exports.handler = async function() {
    const req = $request();
    const path = req.path();

    // 認証不要パス.
    if (path === "/index" ||
        path === "/login" ||
        path === "/logout" ||
        path === "/register" ||
        path === "/api/register" ||
        path.startsWith("/assets/")) {
        return true;
    }

    // セッションチェック.
    const session = $loadLib("session.js");
    const sid = req.cookie("minto_sid");
    const user = await session.get(sid);

    if (user == null) {
        $response().redirect("/index");
        return;
    }

    return true;
};
~~~

~~~js
// ************************************************************
// public/login.mt.js
// ログインAPI (POST)
// ************************************************************
// --- ファイル: public/login.mt.js ---

exports.handler = async function() {
    const req = $request();
    const res = $response();

    if (req.method() !== "POST") {
        throw new HttpError({ status: 405, message: "Method Not Allowed" });
    }

    const params = req.params();
    const userId = (params.userId || "").trim();
    const password = params.password || "";

    if (userId === "" || password === "") {
        return {
            success: false,
            message: "ユーザーIDとパスワードを入力してください"
        };
    }

    // S3認証.
    const userStore = $loadLib("userStore.js");
    const userData = await userStore.authenticate(userId, password);

    if (userData == null) {
        return {
            success: false,
            message: "ユーザーIDまたはパスワードが正しくありません"
        };
    }

    // S3セッション作成.
    const session = $loadLib("session.js");
    const sid = await session.create(userId, userData);

    // Cookie設定.
    res.cookie("minto_sid", {
        value: sid,
        path: "/",
        httponly: true,
        samesite: "lax",
        "max-age": "1800"
    });

    res.status(200);
    return {
        success: true,
        message: "ログイン成功",
        user: {
            userId: userData.userId,
            name: userData.name,
            role: userData.role
        }
    };
};
~~~

~~~js
// ************************************************************
// public/logout.mt.js
// ログアウト (GET/POST)
// ************************************************************
// --- ファイル: public/logout.mt.js ---

exports.handler = async function() {
    const req = $request();
    const res = $response();

    const session = $loadLib("session.js");
    const sid = req.cookie("minto_sid");
    if (sid != null) {
        await session.destroy(sid);
    }

    res.cookie("minto_sid", {
        value: "",
        path: "/",
        httponly: true,
        samesite: "lax",
        "max-age": "0"
    });

    res.redirect("/index");
};
~~~

~~~js
// ************************************************************
// public/api/register.mt.js
// ユーザー登録API (POST)
// ************************************************************
// --- ファイル: public/api/register.mt.js ---

exports.handler = async function() {
    const req = $request();

    if (req.method() !== "POST") {
        throw new HttpError({ status: 405, message: "Method Not Allowed" });
    }

    const p = req.params();
    const userId = (p.userId || "").trim();
    const password = p.password || "";
    const passwordConfirm = p.passwordConfirm || "";
    const name = (p.name || "").trim();

    if (userId === "") {
        return { success: false, message: "ユーザーIDを入力してください" };
    }
    if (userId.length < 3 || userId.length > 32) {
        return { success: false, message: "ユーザーIDは3〜32文字で入力してください" };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(userId)) {
        return {
            success: false,
            message: "ユーザーIDは英数字とアンダースコアのみ使用できます"
        };
    }
    if (password.length < 4) {
        return { success: false, message: "パスワードは4文字以上で入力してください" };
    }
    if (password !== passwordConfirm) {
        return { success: false, message: "パスワードが一致しません" };
    }

    const userStore = $loadLib("userStore.js");
    return await userStore.register(userId, password, name || userId, "user");
};
~~~

~~~js
// ============================================================
// ↓↓↓ 以下 jhtml テンプレート (.mt.html ファイル) ↓↓↓
// ============================================================
//
// jhtml構文 (tools/jhtml.js 準拠):
//   <% ... %>     → JS実行
//   <%= expr %>   → HTML出力
//   ${ expr }     → HTML出力 (<%= expr %> と同等)
//   <%# ... %>    → コメント
//   $out("str")   → プログラム的HTML出力
//
// jhtml.convert() により以下の形に変換される:
//   exports.handler = async function() {
//       let _$outString = "";
//       const $out = function(n) { _$outString += n; };
//       ...変換コード...
//       return _$outString;
//   }
//
// handler内では minto グローバル変数が利用可能:
//   $request(), $response(), $loadLib(), $loadConf(),
//   $require(), $requestId(), HttpError, rand 等
// ============================================================
~~~

~~~html
// ************************************************************
// public/index.mt.html
// ログインページ
// ************************************************************
// --- ファイル: public/index.mt.html ---

<%# ログインページ %>
<%
    // ログイン済みならマイページへリダイレクト.
    const session = $loadLib("session.js");
    const sid = $request().cookie("minto_sid");
    const user = await session.get(sid);
    if (user != null) {
        $response().redirect("/mypage");
        return _$outString;
    }
%>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>minto - ログイン</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div class="container">
    <div class="card login-card">
        <h1>minto Login</h1>
        <p class="subtitle">AWS Lambda 関数URL + S3</p>

        <div id="error-msg" class="error-msg" style="display:none;"></div>

        <div class="form-group">
            <label for="userId">ユーザーID</label>
            <input type="text" id="userId" placeholder="ユーザーIDを入力"
                autocomplete="username">
        </div>
        <div class="form-group">
            <label for="password">パスワード</label>
            <input type="password" id="password" placeholder="パスワードを入力"
                autocomplete="current-password">
        </div>
        <button class="btn btn-primary" onclick="doLogin()">
            ログイン
        </button>

        <div class="register-link">
            アカウントをお持ちでない方は
            <a href="/register">新規登録</a>
        </div>
    </div>
</div>

<script>
async function doLogin() {
    var userId = document.getElementById("userId").value.trim();
    var password = document.getElementById("password").value;
    var errEl = document.getElementById("error-msg");
    errEl.style.display = "none";

    if (!userId || !password) {
        errEl.textContent = "ユーザーIDとパスワードを入力してください";
        errEl.style.display = "block";
        return;
    }
    try {
        var res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: userId, password: password })
        });
        var data = await res.json();
        if (data.success) {
            location.href = "/mypage";
        } else {
            errEl.textContent = data.message || "ログインに失敗しました";
            errEl.style.display = "block";
        }
    } catch (e) {
        errEl.textContent = "通信エラーが発生しました";
        errEl.style.display = "block";
    }
}
document.addEventListener("keydown", function(e) {
    if (e.key === "Enter") doLogin();
});
</script>
</body>
</html>
~~~

~~~html
// ************************************************************
// public/register.mt.html
// ユーザー新規登録ページ
// ************************************************************
// --- ファイル: public/register.mt.html ---

<%# ユーザー登録ページ %>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>minto - 新規登録</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div class="container">
    <div class="card login-card">
        <h1>新規ユーザー登録</h1>
        <p class="subtitle">アカウントを作成してください</p>

        <div id="error-msg" class="error-msg" style="display:none;"></div>
        <div id="success-msg" class="success-msg" style="display:none;"></div>

        <div class="form-group">
            <label for="userId">ユーザーID</label>
            <input type="text" id="userId"
                placeholder="英数字 3〜32文字" autocomplete="username">
        </div>
        <div class="form-group">
            <label for="name">表示名</label>
            <input type="text" id="name" placeholder="表示名 (省略可)">
        </div>
        <div class="form-group">
            <label for="password">パスワード</label>
            <input type="password" id="password"
                placeholder="4文字以上" autocomplete="new-password">
        </div>
        <div class="form-group">
            <label for="passwordConfirm">パスワード (確認)</label>
            <input type="password" id="passwordConfirm"
                placeholder="もう一度入力" autocomplete="new-password">
        </div>
        <button class="btn btn-primary" onclick="doRegister()">
            登録
        </button>

        <div class="register-link">
            アカウントをお持ちの方は
            <a href="/index">ログイン</a>
        </div>
    </div>
</div>

<script>
async function doRegister() {
    var userId = document.getElementById("userId").value.trim();
    var name = document.getElementById("name").value.trim();
    var pw = document.getElementById("password").value;
    var pwc = document.getElementById("passwordConfirm").value;
    var errEl = document.getElementById("error-msg");
    var sucEl = document.getElementById("success-msg");
    errEl.style.display = "none";
    sucEl.style.display = "none";

    if (!userId || !pw) {
        errEl.textContent = "ユーザーIDとパスワードは必須です";
        errEl.style.display = "block";
        return;
    }
    if (pw !== pwc) {
        errEl.textContent = "パスワードが一致しません";
        errEl.style.display = "block";
        return;
    }
    try {
        var res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: userId, name: name,
                password: pw, passwordConfirm: pwc
            })
        });
        var data = await res.json();
        if (data.success) {
            sucEl.textContent = data.message + " ログインページへ移動します...";
            sucEl.style.display = "block";
            setTimeout(function() { location.href = "/index"; }, 2000);
        } else {
            errEl.textContent = data.message;
            errEl.style.display = "block";
        }
    } catch (e) {
        errEl.textContent = "通信エラーが発生しました";
        errEl.style.display = "block";
    }
}
document.addEventListener("keydown", function(e) {
    if (e.key === "Enter") doRegister();
});
</script>
</body>
</html>
~~~

~~~html
// ************************************************************
// public/mypage.mt.html
// マイページ (ログイン後)
// ************************************************************
// --- ファイル: public/mypage.mt.html ---

<%# マイページ %>
<%
    // セッション取得.
    const session = $loadLib("session.js");
    const sid = $request().cookie("minto_sid");
    const user = await session.get(sid);

    // 未ログイン → リダイレクト.
    if (user == null) {
        $response().redirect("/index");
        return _$outString;
    }

    // ユーザー詳細取得.
    const userStore = $loadLib("userStore.js");
    const detail = await userStore.getUser(user.userId);
%>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>minto - マイページ</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div class="container">
    <nav class="navbar">
        <div class="nav-brand">minto App</div>
        <div class="nav-right">
            <span class="nav-user">
                <%= user.name %>
                <% if (user.role === "admin") { %>
                    <span class="badge badge-admin">Admin</span>
                <% } else { %>
                    <span class="badge badge-user">User</span>
                <% } %>
            </span>
            <a href="/logout" class="btn btn-sm btn-outline">ログアウト</a>
        </div>
    </nav>

    <div class="card mypage-card">
        <h1>マイページ</h1>
        <p>ようこそ、<strong>${ user.name }</strong> さん!</p>

        <div class="info-table">
            <table>
                <tr>
                    <th>ユーザーID</th>
                    <td><%= user.userId %></td>
                </tr>
                <tr>
                    <th>表示名</th>
                    <td>${ user.name }</td>
                </tr>
                <tr>
                    <th>ロール</th>
                    <td><%= user.role %></td>
                </tr>
                <tr>
                    <th>登録日時</th>
                    <td><%= detail ? detail.createdAt : "-" %></td>
                </tr>
                <tr>
                    <th>リクエストID</th>
                    <td class="mono"><%= $requestId() %></td>
                </tr>
                <tr>
                    <th>アクセス時刻</th>
                    <td><%= new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) %></td>
                </tr>
            </table>
        </div>

        <%# === 管理者セクション === %>
        <% if (user.role === "admin") { %>
        <div class="admin-section">
            <h2>管理者メニュー</h2>
            <%
                const sessCount = await session.count();
                const allUsers = await userStore.listUsers();
            %>
            <p>アクティブセッション数: <strong><%= sessCount %></strong></p>
            <p>登録ユーザー数: <strong><%= allUsers.length %></strong></p>
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>ユーザーID</th>
                        <th>表示名</th>
                        <th>ロール</th>
                        <th>登録日時</th>
                    </tr>
                </thead>
                <tbody>
                <% for (let i = 0; i < allUsers.length; i++) { %>
                    <tr>
                        <td><%= allUsers[i].userId %></td>
                        <td><%= allUsers[i].name %></td>
                        <td><%= allUsers[i].role %></td>
                        <td><%= allUsers[i].createdAt %></td>
                    </tr>
                <% } %>
                </tbody>
            </table>
        </div>
        <% } %>
    </div>
</div>
</body>
</html>
~~~

~~~css
// ************************************************************
// public/assets/style.css
// ************************************************************
// --- ファイル: public/assets/style.css ---

* { margin:0; padding:0; box-sizing:border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont,
        "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f0f2f5; color: #333; min-height: 100vh;
}
.container { max-width:860px; margin:0 auto; padding:20px; }
.navbar {
    display:flex; justify-content:space-between; align-items:center;
    background:#1a73e8; color:#fff; padding:12px 24px;
    border-radius:8px; margin-bottom:24px;
}
.nav-brand { font-size:1.2em; font-weight:bold; }
.nav-right { display:flex; align-items:center; gap:12px; }
.nav-user  { font-size:0.9em; }
.card {
    background:#fff; border-radius:12px;
    box-shadow:0 2px 12px rgba(0,0,0,0.08); padding:32px;
}
.login-card {
    max-width:440px; margin:60px auto 0; text-align:center;
}
.login-card h1 { color:#1a73e8; margin-bottom:8px; }
.subtitle { color:#888; font-size:0.9em; margin-bottom:24px; }
.form-group { text-align:left; margin-bottom:16px; }
.form-group label {
    display:block; font-size:0.85em;
    font-weight:600; color:#555; margin-bottom:4px;
}
.form-group input {
    width:100%; padding:10px 14px;
    border:1px solid #ddd; border-radius:6px;
    font-size:1em; transition:border-color 0.2s;
}
.form-group input:focus {
    outline:none; border-color:#1a73e8;
    box-shadow:0 0 0 3px rgba(26,115,232,0.15);
}
.btn {
    display:inline-block; padding:10px 24px;
    border:none; border-radius:6px; font-size:1em;
    cursor:pointer; text-decoration:none;
    transition:background 0.2s, transform 0.1s;
}
.btn:active { transform:scale(0.97); }
.btn-primary {
    background:#1a73e8; color:#fff; width:100%; margin-top:8px;
}
.btn-primary:hover { background:#1557b0; }
.btn-outline {
    background:transparent; color:#fff;
    border:1px solid rgba(255,255,255,0.6);
    padding:6px 16px; font-size:0.85em;
}
.btn-outline:hover { background:rgba(255,255,255,0.15); }
.error-msg {
    background:#fef0f0; color:#d93025;
    padding:10px 14px; border-radius:6px;
    font-size:0.9em; margin-bottom:16px;
    border:1px solid #fad2cf;
}
.success-msg {
    background:#e6f4ea; color:#137333;
    padding:10px 14px; border-radius:6px;
    font-size:0.9em; margin-bottom:16px;
    border:1px solid #ceead6;
}
.register-link {
    margin-top:20px; font-size:0.9em; color:#888;
}
.register-link a { color:#1a73e8; text-decoration:none; }
.register-link a:hover { text-decoration:underline; }
.badge {
    display:inline-block; padding:2px 8px;
    border-radius:10px; font-size:0.75em; font-weight:600;
}
.badge-admin { background:#fce8e6; color:#d93025; }
.badge-user  { background:#e8f0fe; color:#1a73e8; }
.info-table { margin-top:20px; }
.info-table table { width:100%; border-collapse:collapse; }
.info-table th, .info-table td {
    padding:10px 14px; border-bottom:1px solid #eee; text-align:left;
}
.info-table th {
    width:140px; color:#888; font-weight:600; font-size:0.9em;
}
.mono { font-family:monospace; font-size:0.85em; }
.admin-section {
    margin-top:24px; padding:20px;
    background:#fef7e0; border-radius:8px;
    border:1px solid #fdd835;
}
.admin-section h2 {
    font-size:1em; color:#f9a825; margin-bottom:12px;
}
.admin-table {
    width:100%; border-collapse:collapse; margin-top:12px;
}
.admin-table th {
    background:#fff8e1; padding:8px 10px;
    font-size:0.85em; text-align:left;
    border-bottom:2px solid #fdd835;
}
.admin-table td {
    padding:8px 10px; font-size:0.85em;
    border-bottom:1px solid #f5f5f5;
}
.mypage-card h1 { color:#1a73e8; margin-bottom:12px; }
~~~

~~~js
// ************************************************************
// Lambdaエントリポイント (起動ファイル)
// jhtmlテンプレートエンジンを組み込む
// ************************************************************
// --- ファイル: lambda/main.js (Lambdaハンドラ設定先) ---

const mintoIndex = require("./src/index.js");
const jhtml = require("./tools/jhtml.js");

// jhtml変換関数をminto本体に登録.
// これにより .mt.html が実行時にjhtml.convert()で
// 自動変換されて実行される.
mintoIndex.setJHTMLConvFunc(jhtml.convert);

// Lambda ハンドラをエクスポート.
exports.handler = mintoIndex.handler;
~~~

~~~js
// ************************************************************
// 初期ユーザー登録スクリプト (デプロイ後に1度実行)
// 実行: node scripts/init-users.js
// ************************************************************
// --- ファイル: scripts/init-users.js ---

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const BUCKET = "my-minto-app-bucket";
const REGION = "ap-northeast-1";
const PREFIX = "users/";

const s3 = new S3Client({ region: REGION });

function hashPw(pw, salt) {
    return crypto.createHash("sha256")
        .update(salt + ":" + pw).digest("hex");
}

async function createUser(uid, pw, name, role) {
    const salt = crypto.randomBytes(16).toString("hex");
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: PREFIX + uid + ".json",
        Body: JSON.stringify({
            userId: uid, name: name, role: role,
            salt: salt, passwordHash: hashPw(pw, salt),
            createdAt: new Date().toISOString()
        }),
        ContentType: "application/json"
    }));
    console.log("Created: " + uid);
}

(async () => {
    await createUser("admin",  "admin123", "管理者ユーザー", "admin");
    await createUser("user01", "pass1234", "一般ユーザー",   "user");
    await createUser("demo",   "demo",     "デモユーザー",   "user");
    console.log("Done.");
})();
~~~
