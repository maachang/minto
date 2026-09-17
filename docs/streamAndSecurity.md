# レスポンスストリーミング / SSE およびセキュリティヘッダー共通設定

本ドキュメントでは、Minto で提供される「レスポンスストリーミング / Server-Sent Events (SSE)」および「セキュリティヘッダー共通設定機構（`conf/security.json`）」の仕様と使い方を説明します。

---

## 1. セキュリティヘッダー共通設定 (`conf/security.json`)

Web アプリケーション全体のセキュリティを底上げするため、プロジェクト共通の HTTP レスポンスヘッダー（CSP, HSTS, X-Content-Type-Options 等）を定義・適用する仕組みです。

### 設定ファイル (`conf/security.json`)

プロジェクトルートの `conf/security.json` に設定を記述します。

```json
{
    "enabled": true,
    "headers": {
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
        "referrer-policy": "strict-origin-when-cross-origin",
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=31536000; includeSubDomains"
    }
}
```

- `enabled`: `true` に設定すると有効化されます（`false` または未設定時は無効）。
- `headers`: 付与したい HTTP ヘッダー（小文字キー推奨）のキー・バリューを指定します。

### 動作仕様
- **適用対象**: 動的JSレスポンス、静的ファイルレスポンス（200、304）、エラーレスポンス（404、500など）のすべてに自動適用されます。
- **上書きルール**: スクリプト側で明示的に同一ヘッダーが設定されている場合は、スクリプト側の値が優先されます。
- **動的上書き ($response().securityHeaders)**:
  ```javascript
  exports.handler = async () => {
      // 特定のエンドポイントだけCSPやFrameOptionsを変更する
      $response().securityHeaders({
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self' https://trusted.cdn.com"
      });
      return { status: "ok" };
  };
  ```

---

## 2. レスポンスストリーミング / Server-Sent Events (SSE)

LLM（大言語モデル）からのトークン生成逐次配信やリアルタイム通知イベント配信を、外部ライブラリなし（Node.js / LLRT 標準APIのみ）で実現します。

### 2.1 Server-Sent Events (SSE)

`$response().sse(fn)` を使用します。自動的に `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive` がセットされます。

```javascript
// public/events.mt.js
exports.handler = async () => {
    $response().sse(async (stream) => {
        // 単純なテキスト通知
        stream.sendEvent("接続しました");

        // オブジェクト指定（自動で JSON.stringify）およびオプション指定
        stream.sendEvent({ message: "進捗1", step: 1 }, {
            event: "progress",
            id: "1",
            retry: 5000
        });

        await $sleep(500);

        stream.sendEvent({ message: "完了", step: 2 }, {
            event: "done",
            id: "2"
        });

        // ※非同期関数終了時に自動で stream.end() が呼ばれます
    });
};
```

#### クライアント側（ブラウザ JavaScript）での受信例
```javascript
const es = new EventSource("/events");

es.addEventListener("progress", (e) => {
    const data = JSON.parse(e.data);
    console.log("Progress:", data);
});

es.addEventListener("done", (e) => {
    const data = JSON.parse(e.data);
    console.log("Done:", data);
    es.close();
});
```

### 2.2 レスポンスストリーミング (`$response().stream`)

チャンク単位でバイナリやテキストを逐次ストリーミング送信する場合に使用します。

```javascript
// public/stream.mt.js
exports.handler = async () => {
    $response().contentType("text/plain", "utf-8");
    $response().stream(async (stream) => {
        stream.write("チャンク 1\n");
        await $sleep(300);
        stream.write("チャンク 2\n");
        await $sleep(300);
        stream.end("終了チャンク\n");
    });
};
```

### 2.3 Stream オブジェクトのメソッド一覧

| メソッド | 説明 |
|---|---|
| `stream.write(chunk)` | 文字列または Buffer をクライアントへ書き込みます。 |
| `stream.sendEvent(data, [options])` | SSE フォーマット（`event: ...\nid: ...\ndata: ...\n\n`）に整形して送信します。`data` がオブジェクトの場合は自動的に JSON シリアライズされます。複数行データも自動展開されます。 |
| `stream.end([chunk])` | ストリームを終了します。必要に応じて最終チャンクを指定可能です。 |
| `stream.isEnded()` | ストリームがすでに終了したかどうかを返します（boolean）。 |
| `stream.onClose(callback)` | クライアントが切断された際のクリーンアップ処理を登録できます。 |

---

## 3. 実行環境対応

- **ローカル開発サーバー (`tools/webapps.js`)**:
  - `Transfer-Encoding: chunked` によるリアルタイムHTTPストリーミング配信をサポート。
  - クライアント切断（`res.on("close")`）を検知し、安全にリソースを解放。
- **AWS Lambda 環境 (`lambda/src/index.js`)**:
  - AWS Lambda の公式レスポンスストリーミング（`awslambda.streamifyResponse`）に対応した `exports.streamHandler` を標準提供。
  - 通常の単体テストやフォールバック実行用として `mintoLambdaIndex.consumeStreamResponse(result)` を提供し、メモリバッファリングでのレスポンス検証が可能。
