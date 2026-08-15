// modules/auth/rbac.js のテスト.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// テスト用グローバルのモック
let mockResponseObj = null;
let mockSessionUser = null;
let mockAdminUserIds = new Set();

global.$response = function () {
    if (!mockResponseObj) {
        let _status = 200;
        let _message = "OK";
        let _headers = {};
        let _body = null;
        let _redirectUrl = null;
        let _redirectStatus = null;

        mockResponseObj = {
            status: function (code, msg) {
                _status = code;
                _message = msg || "";
                return mockResponseObj;
            },
            header: function (k, v) {
                _headers[k.toLowerCase()] = v;
                return mockResponseObj;
            },
            body: function (b) {
                _body = b;
                return mockResponseObj;
            },
            redirect: function (url, params, status) {
                _redirectUrl = url;
                _redirectStatus = status || 302;
                return mockResponseObj;
            },
            _$get: function () {
                return {
                    status: _status,
                    message: _message,
                    headers: _headers,
                    body: _body,
                    redirectUrl: _redirectUrl,
                    redirectStatus: _redirectStatus
                };
            }
        };
    }
    return mockResponseObj;
};

global.$loadLib = function (name) {
    if (name === "session.js") {
        return {
            getCookie: async function () {
                return mockSessionUser;
            }
        };
    }
    if (name === "admin.js") {
        return {
            isAdmin: async function (userId) {
                return mockAdminUserIds.has(userId);
            }
        };
    }
    return require("../../modules/auth/" + name);
};

const rbac = require("../../modules/auth/rbac.js");

beforeEach(() => {
    mockResponseObj = null;
    mockSessionUser = null;
    mockAdminUserIds = new Set();
});

test("rbac.hasRole: 基本的なロール判定と文字列/オブジェクト対応", () => {
    assert.equal(rbac.hasRole("admin", "admin"), true);
    assert.equal(rbac.hasRole("editor", "admin"), false);

    const userObj = { role: "editor" };
    assert.equal(rbac.hasRole(userObj, "editor"), true);
    assert.equal(rbac.hasRole(userObj, "viewer"), true); // editor inherits viewer
    assert.equal(rbac.hasRole(userObj, "admin"), false);

    const multiRoleUser = { roles: ["viewer", "billing"] };
    assert.equal(rbac.hasRole(multiRoleUser, "billing"), true);
    assert.equal(rbac.hasRole(multiRoleUser, "viewer"), true);
    assert.equal(rbac.hasRole(multiRoleUser, "editor"), false);
});

test("rbac.hasRole: ロール階層(継承)の判定", () => {
    // デフォルト階層: admin -> editor -> viewer
    const adminUser = { role: "admin" };
    assert.equal(rbac.hasRole(adminUser, "admin"), true);
    assert.equal(rbac.hasRole(adminUser, "editor"), true);
    assert.equal(rbac.hasRole(adminUser, "viewer"), true);

    const editorUser = { role: "editor" };
    assert.equal(rbac.hasRole(editorUser, "admin"), false);
    assert.equal(rbac.hasRole(editorUser, "editor"), true);
    assert.equal(rbac.hasRole(editorUser, "viewer"), true);

    const viewerUser = { role: "viewer" };
    assert.equal(rbac.hasRole(viewerUser, "admin"), false);
    assert.equal(rbac.hasRole(viewerUser, "editor"), false);
    assert.equal(rbac.hasRole(viewerUser, "viewer"), true);
});

test("rbac.hasRole: 複数ロール指定(any / requireAll)", () => {
    const editorUser = { role: "editor" };
    // いずれか一致(デフォルト)
    assert.equal(rbac.hasRole(editorUser, ["admin", "editor"]), true);
    assert.equal(rbac.hasRole(editorUser, ["admin", "guest"]), false);

    // 全て一致(requireAll: true)
    const userBoth = { roles: ["editor", "billing"] };
    assert.equal(rbac.hasRole(userBoth, ["editor", "billing"], { requireAll: true }), true);
    assert.equal(rbac.hasRole(userBoth, ["editor", "admin"], { requireAll: true }), false);
});

