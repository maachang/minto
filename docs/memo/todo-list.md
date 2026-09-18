# minto 未対応タスク・バックログ管理 (TODO)

minto フレームワークの設計思想（**「AIネイティブ・固定費ほぼ0円・超軽量(LLRT+128MB)・安全・外部npm依存ゼロ」**）に基づき、現在洗い出されている未対応課題およびバックログを管理するドキュメントです。

---

## 🚦 対応状況ステータスサマリー

| ステータス | 概要 |
|---|---|
| ⏳ **優先度: 高 (Next)** | 直近で着手すべき実用性・セキュリティ・DX向上タスク |
| 📋 **優先度: 中 (Backlog)** | 開発者体験や機能拡充、運用効率化の改善タスク |
| 💡 **優先度: 低 (Future/Ideas)** | 将来的な検討・アイデア事項 |
| ✅ **完了 (Done)** | 対応・テスト・コミット完了済み項目 |

---

## ⏳ 優先度: 高 (Next Actions)

### 1. `conf/security.json` への `rateLimit` 設定統合
- **概要**: `modules/auth/rateLimit.js` はエンドポイントから明示的に呼ぶガードを提供しているが、`conf/security.json` に設定を記述するだけでフレームワーク本体（`lambda/src/index.js`）が全リクエストへ自動適用する共通ガード機能を追加する。
- **設定例**:
  ```json
  {
    "enabled": true,
    "headers": { ... },
    "rateLimit": {
      "enabled": true,
      "limit": 60,
      "windowMs": 60000
    }
  }
  ```
- **メリット**: `filter.mt.js` や各ハンドラにコードを書かずに、設定ファイル1つで全エンドポイントの一括過剰アクセス遮断が可能になる。

### 2. 環境診断 & トラブルシュートツール (`bin/doctor`)
- **概要**: プロジェクト設定やランタイム環境の整合性を一括診断するCLIコマンド。
- **診断内容**:
  - `conf/*.json` の構文チェックおよび必須キー検証
  - LLRT非互換コードの残存検査 (`tools/llrtCheck.js` の組み込み)
  - 依存モジュールのpack設定漏れ検査 (`tools/checkModules.js` の組み込み)
  - S3/ローカルAWSエミュレータ (`localAws`) への接続疎通テスト

---

## 📋 優先度: 中 (Backlog)

### 3. 大容量CSVのストリーミング / チャンク処理
- **概要**: `modules/csv` において、大容量CSVファイルをインポート・エクスポートする際、メモリ不足（Lambda 128MB制限）にならないよう、逐次パーサーおよびストリーミング処理をサポートする。

### 4. Magic Link / メールワンタイムパスコード (OTP) 認証モジュール
- **概要**: Google Workspace未導入環境でも、メールアドレス（SES連携）のみで安全なパスワードレスログインを実現する認証ヘルパー。
- **方針**: **SMSは単価が高く導入・運用・高額請求リスクが大きいため利用せず**、低コスト（月62,000通無料/それ以降も$0.10/1,000通）な Amazon SES メールを前提とする。
- **内容**: 短期ワンタイムトークン発行、SESメール送信、セッション確立のワークフローを標準化。

### 5. プロジェクト / CRUD 画面雛形ジェネレーター (`minto create` / `minto gen`)
- **概要**: S3MasterTable / S3IndexTable と連携した一覧・登録・更新・削除の `.mt.js` および JHTML 画面一式を1コマンドで雛形出力するCLIツール。

### 6. ローカルSESエミュレータ (擬似メールボックス)
- **概要**: `tools/localAws.js` にSESの `sendMail` インターセプト機能を追加し、ローカル開発時に送信されたメール内容をローカルWebUIやログで確認可能にする。

---

## 💡 優先度: 低 (Future / Ideas)

### 7. OpenAPI (Swagger) / TypeScript 型定義の自動生成
- `modules/validate/validate.js` のスキーマ定義から、フロントエンド用の型定義（`.d.ts`）や OpenAPI JSON を自動出力する。

### 8. 0円運用監視テンプレート (IaC)
- CloudWatchアラート（月額$1超過時の予算アラート等）やLambda Function URL、S3バケットを一括作成できるCloudFormation/SAMテンプレート。

### 9. タイムスタンプ・論理削除の自動処理オプション
- S3Tableの insert/update 時に `createdAt`, `updatedAt`, `deletedAt`（ソフトデリート）を自動設定するオプション。

---

## ✅ 完了済み (Done)

- [x] **セッション固定化攻撃対策** (`modules/auth/session.js`: `regenerateCookie()`)
- [x] **レスポンスストリーミング / SSE (Server-Sent Events) 対応** (`$response().stream()`)
- [x] **セキュリティヘッダー共通設定機構** (`conf/security.json`, `$response().securityHeaders()`)
- [x] **S3 Direct-to-S3 アップロード支援** (`modules/s3table/s3presign.js`: `createPresignedPutUrl`, `createPresignedGetUrl`)
- [x] **外部API / Webhook 認証ガード** (`modules/auth/apiKey.js`, `modules/auth/webhookSig.js`)
- [x] **`tableTool` dump / import コマンド追加** (JSONL/CSV, master/index両対応, append/replaceモード)
- [x] **固定費0円の軽量インメモリ・レートリミット機構** (`modules/auth/rateLimit.js`, 429ガード)
- [x] **ドキュメント整備**: `docs/directS3Upload.md`, `docs/authApiKeyAndWebhook.md`, `docs/streamAndSecurity.md`
