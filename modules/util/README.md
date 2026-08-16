# ◆◆◆ util モジュール ◆◆◆

汎用ユーティリティ群を提供するモジュールディレクトリです。  
Node.js / Bun / LLRT (AWS Lambda) 環境において、追加の npm 依存なしで動作します。

---

# 1. dateEx.js (日付操作 & 期間判定)

JavaScript 標準の `Date` オブジェクトを拡張し、日付の生成・パース・加減算・リセット・フォーマット出力・期間内外判定を直感的なメソッドチェーンで行える日付操作ユーティリティです。

## 特徴
1. **タイムゾーンの罠（時差ずれ）を解消**
   - ハイフン・スラッシュ・日本語・8桁数値（`YYYYMMDD`）のいずれも**常にローカル時間の 00:00:00** として安全に解釈。
2. **直感的な加減算・リセット（メソッドチェーン）**
   - `.change("day", 1)`、`.change("month", -2)`、`.change("hours", 3)`
   - `.clear("hours")`（当日の 00:00:00.000 にリセット）、`.clear("date")`（当月1日にリセット）
3. **柔軟なフォーマット出力**
   - `.toString("date")`（`2025-08-16`）、`.toFormatString("{yyyy}/{MM}/{dd}({dj}) {hh}:{mm}:{ss}")`
4. **期間計算・内外判定**
   - `DateEx.between(date, "month").isBetween(targetDate)`

```javascript
const DateEx = $loadLib("dateEx.js");

const d = DateEx("2025-08-16 15:30:00")
    .change("day", 3)
    .clear("hours");

console.log(d.toString()); // "2025-08-19 00:00:00"
console.log(d.toFormatString("{yyyy}/{MM}/{dd}({dj})")); // "2025/08/19(火)"
```

---

# 2. encrypt.js (暗号化 & ハッシュ & トークン)

WebCrypto (`crypto.subtle`) を使用した AES-256-GCM 可逆暗号化（改ざん検知 AuthTag 付き）およびセキュアなランダムトークン・ハッシュ生成ユーティリティです。

## 主な API

| 関数 | 説明 | 戻り値 |
|---|---|---|
| `encrypt(plainText, secretKey)` | AES-256-GCM 暗号化（改ざん検知 AuthTag 付き） | `Promise<string>` (`iv:authTag:cipherText` 形式) |
| `decrypt(encryptedString, secretKey)` | 復号（鍵の不一致や改ざん時は `null`） | `Promise<string \| null>` |
| `randomToken(length=32)` | URL セーフなランダム文字列の生成 | `string` |
| `sha256(text)` | SHA-256 ハッシュ文字列の計算 | `string` (hex 64文字) |
| `hmac(text, key)` | HMAC-SHA256 署名の計算 | `string` (hex 64文字) |

```javascript
const encrypt = $loadLib("encrypt.js");

// 暗号化 & 復号
const secretKey = "your-32byte-or-passphrase-key";
const encrypted = await encrypt.encrypt("機密データ", secretKey);
const decrypted = await encrypt.decrypt(encrypted, secretKey); // "機密データ"

// ランダムトークン & ハッシュ
const token = encrypt.randomToken(32); // 例: "w8vB_xK9mP2qR4tV6yZ1aC3eG5hJ7kL9"
const hash = encrypt.sha256("password123");
const signature = encrypt.hmac("message", "secret-key");
```

---

# 3. format.js (文字列・数値・データ整形)

日本語 Web 開発・業務画面向けの金額・数値カンマ区切り、全角/半角変換、かな/カナ変換、バイトサイズ表記、マスキング、HTML エスケープユーティリティです。

## 主な API

| 関数 | 説明 | 例 |
|---|---|---|
| `money(val, prefix?)` / `comma(val)` | 金額・カンマ区切り | `money(1250000, "¥")` → `"¥1,250,000"` |
| `toHalfWidth(str)` | 全角英数・記号・スペースを半角へ | `toHalfWidth("ＡＢＣ１２３　！")` → `"ABC123 !"` |
| `toFullWidth(str)` | 半角英数・記号・スペースを全角へ | `toFullWidth("ABC123 !")` → `"ＡＢＣ１２３　！"` |
| `toHiragana(str)` | 全角カタカナをひらがなへ | `toHiragana("テスト")` → `"てすと"` |
| `toKatakana(str)` | ひらがなを全角カタカナへ | `toKatakana("てすと")` → `"テスト"` |
| `bytes(num, decimals=1)` | バイト数を単位表記（KB, MB, GB）へ | `bytes(1048576)` → `"1 MB"` |
| `mask(str, startKeep=3, endKeep=4, char='*')` | 伏字（マスキング） | `mask("09012345678", 3, 4)` → `"090****5678"` |
| `truncate(str, maxLen, ellipsis='...')` | 文字列切り詰め | `truncate("長い文章です", 4)` → `"長い文章..."` |
| `escapeHtml(str)` | HTML 特殊文字エスケープ | `escapeHtml("<script>")` → `"&lt;script&gt;"` |

```javascript
const format = $loadLib("format.js");

const formattedMoney = format.money(98000, "¥"); // "¥98,000"
const halfStr = format.toHalfWidth("０９０－１２３４－５６７８"); // "090-1234-5678"
const maskedPhone = format.mask(halfStr, 3, 4); // "090******5678"
const fileSize = format.bytes(2500000); // "2.4 MB"
```

---

# 4. http.js (軽量 HTTP クライアント)

`fetch` と `AbortSignal` をラップし、クエリパラメータ結合・タイムアウト・自動リトライ・JSON 送受信を簡潔に行える軽量 HTTP クライアントです。

## 主な API

| 関数 | 説明 | 戻り値 |
|---|---|---|
| `get(url, options)` | GET リクエスト | `Promise<Response>` |
| `getJson(url, options)` | GET リクエストして JSON を直接取得 | `Promise<any>` |
| `post(url, body, options)` | POST リクエスト | `Promise<Response>` |
| `postJson(url, jsonData, options)` | POST リクエスト (JSON 送信 & JSON 取得) | `Promise<any>` |
| `put(url, body, options)` | PUT リクエスト | `Promise<Response>` |
| `delete(url, options)` | DELETE リクエスト | `Promise<Response>` |
| `appendQuery(url, queryObj)` | URL にクエリパラメータを付与 | `string` |

### オプション (`options`)
- `query`: クエリパラメータオブジェクト（自動で URLSearchParams 化）
- `timeout`: タイムアウトミリ秒（デフォルト: `10000`）
- `retry`: 5xx エラー時のリトライ回数（デフォルト: `0`）
- `retryDelay`: リトライ待機ミリ秒（デフォルト: `300`）
- `headers`: 追加 HTTP ヘッダー

```javascript
const http = $loadLib("http.js");

// 1. クエリパラメータ付き GET & JSON 取得
const userData = await http.getJson("https://api.example.com/users", {
    query: { role: "admin", limit: 20 },
    timeout: 5000,
    retry: 2
});

// 2. JSON POST 送信
const result = await http.postJson("https://api.example.com/items", {
    name: "新商品",
    price: 1980
}, {
    headers: { "Authorization": "Bearer token123" }
});
```

# ◆◆◆ EOF ◆◆◆
