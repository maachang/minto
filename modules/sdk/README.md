# ◆◆◆ dynamoDbSdk.js ◆◆◆

AWS-DynamoDB接続(aws-sdk-v3)モジュールです。Document Client相当(marshall/unmarshall)により、通常のJSオブジェクトのまま入出力できる最低限のDynamoDB I/Oを提供します。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.put(table, item, options)` | itemをテーブルに登録(全体上書き) |
| `exports.get(table, key, options)` | keyに一致する1件を取得 |
| `exports.delete(table, key, options)` | keyに一致する1件を削除 |
| `exports.update(table, key, patch, options)` | keyに一致する1件のpatchキーを全てSET |
| `exports.query(table, keyConditionExpression, expressionAttributeValues, options)` | Queryを実行 |

---

## `put(table, item, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `table` | `string` | 対象のテーブル名 |
| `item` | `object` | 登録対象の内容(JSオブジェクト) |
| `options.noError` | `boolean` | `false` の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |

### 戻り値

`boolean` — 成功時 `true`(失敗時 `false`。`noError:false`の場合は例外throw)。

### 使用例

```javascript
const dynamoDbSdk = $loadLib("dynamoDbSdk.js");

await dynamoDbSdk.put("users", { pk: "u001", sk: "profile", name: "Alice" });
```

---

## `get(table, key, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `table` | `string` | 対象のテーブル名 |
| `key` | `object` | 主キー(パーティションキー[+ソートキー]) |
| `options` | `object` | `put`と同様(`noError`/`region`/`credentials`) |

### 戻り値

`object | null` — 対象内容のJSオブジェクト(存在しない場合は`null`)。

### 使用例

```javascript
const item = await dynamoDbSdk.get("users", { pk: "u001", sk: "profile" });
```

---

## `delete(table, key, options)`

### 引数

`get`と同様(`table`/`key`/`options`)。

### 戻り値

`boolean` — 成功時 `true`。

### 使用例

```javascript
await dynamoDbSdk.delete("users", { pk: "u001", sk: "profile" });
```

---

## `update(table, key, patch, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `table` | `string` | 対象のテーブル名 |
| `key` | `object` | 主キー |
| `patch` | `object` | SET対象のカラム名と値 |
| `options` | `object` | `put`と同様 |

### 戻り値

`boolean` — 成功時 `true`。

### 使用例

```javascript
await dynamoDbSdk.update("users", { pk: "u001", sk: "profile" }, { name: "Alice Updated" });
```

---

## `query(table, keyConditionExpression, expressionAttributeValues, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `table` | `string` | 対象のテーブル名 |
| `keyConditionExpression` | `string` | DynamoDBのKeyConditionExpression文字列(例: `"pk = :pk and begins_with(sk, :sk)"`) |
| `expressionAttributeValues` | `object` | プレースホルダ(`:xxx`)に対応する値 |
| `options.indexName` | `string` | セカンダリインデックス名 |
| `options.expressionAttributeNames` | `object` | 属性名プレースホルダ(`#xxx`) |
| `options.filterExpression` | `string` | FilterExpression文字列 |
| `options.limit` | `number` | 取得件数上限 |
| `options.scanIndexForward` | `boolean` | `false`で降順(デフォルト: 昇順) |
| `options.exclusiveStartKey` | `object` | 前回結果の`lastEvaluatedKey`を設定し続きから取得 |
| `options.noError`/`region`/`credentials` | | 他関数と同様 |

### 戻り値

`{ items: object[], count: number, lastEvaluatedKey?: object }`

### 使用例

```javascript
const res = await dynamoDbSdk.query(
    "users",
    "pk = :pk and begins_with(sk, :sk)",
    { ":pk": "u001", ":sk": "order#" },
    { limit: 20, scanIndexForward: false }
);
console.log(res.items, res.count);
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-dynamodb`・`@aws-sdk/util-dynamodb`のみ利用)。
- `update`はUpdateExpressionを自由に組み立てる汎用対応はせず、patchオブジェクトのキー全てを`"SET"`するだけの単純対応(attribute削除や`ADD`/`REMOVE`が必要な場合は都度拡張)。
- `query`の`keyConditionExpression`/`filterExpression`はDynamoDBの式構文をそのまま文字列で受け取り、`expressionAttributeValues`の値のみ内部で`marshall`する。

---

