# minto

**minto**（minimize to = [AWS Lambda関数URL実行を]最小化する）は、**AI時代の「超簡単・固定費ほぼ0円・安全」なサーバレスWebアプリ構築環境**です。

AWS Lambdaの関数URL（URL Function）と、超軽量JavaScriptランタイム[llrt（Low Latency Runtime）](https://github.com/awslabs/llrt)を組み合わせることで、AWSの最小メモリ環境（128MB）でもコールドスタート数十msで動作し、アクセスがない時は維持費完全0円で運用可能です。

さらに、AI CLI（claude=Claude Code / agy=Antigravity2等）との親和性、充実したローカル検証環境、IPアクセス制限、S3ベースの無料データベース機構（S3Table）を備えており、現代のAI駆動開発に最適化されています。

---

## 💡 minto が提供する4つのコア価値

### 🤖 1. AI Native 開発（Claude Code / AIコマンド対応）
- **AIが迷わないシンプル構造**: `.mt.js`（JSON用）/ `.jhtml.js`（HTML用）と明確な作法（`$request()`, `$loadConf()`）により、AIがプロンプト一発でバグのないWebアプリを生成可能。
- **指示書の標準化**: `.claude/CLAUDE.md` や詳細なドキュメント群が整っており、AIエージェントに頼むだけで機能追加やリファクタリングが即座に完結します。

### 💻 2. 完全なローカル検証環境（Self-Healing 開発）
- **デプロイ不要の即時テスト**: 組み込みのローカルサーバー（`minto` コマンド）や `localAws.js` により、AWSにデプロイすることなく手元でWebアプリやS3/SQS操作を全検証可能。
- **AIによる自動修正ループ**: AIがコード生成 ➔ ローカルテスト実行 ➔ エラー検知 ➔ 自動バグ修正のループを完結できます。

### 🔒 3. IP制限 ＆ GAS認証による安全なアクセス
- **VPN / 社内IPアクセス制限**: `conf/ipLimit.json` で会社のVPNやオフィスのIP/CIDRを指定可能。API GatewayやWAFを挟まないURL Function直通でも外部アクセスを遮断（403応答）し、社内限定の安全な通信を実現します。
- **GASを使ったOAuth要らずの擬似SSO**: Google Workspace導入企業なら、GAS（Google Apps Script）を認可機関にすることで、OAuthクライアント登録なしにフィルター1行追加で「社員限定ログイン」を構築できます。

### 💰 4. S3Table ＆ LLRT による究極の低コスト（固定費0円）
- **DBサーバーの固定費0円（S3Table）**: RDSやDynamoDBを用意する必要がなく、S3をトランザクション対応のデータベースとして利用（`s3MasterTable` / `tableTool`）。何十個アプリを作っても維持費は実質0円です。
- **128MBメモリで高速起動**: LLRTの採用によりコールドスタートは数十〜数百ms。128MBメモリの最小構成で動作するためコストを極限まで圧縮します。

---

## 📊 性能実測（llrt + 128MB）

以下の環境で、AWS Lambda + URL FunctionでS3からテキストを取得しJSONを返却する処理を実行した比較結果です。

- **アーキテクチャー**: arm64
- **メモリ**: 128MB
- **ランタイム**: Amazon Linux 2023 / llrt v0.7.0-beta full-sdk

| 実行環境 | 実行パターン | Billed Duration | Init Duration | Max Memory Used |
|---|---|---|---|---|
| **llrt v0.7.0-beta full（AWS-SDK-V3）** | **コールドスタート** | **258 ms** | **67.85 ms** | **31 MB** |
| Node.js v22（AWS-SDK-V3） | コールドスタート | 4802 ms | 156.66 ms | 97 MB |

- LLRTはNode.js版（4802 ms）に比べ、**コールドスタート約258 ms・メモリ使用量31 MB**と圧巻の軽量さを誇ります。

---

## 🎯 想定用途

- **小〜中規模の社内Webアプリケーション・業務管理ツール**
- **AI（Claude Code等）を活用した爆速PoC / MVPプロトタイプ開発**
- **固定費0円で維持したい各種Webツール / Webhook受信用プロキシ**
- **Google Workspaceを導入している企業の社内限定Webツール**（GAS認証 ＋ IP制限）

---

## ⚠️ llrtの機能制限について

- Node.jsで非推奨（deprecate）となった機能や一部標準ライブラリ（`https`等）は未実装ですが、標準の `fetch` が利用可能です。
- 通常のWebアプリ開発に必要な機能（JSON/HTML返却、S3/SQS連携、HTTPリクエスト操作等）は `minto` の標準ライブラリでカバーされています。

---

## 📚 ドキュメント一覧

- **ローカル環境**
  - [mintoをローカル環境セットアップ](https://github.com/maachang/minto/blob/main/docs/setup.md)
  - [mintoのローカル開発説明](https://github.com/maachang/minto/blob/main/docs/howto.md)
- **Lambda生成・デプロイ**
  - [mintoのローカル環境のAWS Lambdaデプロイ](https://github.com/maachang/minto/blob/main/docs/lambda.md)
- **開発・動作確認**
  - [mintoのテスト環境](https://github.com/maachang/minto/blob/main/docs/testing.md)
- **モジュール（S3データベース: S3Table）**
  - [s3MasterTable.js（マスターテーブル / トランザクション対応）](https://github.com/maachang/minto/blob/main/docs/s3MasterTable.md)
  - [s3IndexTable.js（書き込み頻度が多い用途向け設計）](https://github.com/maachang/minto/blob/main/docs/s3-row-store-design.md)
- **認証 ＆ セキュリティ**
  - [IPアクセス制限（conf/ipLimit.json）](https://github.com/maachang/minto/blob/main/lambda/src/README.md#ipアクセス制限confiplimitjson)
  - [認証方式の選び方](https://github.com/maachang/minto/blob/main/docs/authStrategy.md)
  - [GASを使った擬似SSOログイン](https://github.com/maachang/minto/blob/main/docs/gasAuth.md)
  - [session.js（S3ベースセッション管理）](https://github.com/maachang/minto/blob/main/docs/session.md)
  - [admin.js（S3ベース管理者情報管理）](https://github.com/maachang/minto/blob/main/docs/admin.md)
  - [動作するサンプル一式（sample/gas-oauth-login）](https://github.com/maachang/minto/blob/main/sample/gas-oauth-login/README.md)
- **モジュール（入力検証）**
  - [validate.js（汎用オブジェクトバリデーター）](https://github.com/maachang/minto/blob/main/docs/validate.md)