test("rbac.hasPermission: ワイルドカードと個別付与パーミッションの判定", () => {
    // 1. 個別権限
    const userWithPerms = {
        role: "viewer",
        permissions: ["posts:read", "comments:create", "users:*"]
    };
    assert.equal(rbac.hasPermission(userWithPerms, "posts:read"), true);
    assert.equal(rbac.hasPermission(userWithPerms, "comments:create"), true);
    assert.equal(rbac.hasPermission(userWithPerms, "comments:delete"), false);

    // ワイルドカード (users:*)
    assert.equal(rbac.hasPermission(userWithPerms, "users:create"), true);
    assert.equal(rbac.hasPermission(userWithPerms, "users:delete"), true);
    assert.equal(rbac.hasPermission(userWithPerms, "billing:view"), false);

    // 2. スーパーワイルドカード (*)
    const superAdmin = { permissions: ["*"] };
    assert.equal(rbac.hasPermission(superAdmin, "anything:action"), true);
    assert.equal(rbac.can(superAdmin, "any:other:permission"), true);
});

test("rbac.create: カスタムロール定義・権限マトリックスの利用", () => {
    const customRbac = rbac.create({
        roles: {
            owner: {
                inherits: ["manager"],
                permissions: ["company:*"]
            },
            manager: {
                inherits: ["member"],
                permissions: ["reports:*", "users:invite"]
            },
            member: {
                permissions: ["reports:read", "tasks:*"]
            }
        },
        defaultRole: "member"
    });

    const memberUser = { role: "member" };
    assert.equal(customRbac.hasRole(memberUser, "member"), true);
    assert.equal(customRbac.hasRole(memberUser, "manager"), false);
    assert.equal(customRbac.hasPermission(memberUser, "tasks:create"), true);
    assert.equal(customRbac.hasPermission(memberUser, "reports:read"), true);
    assert.equal(customRbac.hasPermission(memberUser, "reports:export"), false);

    const ownerUser = { role: "owner" };
    assert.equal(customRbac.hasRole(ownerUser, "member"), true); // inherited
    assert.equal(customRbac.hasRole(ownerUser, "manager"), true); // inherited
    assert.equal(customRbac.hasPermission(ownerUser, "company:delete"), true);
    assert.equal(customRbac.hasPermission(ownerUser, "reports:export"), true); // inherited from manager
    assert.equal(customRbac.hasPermission(ownerUser, "tasks:delete"), true); // inherited from member
});

test("rbac.requireRole: ガード処理(ログイン済み・認可成功/失敗)", async () => {
    // 1. 成功時
    const resOk = await rbac.requireRole(["editor", "admin"], {
        user: { role: "editor" }
    });
    assert.equal(resOk, true);

    // 2. 権限不足時 (403 Forbidden)
    const resForbidden = await rbac.requireRole("admin", {
        user: { role: "viewer" }
    });
    assert.equal(resForbidden, false);
    const resData = $response()._$get();
    assert.equal(resData.status, 403);
    assert.equal(resData.message, "Forbidden");

    // 3. throwError: true 時の例外送出
    await assert.rejects(async () => {
        await rbac.requireRole("admin", {
            user: { role: "viewer" },
            throwError: true
        });
    }, (err) => err.status === 403);
});

test("rbac.requireRole: 未ログイン時の挙動(401 or リダイレクト)", async () => {
    // 1. 401 Unauthorized
    mockSessionUser = null;
    const resUnauthorized = await rbac.requireRole("viewer");
    assert.equal(resUnauthorized, false);
    const resData = $response()._$get();
    assert.equal(resData.status, 401);

    // 2. loginUrl リダイレクト
    const customRbac = rbac.create({ loginUrl: "/auth/login" });
    const resRedirect = await customRbac.requireRole("viewer");
    assert.equal(resRedirect, false);
    const redirectData = $response()._$get();
    assert.equal(redirectData.redirectUrl, "/auth/login");
});

test("rbac: admin.js 連携 (admin.isAdmin が true なら自動昇格)", async () => {
    mockAdminUserIds.add("boss@example.com");

    const sessionUser = { userId: "boss@example.com", role: "viewer" };
    // ロール定義上はviewerだが、admin.js側で管理者のためadmin要求をパス
    const ok = await rbac.requireRole("admin", { user: sessionUser });
    assert.equal(ok, true);

    const permOk = await rbac.requirePermission("system:shutdown", { user: sessionUser });
    assert.equal(permOk, true);
});