# ◆◆◆ kmsSdk.js ◆◆◆

AWS-KMS接続(aws-sdk-v3)モジュールです。エンベロープ暗号化によるencrypt/decryptが利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.encrypt(keyId, plaintext, options)` | 対象データをエンベロープ暗号化 |
| `exports.decrypt(encrypted, options)` | `encrypt`で暗号化した内容を復号 |

---

## `encrypt(keyId, plaintext, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `keyId` | `string` | 対象のKMSキーID(キーARN/エイリアス可) |
| `plaintext` | `string` | 暗号化対象の文字列 |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.encryptionContext` | `object` | KMSの暗号化コンテキスト(decrypt時にも同じ内容が必要) |

### 戻り値

`{ keyId, encryptedDataKey, iv, ciphertext }`(いずれもbase64文字列)、失敗時は`null`。

### 使用例

```javascript
const kmsSdk = $loadLib("kmsSdk.js");

const encrypted = await kmsSdk.encrypt("alias/my-key", "秘密のデータ");
// encrypted を保存
```

---

## `decrypt(encrypted, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `encrypted` | `object` | `encrypt`が返却した`{ keyId, encryptedDataKey, iv, ciphertext }` |
| `options.encryptionContext` | `object` | encrypt時に設定したものと同じ内容 |
| `options.noError`/`region`/`credentials` | | `encrypt`と同様 |

### 戻り値

`string | null` — 復号された平文文字列(失敗時`null`)。

### 使用例

```javascript
const plaintext = await kmsSdk.decrypt(encrypted);
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-kms`のみ利用)。
- KMSのEncrypt/Decrypt APIを直接使う方式は対象データが最大4096バイトまでという制限があり、`s3IndexTable.js`/`s3MasterTable.js`の行データ(json型カラムなど可変長データ)には不向きなため、エンベロープ暗号化方式を採用している(GenerateDataKeyでデータキーを取得→平文データキーでローカルAES-256-GCM暗号化→暗号化済みデータキーのみをciphertextと一緒に保存)。
- llrtの`node:crypto`は`createCipheriv`/`createDecipheriv`を未サポートのため、ローカルのAES-256-GCM暗号化/復号には`globalThis.crypto.subtle`(WebCrypto)を利用している。
- WebCryptoのAES-GCM暗号化結果は「暗号文+認証タグ(16Byte)」が1つのArrayBufferとして連結返却されるため、authTagを別項目として持たず`ciphertext`にそのまま含めている。
- IV長は12Byte(GCM推奨値)。

---

# ◆◆◆ parameterStoreSdk.js ◆◆◆

AWS-SystemsManager ParameterStore接続(aws-sdk-v3)モジュールです。最低限のパラメータ取得(get)操作が利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.get(name, options)` | 指定パラメータ名の値を取得(TTLキャッシュ付き) |

---

## `get(name, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `name` | `string` | 対象のパラメータ名 |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.withDecryption` | `boolean` | `true`の場合SecureString型パラメータを復号して取得(デフォルト: `false`) |
| `options.ttl` | `number` | キャッシュTTL(ミリ秒。デフォルト: `60000`=60秒。`0`でキャッシュ無効) |
| `options.forceRefresh` | `boolean` | `true`の場合キャッシュを無視して再取得 |

### 戻り値

`string | null` — パラメータ値(取得できない場合は`null`)。

### 使用例

```javascript
const parameterStoreSdk = $loadLib("parameterStoreSdk.js");

const value = await parameterStoreSdk.get("/my-app/api-endpoint");
const secure = await parameterStoreSdk.get("/my-app/secret", { withDecryption: true });
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-ssm`のみ利用)。
- Lambdaは同一実行環境(コンテナ)がリクエスト毎に再利用されるケースがあるため、取得結果をモジュール内メモリにTTL付きキャッシュし、同一コンテナ内での再取得コスト・API呼び出し回数を削減している(`secretsManagerSdk.js`と同じ設計方針)。キャッシュキーは`name + withDecryption + region`の組み合わせ。
- パラメータ作成/更新/削除はIaC(CloudFormation/CDK等)側の責務とみなし、本モジュールでは対象外にしている。

---

# ◆◆◆ secretsManagerSdk.js ◆◆◆

AWS-SecretsManager接続(aws-sdk-v3)モジュールです。最低限のシークレット取得(get)操作が利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.get(secretId, options)` | 指定シークレットIDの値を取得(TTLキャッシュ付き) |

---

## `get(secretId, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `secretId` | `string` | 対象のシークレットID(名前 or ARN) |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.ttl` | `number` | キャッシュTTL(ミリ秒。デフォルト: `60000`=60秒。`0`でキャッシュ無効) |
| `options.forceRefresh` | `boolean` | `true`の場合キャッシュを無視して再取得 |

### 戻り値

`string | null` — シークレット値(`SecretString`。取得できない場合は`null`)。

### 使用例

```javascript
const secretsManagerSdk = $loadLib("secretsManagerSdk.js");

const dbPassword = await secretsManagerSdk.get("prod/db/password");
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-secrets-manager`のみ利用)。
- Lambdaは同一実行環境(コンテナ)がリクエスト毎に再利用されるケースがあるため、取得結果をモジュール内メモリにTTL付きキャッシュし、同一コンテナ内での再取得コスト・API呼び出し回数を削減している。キャッシュキーは`secretId + region`の組み合わせ。
- シークレット作成/更新/削除はIaC(CloudFormation/CDK等)側の責務とみなし、本モジュールでは対象外にしている。

---

# ◆◆◆ sesSdk.js ◆◆◆

AWS-SES接続(aws-sdk-v3)モジュールです。最低限のメール送信(send)操作が利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.send(from, to, subject, body, options)` | メールを送信 |

---

## `send(from, to, subject, body, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `from` | `string` | 送信元メールアドレス(SESで検証済みのアドレス/ドメイン) |
| `to` | `string \| string[]` | 宛先メールアドレス |
| `subject` | `string` | 件名 |
| `body` | `string` | 本文(`options.html`指定時はHTML文字列) |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.html` | `boolean` | `true`の場合bodyをHTML本文として送信(デフォルト: `false`=text本文) |
| `options.cc` | `string \| string[]` | CC宛先 |
| `options.bcc` | `string \| string[]` | BCC宛先 |
| `options.replyTo` | `string \| string[]` | 返信先メールアドレス |
| `options.charset` | `string` | 文字コード(デフォルト: `"UTF-8"`) |

### 戻り値

`{ messageId } | null` — 送信結果(失敗時`null`)。

### 使用例

```javascript
const sesSdk = $loadLib("sesSdk.js");

const res = await sesSdk.send(
    "no-reply@example.com",
    "user@example.com",
    "お知らせ",
    "本文です",
    { cc: ["cc1@example.com"], html: false }
);
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-ses`のみ利用)。
- テンプレート管理・添付ファイル付きメール(`SendRawEmail`/MIME組み立て)は対象外にし、text/html本文のシンプルな送信のみに絞っている。

---

# ◆◆◆ snsSdk.js ◆◆◆

AWS-SNS接続(aws-sdk-v3)モジュールです。最低限のSNS通知送信(publish)操作が利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.publish(topicArn, message, options)` | 指定トピックにメッセージをpublish |

---

## `publish(topicArn, message, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `topicArn` | `string` | 対象のトピックARN(SMS送信の場合は電話番号) |
| `message` | `string` | 送信対象のメッセージ本文 |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.subject` | `string` | 通知の件名(メール通知等で利用) |
| `options.messageGroupId` | `string` | FIFOトピック利用時のグループID |
| `options.messageDeduplicationId` | `string` | FIFOトピック利用時の重複排除ID |

### 戻り値

`{ messageId } | null` — publish結果(失敗時`null`)。

### 使用例

```javascript
const snsSdk = $loadLib("snsSdk.js");

const res = await snsSdk.publish("arn:aws:sns:ap-northeast-1:123456789012:my-topic", "通知メッセージ");
```

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-sns`のみ利用)。
- トピック作成・購読(subscribe/unsubscribe)管理はIaC(CloudFormation/CDK等)側の責務とみなし、本モジュールでは対象外にしている。既存トピックへのpublishのみを提供する。

---

# ◆◆◆ sqsSdk.js ◆◆◆

AWS-SQS接続(aws-sdk-v3)モジュールです。最低限のSQS送受信(送信/受信/削除)操作が利用できます。

---

## エクスポート

| 関数 | 説明 |
|---|---|
| `exports.send(queueUrl, body, options)` | 指定キューにメッセージを送信 |
| `exports.receive(queueUrl, options)` | 指定キューからメッセージを受信 |
| `exports.delete(queueUrl, receiptHandle, options)` | 指定キューからメッセージを削除(処理完了通知) |

---

## `send(queueUrl, body, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `queueUrl` | `string` | 対象のキューURL |
| `body` | `string` | 送信対象のメッセージ本文 |
| `options.noError` | `boolean` | `false`の場合例外返却(デフォルト: `true`) |
| `options.region` | `string` | 接続先リージョン(デフォルト: `ap-northeast-1`) |
| `options.credentials` | `object` | `access_key`/`secret_access_key`/`session_token` |
| `options.delaySeconds` | `number` | 配信遅延秒数(0-900) |
| `options.messageGroupId` | `string` | FIFOキュー利用時のグループID |
| `options.messageDeduplicationId` | `string` | FIFOキュー利用時の重複排除ID |

### 戻り値

`{ messageId } | null` — 送信結果(失敗時`null`)。

### 使用例

```javascript
const sqsSdk = $loadLib("sqsSdk.js");

await sqsSdk.send("https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue", JSON.stringify({ type: "job" }));
```

---

## `receive(queueUrl, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `queueUrl` | `string` | 対象のキューURL |
| `options.maxMessages` | `number` | 最大取得件数(1-10。デフォルト: `1`) |
| `options.waitSeconds` | `number` | ロングポーリング待機秒数(0-20) |
| `options.visibilityTimeout` | `number` | 可視性タイムアウト秒数 |
| `options.noError`/`region`/`credentials` | | `send`と同様 |

### 戻り値

`Array<{ messageId, receiptHandle, body }>` — メッセージが無い場合は空配列。

### 使用例

```javascript
const messages = await sqsSdk.receive(queueUrl, { maxMessages: 5, waitSeconds: 10 });
for (const m of messages) {
    // 処理...
    await sqsSdk.delete(queueUrl, m.receiptHandle);
}
```

---

## `delete(queueUrl, receiptHandle, options)`

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `queueUrl` | `string` | 対象のキューURL |
| `receiptHandle` | `string` | `receive`で取得した対象メッセージのreceiptHandle |
| `options` | `object` | `send`と同様(`noError`/`region`/`credentials`) |

### 戻り値

`boolean` — 成功時`true`。

---

## 依存・注意事項

- 依存モジュールは無し(`@aws-sdk/client-sqs`のみ利用)。
- Lambda関数URL用途では単発メッセージ処理が中心という想定のため、`sendMessageBatch`等のバッチ操作は対象外にしている。
- キューへのメッセージ処理完了後は必ず`delete`を呼び出すこと(呼ばない場合、可視性タイムアウト経過後に同じメッセージが再度受信されてしまう)。

---

# ◆◆◆ 共通事項 ◆◆◆

`modules/sdk/*` の7ファイルはいずれも以下の共通設計を持ちます。

- リージョン毎・クレデンシャル毎にAWS-SDK-V3のClientインスタンスをモジュール内メモリにキャッシュし(コンテナ再利用時の再生成コストを削減)、`options.region`(デフォルト`ap-northeast-1`)・`options.credentials`(未指定時は環境変数`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`から取得)で切り替え可能。
- 各関数は`options.noError`(デフォルト`true`)でエラー時に例外を握りつぶし`false`/`null`/空配列等を返すか、`false`指定時は例外をthrowするかを選択できる。
- 失敗時は`console.warn`で対象キー・optionsの内容を出力してからエラーハンドリングする。
- llrtでの実行を前提としているため、AWS-SDK-V3のフルパッケージ(`@aws-sdk/client-*`)を含む`llrt-lambda-full-sdk.zip`レイヤーが必要(標準の軽量llrtランタイムには含まれない)。

## テスト対象外について

`docs/testing.md`に記載の通り、本ディレクトリ配下(`dynamoDbSdk.js`・`sqsSdk.js`・`snsSdk.js`・`secretsManagerSdk.js`・`parameterStoreSdk.js`・`sesSdk.js`・`kmsSdk.js`)は実際のAWSサービス(S3以外)への通信が発生するため現状テスト対象外です。`tools/localS3.js`はS3のみに対応したローカルエミュレータであり、これらのサービスには未対応のためです。

# ◆◆◆ EOF ◆◆◆
