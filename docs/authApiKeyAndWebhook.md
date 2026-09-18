# 外部API認証 & Webhook署名検証

本ドキュメントでは、Minto が提供する外部連携用の認証・検証モジュール（ゼロ依存、Node.js / LLRT 完全互換）の仕様と利用方法を解説します。

- **`modules/auth/apiKey.js`**: APIキー / Bearer トークン認証ガード
- **`modules/auth/webhookSig.js`**: GitHub / Stripe / Slack 等の Webhook 署名検証

---

## 1. APIキー / Bearer トークン認証 (`apiKey.js`)

外部システム、Webhook送信元、モバイルアプリなどからのリクエストを API キーや Bearer トークンで保護します。
タイミング攻撃防止のため、SHA-256 ハッシュを通した定数時間比較を行っています。

### 1.1 エンドポイントでの利用例 (`apiKey.guard`)

```javascript
// public/api/v1/data.mt.js
const apiKey = $loadLib("apiKey.js");

exports.handler = async () => {
    // 認証ガード: 失敗時は自動で 401 Unauthorized レスポンスを設定して false を返す
    const auth = apiKey.guard({
        // 単一キー、配列、またはマップ
        keys: {
            "sec_live_admin_999": { role: "admin", clientId: "client-a" },
            "sec_live_read_111":  { role: "viewer", clientId: "client-b" }
        }
    });

    if (!auth) {
        return; // 認証失敗時は guard が自動で 401 を設定済み
    }

    // auth.key, auth.meta を取得可能
    return {
        ok: true,
        client: auth.meta.clientId,
        role: auth.meta.role,
        data: [1, 2, 3]
    };
};
```

### 1.2 環境変数からのキー読み込み

`keys` を省略した場合、自動的に環境変数 `API_KEY` または `API_KEYS`（カンマ区切り）が参照されます。

```javascript
// process.env.API_KEYS="key-1, key-2, key-3" が設定されている場合
const auth = apiKey.guard();
if (!auth) return;
```

### 1.3 トークンの抽出場所

`apiKey.guard` は以下のヘッダーを優先順に検索します：
1. `Authorization: Bearer <token>`
2. `X-Api-Key: <token>`
3. クエリパラメータ `?apiKey=<token>`（`allowQuery: true` を指定した場合のみ）

---

## 2. Webhook 署名検証 (`webhookSig.js`)

GitHub、Stripe、Slack 等の外部サービスから Webhook を受信する際、リクエストが正当な送信元からのものであるかを暗号論的署名で検証します。

> [!IMPORTANT]
> Webhook の署名検証には **改ざんされていない生のリクエストボディ（Raw Body）** が必須です。
> Minto では `$request().body()` からそのまま取得できます。

### 2.1 Stripe Webhook

Stripe の `stripe-signature` ヘッダー（`t=...,v1=...`）を検証します。
リプレイ攻撃を防ぐため、タイムスタンプが 5 分（300 秒）以内のもののみ許可します。

```javascript
// public/webhook/stripe.mt.js
const webhookSig = $loadLib("webhookSig.js");

exports.handler = async () => {
    const ok = webhookSig.guard("stripe", process.env.STRIPE_WEBHOOK_SECRET);
    if (!ok) {
        return; // 署名不一致または期限切れの場合、自動で 400 Bad Request を設定
    }

    const event = JSON.parse($request().body());
    if (event.type === "checkout.session.completed") {
        // 決済完了処理
    }

    return { received: true };
};
```

### 2.2 GitHub Webhook

GitHub の `x-hub-signature-256`（SHA-256 HMAC）を検証します。

```javascript
// public/webhook/github.mt.js
const webhookSig = $loadLib("webhookSig.js");

exports.handler = async () => {
    const ok = webhookSig.guard("github", process.env.GITHUB_WEBHOOK_SECRET);
    if (!ok) return;

    const payload = JSON.parse($request().body());
    console.log("GitHub event:", payload);
    return { ok: true };
};
```

### 2.3 Slack イベント / スラッシュコマンド

Slack の `x-slack-signature` および `x-slack-request-timestamp` を検証します。

```javascript
// public/webhook/slack.mt.js
const webhookSig = $loadLib("webhookSig.js");

exports.handler = async () => {
    const ok = webhookSig.guard("slack", process.env.SLACK_SIGNING_SECRET);
    if (!ok) return;

    // Slack コマンド処理
    return "処理を受け付けました";
};
```

### 2.4 汎用 HMAC-SHA256 検証

独自の Webhook やサービス間連携用：

```javascript
const webhookSig = $loadLib("webhookSig.js");

const rawBody = $request().body();
const signature = $request().header("x-signature");
const secret = "my-shared-secret";

const isValid = webhookSig.verifyHmac(rawBody, signature, secret, {
    algorithm: "sha256",
    prefix: "sha256=" // 署名ヘッダーにプレフィックスがある場合
});
```
