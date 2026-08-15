# ◆◆◆ sendSlack.js ◆◆◆

SlackApp（Incoming Webhookではなく `chat.postMessage` API）を利用したSlackメッセージ送信モジュールです。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.setEnvMainSlackToken(token)` | SlackAccessTokenを取得する環境変数名を変更 |
| `exports.message(channel, message, userName, icon, options, access_token)` | テキストメッセージを送信 |
| `exports.json(channel, json, access_token)` | JSONペイロードをそのまま送信 |
| `exports.multi(channel, userName, icon, options, access_token)` | 複数メッセージをバッファリングし1回で送信するオブジェクトを生成 |

---

## `setEnvMainSlackToken(token)`

SlackAccessTokenを読み込む環境変数名を変更します。未設定・空文字の場合はデフォルトの `"SLACK_TOKEN"` に戻ります。

### 使用例

```javascript
const sendSlack = $loadLib("sendSlack.js");
sendSlack.setEnvMainSlackToken("MY_SLACK_TOKEN");
```

---

## `message(channel, message, userName, icon, options, access_token)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `channel` | `string` | 送信先チャンネル。`#` が無ければ自動付与 |
| `message` | `string \| string[]` | 送信メッセージ。配列の場合は `\n` 区切りで文字列化される |
| `userName` | `string` | 表示ユーザ名(省略可)。有効にするにはOAuth権限 `chat:write.customize` が必須 |
| `icon` | `string` | アイコン絵文字名(省略可)。`:` が無ければ自動付与。有効にするにはOAuth権限 `chat:write.customize` が必須 |
| `options` | `object` | その他の装飾用パラメータ(省略可) |
| `access_token` | `string` | SlackAppのAccessTokenを直接指定する場合に設定(省略時は環境変数から取得) |

### 戻り値

`Promise<{status, headers, body}>` — `body()` を呼ぶと `{ok: true}` 等のJSONが取得できる。

### 使用例

```javascript
const sendSlack = $loadLib("sendSlack.js");

const res = await sendSlack.message("general", "デプロイが完了しました");
const json = await res.body();
if (!json.ok) {
    throw new Error("Slack送信に失敗しました");
}
```

---

## `json(channel, json, access_token)`

任意のSlack API用JSONペイロードをそのまま送信します。`json.channel` が未設定の場合、引数の `channel` が自動セットされます。

### 使用例

```javascript
const res = await sendSlack.json("general", {
    text: "カスタムペイロード送信",
    blocks: [ /* ... */ ]
});
```

---

## `multi(channel, userName, icon, options, access_token)`

1回のSlackメッセージ送信で複数の処理結果メッセージをまとめて送るためのバッファオブジェクトを生成します。

### 戻り値のメソッド

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `clear()` | `this` | メッセージバッファをクリア |
| `setMessage(...args)` | `this` | メッセージをバッファに追加(`\n` 区切りで連結) |
| `getMessage()` | `string` | バッファ内容を取得 |
| `useMessage()` | `boolean` | バッファに送信対象メッセージが存在するか |
| `setUserName(name)` | `this` | 表示ユーザ名を変更 |
| `(await)flush()` | `{ok:true,...} \| {ok:false}` | バッファ内容をSlackへ送信。バッファが空の場合は送信せず `{ok:false}` を返す |

### 使用例

```javascript
const buf = sendSlack.multi("general", "batch-bot");

buf.setMessage("処理1: 成功");
buf.setMessage("処理2: 失敗");

if (buf.useMessage()) {
    await buf.flush();
}
```

---

## 依存・設定・注意事項

- 他モジュールへの依存(`$loadLib`)は無し。`fetch` のみ利用。
- 環境変数: SlackAccessToken(デフォルト `SLACK_TOKEN`。`setEnvMainSlackToken()` で変更可能)。`access_token` を関数引数で直接渡した場合はそちらが優先される。
- `message()` に `access_token` も環境変数も設定されていない場合は `Error("no credential access_token.")` をthrowする。
- `body["channel"]` が未設定の場合(`sendPost` 内)は `Error("The channel setting is required.")` をthrowする。
- 外部API(Slack)呼び出しのため、テスト対象外(モック無しの単体テストは想定されていない)。
- `userName`/`icon` の反映にはSlackアプリ側のOAuth権限 `chat:write.customize` が必要。

---

# ◆◆◆ sendGithub.js ◆◆◆

