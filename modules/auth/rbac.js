///////////////////////////////////////////////
// ロールベース認可 (RBAC: Role-Based Access Control) ヘルパー.
//
// public/filter.mt.js や各 *.mt.js から呼び出して利用する.
// ユーザーのロール(admin, editor, viewer等)や権限(users:write, posts:read等)
// に基づくアクセス制御、階層継承、ワイルドカード権限判定を提供する.
//
// conf/rbac.json が存在する場合はロール定義・権限一覧・継承関係を
// 自動ロードし、未設定時でもシンプルなロール一致・admin最上位の
// デフォルト動作でそのまま利用可能.
///////////////////////////////////////////////
(function () {
    'use strict';

    // セッションモジュール(遅延ロード).
    let _session = null;
    const _getSession = function () {
        if (_session == null) {
            try {
                _session = $loadLib("session.js");
            } catch (e) {
                // セッション未構成の場合はnull
                _session = null;
            }
        }
        return _session;
    };

    // adminモジュール(遅延ロード).
    let _admin = null;
    const _getAdmin = function () {
        if (_admin == null) {
            try {
                _admin = $loadLib("admin.js");
            } catch (e) {
                _admin = null;
            }
        }
        return _admin;
    };

    // [conf] RBAC設定ファイル名.
    const _CONF_NAME = "rbac.json";

    // デフォルトのロール定義(conf/rbac.json未設定時).
    const _DEFAULT_CONF = {
        roles: {
            admin: {
                inherits: ["editor"],
                permissions: ["*"]
            },
            editor: {
                inherits: ["viewer"],
                permissions: []
            },
            viewer: {
                inherits: [],
                permissions: []
            }
        },
        defaultRole: "viewer"
    };

    // ワイルドカード権限マッチング.
    // pattern: "users:*", "*", "posts:read"
    // target: "users:create", "posts:read"
    const _matchPermission = function (pattern, target) {
        if (!pattern || !target) return false;
        if (pattern === "*" || pattern === target) return true;
        if (pattern.endsWith(":*")) {
            const prefix = pattern.substring(0, pattern.length - 1); // e.g. "users:"
            return target.startsWith(prefix);
        }
        return false;
    };

    // RBACインスタンスを生成.
    // config: ロール定義({ roles, defaultRole, loginUrl, forbiddenUrl })
    exports.create = function (config) {
        config = config || {};

        // 設定の解決(引数 > conf/rbac.json > デフォルト)
        const _getConfig = function () {
            if (config && Object.keys(config).length > 0) {
                return config;
            }
            try {
                const loaded = typeof $loadConf === "function" ? $loadConf(_CONF_NAME) : null;
                if (loaded) return loaded;
            } catch (e) {
                // ignore
            }
            return _DEFAULT_CONF;
        };

        // 指定ロールが継承する全ロール名を取得(自身を含む).
        const _getEffectiveRoles = function (roleName, conf, visited) {
            visited = visited || new Set();
            if (!roleName || visited.has(roleName)) return [];
            visited.add(roleName);

            const result = [roleName];
            const roleDef = conf.roles && conf.roles[roleName];
            if (roleDef && Array.isArray(roleDef.inherits)) {
                for (let i = 0; i < roleDef.inherits.length; i++) {
                    const inherited = _getEffectiveRoles(roleDef.inherits[i], conf, visited);
                    for (let j = 0; j < inherited.length; j++) {
                        if (!result.includes(inherited[j])) {
                            result.push(inherited[j]);
                        }
                    }
                }
            }
            return result;
        };

        // ユーザーから全ロール一覧(継承含む)を解決.
        const _resolveUserRoles = function (user, conf) {
            if (!user) return [];
            let userRoles = [];
            if (typeof user === "string") {
                userRoles = [user];
            } else if (Array.isArray(user.roles)) {
                userRoles = user.roles.slice();
            } else if (typeof user.role === "string") {
                userRoles = [user.role];
            } else if (conf.defaultRole) {
                userRoles = [conf.defaultRole];
            }

            const effectiveSet = new Set();
            for (let i = 0; i < userRoles.length; i++) {
                const eff = _getEffectiveRoles(userRoles[i], conf);
                for (let j = 0; j < eff.length; j++) {
                    effectiveSet.add(eff[j]);
                }
            }
            return Array.from(effectiveSet);
        };

        // ユーザーが持つ全パーミッション一覧を解決(ロール紐づき＋個別付与).
        const _resolveUserPermissions = function (user, conf) {
            if (!user) return [];
            const permissions = new Set();

            // 個別付与されたpermissions
            if (typeof user === "object" && Array.isArray(user.permissions)) {
                for (let i = 0; i < user.permissions.length; i++) {
                    permissions.add(user.permissions[i]);
                }
            }

            // 所属ロール(継承含む)から得られるpermissions
            const effectiveRoles = _resolveUserRoles(user, conf);
            for (let i = 0; i < effectiveRoles.length; i++) {
                const roleName = effectiveRoles[i];
                const roleDef = conf.roles && conf.roles[roleName];
                if (roleDef && Array.isArray(roleDef.permissions)) {
                    for (let j = 0; j < roleDef.permissions.length; j++) {
                        permissions.add(roleDef.permissions[j]);
                    }
                }
            }

            return Array.from(permissions);
        };

        // セッションから現在のログインユーザーを取得.
        const getUser = async function () {
            const sess = _getSession();
            if (!sess) return null;
            try {
                const sessionData = await sess.getCookie();
                if (!sessionData) return null;
                return sessionData;
            } catch (e) {
                return null;
            }
        };

        // ユーザーが指定ロールを持っているかチェック(boolean).
        // user: ユーザーオブジェクト / 文字列 / 省略時は現在のセッション
        // required: 単一ロール名(string) または ロール名配列(string[])
        // options: { requireAll: boolean, checkAdminJs: boolean }
        const hasRole = function (user, required, options) {
            options = options || {};
            if (!user || !required) return false;

            const conf = _getConfig();
            const userRoles = _resolveUserRoles(user, conf);

            const reqArray = Array.isArray(required) ? required : [required];
            if (reqArray.length === 0) return true;

            if (options.requireAll === true) {
                for (let i = 0; i < reqArray.length; i++) {
                    if (!userRoles.includes(reqArray[i])) {
                        return false;
                    }
                }
                return true;
            }

            // requireAllでない場合: いずれか1つ満たせばOK
            for (let i = 0; i < reqArray.length; i++) {
                if (userRoles.includes(reqArray[i])) {
                    return true;
                }
            }
            return false;
        };

        // ユーザーが指定権限を持っているかチェック(boolean).
        // user: ユーザーオブジェクト / 省略時は現在のセッション
        // required: 単一権限名(string) または 権限名配列(string[])
        // options: { requireAll: boolean }
        const hasPermission = function (user, required, options) {
            options = options || {};
            if (!user || !required) return false;

            const conf = _getConfig();
            const userPerms = _resolveUserPermissions(user, conf);

            // "*" があれば全権限OK
            if (userPerms.includes("*")) {
                return true;
            }

            const reqArray = Array.isArray(required) ? required : [required];
            if (reqArray.length === 0) return true;

            const checkSingle = function (reqPerm) {
                for (let i = 0; i < userPerms.length; i++) {
                    if (_matchPermission(userPerms[i], reqPerm)) {
                        return true;
                    }
                }
                return false;
            };

            if (options.requireAll === true) {
                for (let i = 0; i < reqArray.length; i++) {
                    if (!checkSingle(reqArray[i])) {
                        return false;
                    }
                }
                return true;
            }

            // requireAllでない場合: いずれか1つ満たせばOK
            for (let i = 0; i < reqArray.length; i++) {
                if (checkSingle(reqArray[i])) {
                    return true;
                }
            }
            return false;
        };

        // 権限・ロール不足時のエラー応答またはリダイレクト処理.
        const _handleDenied = function (isNotLoggedIn, options) {
            options = options || {};
            const conf = _getConfig();

            if (options.throwError === true) {
                const status = isNotLoggedIn ? 401 : 403;
                const message = isNotLoggedIn ? "Unauthorized" : "Forbidden";
                if (typeof HttpError === "function") {
                    throw new HttpError({ status: status, message: message });
                }
                const err = new Error(message);
                err.status = status;
                throw err;
            }

            if (typeof $response === "function") {
                const res = $response();
                if (isNotLoggedIn) {
                    const loginUrl = options.loginUrl || conf.loginUrl;
                    if (loginUrl) {
                        res.redirect(loginUrl, null, 302);
                        return false;
                    }
                    res.status(401, "Unauthorized");
                    res.body({ error: "Unauthorized", message: "Login required" });
                } else {
                    const forbiddenUrl = options.forbiddenUrl || conf.forbiddenUrl;
                    if (forbiddenUrl) {
                        res.redirect(forbiddenUrl, null, 302);
                        return false;
                    }
                    res.status(403, "Forbidden");
                    res.body({ error: "Forbidden", message: "Access denied" });
                }
            }
            return false;
        };

        // 指定ロールを要求するガード(filter.mt.js / *.mt.js 用).
        // 成功時: true (またはuserオブジェクト)
        // 失敗時: false (401/403設定 or リダイレクト) または例外throw
        const requireRole = async function (requiredRoles, options) {
            options = options || {};
            let user = options.user;
            if (!user) {
                user = await getUser();
            }

            if (!user) {
                return _handleDenied(true, options);
            }

            // admin.js の初期管理者・S3管理者チェック連携
            if (options.checkAdminJs !== false) {
                const adm = _getAdmin();
                if (adm && typeof adm.isAdmin === "function") {
                    try {
                        const userId = user.userId || user.email || user.mail;
                        if (userId && await adm.isAdmin(userId)) {
                            return true;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }

            const ok = hasRole(user, requiredRoles, options);
            if (!ok) {
                return _handleDenied(false, options);
            }
            return true;
        };

        // 指定パーミッションを要求するガード.
        const requirePermission = async function (requiredPermissions, options) {
            options = options || {};
            let user = options.user;
            if (!user) {
                user = await getUser();
            }

            if (!user) {
                return _handleDenied(true, options);
            }

            // admin.js の管理者チェック連携(管理者は全権限OK)
            if (options.checkAdminJs !== false) {
                const adm = _getAdmin();
                if (adm && typeof adm.isAdmin === "function") {
                    try {
                        const userId = user.userId || user.email || user.mail;
                        if (userId && await adm.isAdmin(userId)) {
                            return true;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }

            const ok = hasPermission(user, requiredPermissions, options);
            if (!ok) {
                return _handleDenied(false, options);
            }
            return true;
        };

        return {
            getUser: getUser,
            hasRole: hasRole,
            hasPermission: hasPermission,
            can: hasPermission,
            requireRole: requireRole,
            requirePermission: requirePermission
        };
    };

    // デフォルトインスタンスのエクスポート
    const _defaultInstance = exports.create();
    exports.getUser = _defaultInstance.getUser;
    exports.hasRole = _defaultInstance.hasRole;
    exports.hasPermission = _defaultInstance.hasPermission;
    exports.can = _defaultInstance.can;
    exports.requireRole = _defaultInstance.requireRole;
    exports.requirePermission = _defaultInstance.requirePermission;
})();
