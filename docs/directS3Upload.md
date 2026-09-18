# S3 Direct-to-S3 アップロード (大容量ファイル対応)

Lambda Function URLs には **リクエストおよびレスポンスのペイロード上限が 6MB** という AWS プラットフォーム上の制約があります。
画像、動画、PDF、ZIPファイルなどの大容量ファイルを扱う場合、Lambda を経由させずに **ブラウザから S3 へ直接アップロード（Direct-to-S3）** するパターンが推奨されます。

Minto では、ゼロ依存（外部 npm パッケージ不使用）でこのパターンを実現するためのヘルパーモジュール `modules/s3table/directUpload.js` を提供しています。

---

## 処理フロー

```
[クライアント (ブラウザ/モバイル)]                [Minto (Lambda)]             [Amazon S3]
        |                                             |                          |
        | --- 1. チケット要求 (POST /api/ticket) ---> |                          |
        |     (ファイル名、MIMEタイプ等)             | (認証・サイズ・拡張子検証)|
        |                                             | (Presigned PUT URL生成)  |
        | <--- 2. チケット返却 ----------------------- |                          |
        |      { uploadUrl, bucket, key, ... }        |                          |
        |                                             |                          |
        | --- 3. 直接アップロード (PUT uploadUrl) -----------------------------> |
        |     (Lambdaを経由しないため6MB上限なし / 進捗監視可能)                  |
        | <--- 200 OK ---------------------------------------------------------- |
        |                                             |                          |
        | --- 4. 完了通知 (POST /api/complete) -----> |                          |
        |     { bucket, key }                         | --- 5. HEAD確認 -------> |
        |                                             |        (実在・サイズ検証)|
        |                                             | <--- メタデータ返却 ---- |
        |                                             | (DB保存・後処理)         |
        | <--- 6. 成功返却 (ファイル情報) ------------ |                          |
```

---

## 1. バックエンド実装例

### 1.1 アップロードチケット発行 (`public/api/ticket.mt.js`)

```javascript
const directUpload = $loadLib("directUpload.js");

exports.handler = async () => {
    // 認証チェック (session, rbac, apiKey等)
    const session = $loadLib("session.js").get();
    if (!session) {
        $response().status(401, "Unauthorized");
        return { error: "ログインが必要です" };
    }

    const params = $request().params();

    try {
        const ticket = directUpload.createUploadTicket({
            bucket: process.env.S3_UPLOAD_BUCKET,
            prefix: "user-files/" + session.userId + "/",
            filename: params.filename,
            contentType: params.contentType,
            allowedTypes: ["image/*", "application/pdf", "video/mp4"],
            maxSize: 50 * 1024 * 1024, // 50MB
            expiresIn: 900             // 15分
        });
        return { ok: true, ticket: ticket };
    } catch (e) {
        $response().status(400, "Bad Request");
        return { ok: false, error: e.message };
    }
};
```

### 1.2 アップロード完了検証 (`public/api/complete.mt.js`)

```javascript
const directUpload = $loadLib("directUpload.js");

exports.handler = async () => {
    const params = $request().params();
    const { bucket, key } = params;

    // S3 上の実ファイルを HEAD して検証
    const check = await directUpload.verifyUploadedFile(bucket, key, {
        maxSize: 50 * 1024 * 1024,
        allowedTypes: ["image/*", "application/pdf", "video/mp4"]
    });

    if (!check.valid) {
        $response().status(400, "Bad Request");
        return { ok: false, error: check.error };
    }

    // 検証成功: S3Table にレコード登録など
    // check.size, check.contentType, check.etag が取得できます

    return {
        ok: true,
        file: {
            bucket: check.bucket,
            key: check.key,
            size: check.size,
            contentType: check.contentType
        }
    };
};
```

---

## 2. フロントエンド（ブラウザ）実装例

進捗率（`%`）をリアルタイム表示するため、`XMLHttpRequest` の `upload.onprogress` を利用します。

```javascript
async function uploadFileWithProgress(file, onProgress) {
    // 1. チケット取得
    const ticketRes = await fetch("/api/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type })
    });
    const { ok, ticket, error } = await ticketRes.json();
    if (!ok) throw new Error(error);

    // 2. S3へ直接PUT
    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", ticket.uploadUrl, true);
        if (ticket.contentType) {
            xhr.setRequestHeader("Content-Type", ticket.contentType);
        }
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed: " + xhr.status)));
        xhr.onerror = () => reject(new Error("Network error during S3 upload"));
        xhr.send(file);
    });

    // 3. 完了通知
    const compRes = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: ticket.bucket, key: ticket.key })
    });
    return await compRes.json();
}
```

---

## 3. S3 バケットの CORS 設定

ブラウザから直接 S3 に `PUT` リクエストを送信するため、S3 バケットに適切な CORS 設定（Cross-Origin Resource Sharing）が必要です。

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["PUT", "GET", "HEAD"],
        "AllowedOrigins": ["https://your-domain.com"],
        "ExposeHeaders": ["ETag"]
    }
]
```
※ ローカル開発（`tools/localAws.js`）では、自動的に CORS ヘッダーが付与されるため追加設定は不要です。

---

## 4. セキュリティとベストプラクティス

1. **ファイル名のサニタイズ**: クライアントから送信されたファイル名をそのまま S3 キーにせず、UUID 自動採番（`crypto.randomUUID()`）を行い、拡張子のみをホワイトリスト検証（英数字のみ）して使用します。
2. **ContentType の厳格指定**: 署名生成時に `Content-Type` を指定することで、署名URLが他の MIME タイプで悪用されるのを防ぎます。
3. **完了検証（verifyUploadedFile）の徹底**: 悪意のあるユーザーが巨大なファイルや別ファイルを配置した場合に備え、DB 保存前に必ず S3 の HEAD メタデータを検証してください。