GithubTokenを利用してGithubリポジトリにissueを新規作成するモジュールです。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.createIssue(token, oganization, repository, title, body, labels)` | Githubリポジトリに新しいissueを作成 |

---

## `createIssue(token, oganization, repository, title, body, labels)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `token` | `string` | Github Personal Access Token等の認証トークン |
| `oganization` | `string \| null` | 組織契約しているrepositoryの場合の組織名(個人リポジトリの場合は `null`/`undefined`/`""`) |
| `repository` | `string` | 対象のリポジトリ名 |
| `title` | `string` | issueタイトル |
| `body` | `string` | issue本文 |
| `labels` | `string[]` | issueに付与するラベル名の配列(省略時は空配列) |

### 戻り値

```javascript
{ url, title, number }
// url: 新規issueのURL(html_url)
// title: issueのタイトル
// number: issueの番号
```

### 使用例

```javascript
const sendGithub = $loadLib("sendGithub.js");

const issue = await sendGithub.createIssue(
    githubToken,
    null,                 // 個人リポジトリの場合
    "my-repo",
    "バグ報告",
    "詳細内容...",
    ["bug"]
);
console.log(issue.url);
```

---

## 依存・設定・注意事項

- 外部API(GitHub)呼び出しのため、テスト対象外(モック無しの単体テストは想定されていない)。

---

# ◆◆◆ log.js ◆◆◆

CloudWatch Logs Insights やローカルでの解析が容易な、JSON 1行形式の構造化ログ出力モジュールです。
`$log(message, data)` や `$log.info(...)`、`$log.warn(...)`、`$log.error(...)`、`$log.debug(...)`、`$log.trace(...)` としてグローバルおよび `$loadLib("log.js")` から利用可能です。

リクエストコンテキスト(`$requestId()`, `$request().path()`, `$request().method()`)およびエラーオブジェクト(`name`, `message`, `stack`, `code`, `status`)を自動的にシリアライズして JSON 出力します。

---

## 主なメソッド

| メソッド | 説明 |
|---|---|
| `$log(message, data, options)` / `$log.info(...)` | INFOレベルの構造化ログを出力 |
| `$log.warn(message, data, options)` | WARNレベルの構造化ログを出力 |
| `$log.error(message, dataOrError, options)` | ERRORレベルの構造化ログを出力(Errorスタック自動付与) |
| `$log.debug(message, data, options)` | DEBUGレベルの構造化ログを出力 |
| `$log.trace(message, data, options)` | TRACEレベルの構造化ログを出力 |

---

## 環境変数によるログレベル制御

環境変数 `LOG_LEVEL` (または `MINTO_LOG_LEVEL`) で出力最小レベルを指定できます。
- `"trace"`, `"debug"`, `"info"`(デフォルト), `"warn"`, `"error"`, `"none"`

---

# ◆◆◆ notifyError.js ◆◆◆

発生した例外を一元的に構造化ログ(`$log.error`)へ記録し、Slackへ即時エラーアラートを送信するモジュールです。
グローバル `$notifyError(err, context, options)` または `$loadLib("notifyError.js")` から利用可能です。

Incoming Webhook URL (`SLACK_WEBHOOK_URL` / `SLACK_ERROR_WEBHOOK_URL`) または Slack Bot Token (`SLACK_TOKEN` / `SLACK_CHANNEL`) のどちらの設定でも自動対応します。

---

## 主なメソッド

| メソッド | 説明 |
|---|---|
| `$notifyError(err, context, options)` | 例外をログ出力し、Slackへリッチアラートを送信 |
| `notifyError.catch(fn, context, options)` | 非同期関数のエラーを自動検知・通知して再throwするラッパー |

---

## 設定項目

| 設定元 | 項目名 | 説明 |
|---|---|---|
| 環境変数 | `SLACK_WEBHOOK_URL` / `SLACK_ERROR_WEBHOOK_URL` | Slack Incoming Webhook URL |
| 環境変数 | `SLACK_TOKEN` | Slack Bot Token (`xoxb-...`) |
| 環境変数 | `SLACK_CHANNEL` / `SLACK_ERROR_CHANNEL` | 送信先チャンネル(デフォルト: `#alerts`) |
| `conf/notify.json` | `webhookUrl`, `slackToken`, `channel`, `appName` | 設定ファイルでの定義 |

※ WebhookやTokenが未設定の環境(ローカル検証時など)でも例外でクラッシュせず、安全にスキップしてログ出力のみ行います。

---

## 使用例

```javascript
// 1. try-catch での個別エラー通知
try {
    await processOrder(orderId);
} catch (err) {
    await $notifyError(err, { orderId: orderId, userId: user.id });
    $response().status(500);
    return { error: "注文処理中にエラーが発生しました" };
}

// 2. 自動キャッチラッパー
const safeHandler = $loadLib("notifyError.js").catch(async () => {
    // 処理...
}, { contextInfo: "batch-job" });
```

# ◆◆◆ EOF ◆◆◆
