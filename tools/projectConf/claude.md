# ${PROJECT_NAME} プロジェクト固有の情報

このファイルは Claude Code や agy (Google Antigravity) がセッション開始時に自動的に読み込みます。ここにはプロジェクト固有の事実および minto フレームワークの利用ルールを記載します。

# プロジェクト概要

このプロジェクトは [minto](https://github.com/maachang/minto)（LLRT を使った AWS Lambda 軽量高速化フレームワーク）を使って構築されたサーバーレス Web アプリケーション / API（AWS Lambda 関数 URL または API Gateway 連携）です。

（このプロジェクト「${PROJECT_NAME}」が何をするものか、ここに記載する）

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` は AI 専用の作業領域（Git には一切コミットしない、`.gitignore` 済み）。
- セッション再起動時の引き継ぎ用メモや、調査結果・設計方針のドラフト置き場として利用する。
- プロジェクト固有の永続的な仕様は本ファイル（`CLAUDE.md`）に記載する。

# コーディング規約 & AI 開発ルール

- **独断での仕様決定禁止**: 実装を任された際、詳細仕様（データフィルタリング手法、抽出ロジック、制限値、除外基準など）を独断で決定・補完することは禁止。必ずユーザーの承認を得ること。
- **車輪の再発明の禁止**: minto が標準提供しているモジュール（`s3table`, `auth`, `notification`, `sdk`, `validate` 等）やグローバルヘルパー（`$log`, `$notifyError`, `$request()`, `$response()`）を優先活用し、独自ライブラリを安易に自作しない。
- **既存コメントの維持**: 処理内容が変わって意味が通じなくなる場合を除き、既存コメントを削除しない。
- **言語ルール**: コメントおよびユーザーへの返答・要約・説明文は常に**日本語**で記述する。
- **バグ修正フロー**: バグやエラーの原因調査を依頼された場合、即座に修正せず、まず原因と修正方針を報告して承認を得てから修正に着手する。
- **LLRT 互換性の維持**: Lambda 実行環境である LLRT の制約に従うこと（`for-await-of` 構文を避け `transformToString()` 等を使用、未サポート Node.js API を使わない）。

# minto フレームワーク原則 & アーキテクチャ

本プロジェクトは minto 環境（`${MINTO_HOME}`）上で動作します。

- **`${MINTO_HOME}/lambda/src/index.js`**: Lambda 関数 URL のリクエストハンドラ本体（デプロイ時は `mtpk` により `index.cjs` に変換）。
- **`${MINTO_HOME}/modules/`**: 共通モジュール群。`$loadLib("モジュール名.js")` でフラットにロード可能。
  - **自動フォールバック**: ローカル実行時は `${MINTO_HOME}/modules/` 配下を自動検索するため、プロジェクトの `lib/` 配下にファイルを**コピーしてはならない**。
  - **デプロイ時注意**: `mtpk` でデプロイ zip を作成する際、必要なモジュールカテゴリ（例: `-t s3table -t auth`）または `-t all` を明示的に指定する必要がある（`checkModules` コマンドで事前検査可能）。
- **`${MINTO_HOME}/public/`**: minto が提供する既製画面・静的アセット（例: `public/auth/mfa/` の MFA 画面一式など）。
  - プロジェクトの `public/` に同名ファイルがない場合、自動的に `${MINTO_HOME}/public/` 側へフォールバックされるため、コピーやラッパー作成は不要。
- **`${MINTO_HOME}/bin/`**: minto コマンド群（PATH 登録済み）。
- **`${MINTO_HOME}/docs/`**: フレームワークのドキュメント（`howto.md`, `s3MasterTable.md`, `s3-row-store-design.md`, `localAws.md`, `lambda.md` 等）。

---

# グローバルオブジェクト & 組み込みヘルパー

minto の `*.mt.js` / `*.mt.html` (JHTML) 内では以下のヘルパーが事前定義なしで利用できます。

| ヘルパー | 説明 | 主なメソッド / プロパティ |
|---|---|---|
| `$request()` | リクエスト情報の取得 | `.query(key)`, `.param(key)`, `.params()`, `.path()`, `.method()`, `.headers()`, `.header(key)`, `.body()`, `.json()`, `.ip()`, `.cookie(key)` |
| `$response()` | レスポンスの生成・返却 | `.json(data, status?)`, `.html(html, status?)`, `.redirect(url, status?)`, `.cookie(name, val, opt?)`, `.header(key, val)`, `.status(code)` |
| `$log` | 構造化 JSON ログ出力 | `$log.info(...)`, `$log.warn(...)`, `$log.error(...)`, `$log.debug(...)`<br>※ `$requestId()`, `path`, `method` が自動付与される。 |
| `$notifyError(err, context?, opt?)` | Slack への一元化エラー通知 | Webhook URL (`SLACK_WEBHOOK_URL`) または Slack Bot Token を自動判別してスタックトレース付きリッチ通知を送信 |
| `$loadLib("name.js")` | モジュールのロード | `lib/` → `${MINTO_HOME}/modules/` の順で検索してロード |
| `$loadConf("conf名")` | 設定 JSON の取得 | `conf/{conf名}.json` を取得（`.local.json` / `.test.json` があれば自動優先） |
| `$view(path, data)` | JHTML の描画 | `public/` 配下の JHTML テンプレートをサーバーサイドレンダリング |
| `$requestId()` | リクエスト ID | Snowflake / Lambda リクエスト一意 ID |
| `$require(mod)` | Node 標準ライブラリ require | `crypto`, `path`, `fs` 等の安全な呼び出し |

---

# 主要モジュール クイックリファレンス (`$loadLib`)

### 1. `s3table`（S3 データストア & ページネーション）
- **`s3MasterTable.js`**: テーブル全体を 1 つの JSON として S3 に保存。**書き込み少・読み込み多**向け（全件キャッシュ・インメモリ高速検索）。
- **`s3IndexTable.js`**: 1 行 = 1 ファイルで S3 保存。**書き込み頻度高**向け（物理インデックスによる $O(1)$ 検索、書き込み競合なし）。
- **`paginate.js`**:
  - `paginate.query(db, tableName, options)`: S3 `StartAfter` 直結の高速カーソル式（$O(1)$）およびオフセット式ページネーション。
  - `paginate.url(url, cursorOrPage, paramName)`: SSR / リンク生成用ヘルパー。
- **`s3presign.js`**: AWS SigV4 署名付き URL 生成（Direct to S3 アップロード / 一時ダウンロード）。
- **`s3Lock.js`**: S3 `IfNoneMatch` による分散排他ロック。
- **`seqId.js`**: Snowflake ID（固定長 16 桁 hex）採番。

### 2. `auth`（認証・認可 & セキュリティ）
- **`session.js`**: S3 ベースセッション管理（Cookie 自動連携、1 実行毎キャッシュ内蔵）。
- **`rbac.js`**: ロールベース認可（`hasRole`, `hasPermission`, `routeGuard`、ロール階層継承）。
- **`password.js`**: パスワードハッシュ化（SHA-256 + salt）。
- **`jwt.js`**: JWT 署名・検証（HS256）。
- **`cors.js`**: CORS プリフライト / レスポンスヘッダー組み立て。

### 3. `notification`（ログ & 通知）
- **`log.js`**: 構造化 JSON ログ出力。
- **`notifyError.js`**: Slack エラー通知。
- **`sendSlack.js`**: Slack メッセージ送信（Incoming Webhook & Bot Token `chat.postMessage`）。
- **`sendGithub.js`**: GitHub Issue 自動起票。

### 4. `validate` & `csv` & `sdk`
- **`validate.js`**: オブジェクトのスキーマ検証（string, int, float, boolean, date, enum, pattern, custom）。
- **`csv.js` / `memoryTable.js`**: CSV パース・エクスポート、インメモリソート・集計。
- **`sdk/*.js`**: AWS SDK v3 ラッパー（`sqsSdk`, `dynamoDbSdk`, `sesSdk`, `kmsSdk`, `secretsManagerSdk`, `parameterStoreSdk`, `snsSdk`）。

---

# ローカル実行・デプロイ手順

`${MINTO_HOME}/bin` に PATH が通っているため、以下のコマンドがそのまま実行できます。

- `npm install`: `@aws-sdk/client-s3` のローカルインストール。
- `minto`: ローカル開発サーバー起動（デフォルト `http://127.0.0.1:3210/`）。
  - **ホットリロード / ライブリロード内蔵**: `public/`, `lib/`, `conf/` の変更はサーバー再起動不要で即座に反映される。
- `localAws [-p 9911] [-d .localS3]`: ローカル S3 + SQS エミュレータ。
- `tableTool -t <master|index> -c <createTable|alterTable|alterIndex|dropTable|backupTable|restoreTable>`: S3 テーブル定義の管理・マイグレーション。
- `checkModules`: デプロイ前の `$loadLib` 依存関係・`-t` オプション漏れチェック。
- `mtpk [-t {カテゴリ名} ...] [-t all]`: AWS Lambda デプロイ用 zip (`mtpack.zip`) の作成。

---

# ディレクトリ構成

| ディレクトリ・ファイル | 役割 |
|---|---|
| `public/` | Web コンテンツ・動的スクリプト (`*.mt.js` / `*.mt.html`) の配置先 |
| `lib/` | プロジェクト固有の `$loadLib()` モジュールの配置先 |
| `conf/` | 設定 JSON (`minto.json`, `table/*.json`, `notify.json` 等) の配置先。<br>`*.local.json` はローカル実行時優先、`*.test.json` はテスト時優先（デプロイ zip からは自動除外）。 |
| `package.json` | ローカル開発用依存関係 |
| `.claude/CLAUDE.md` | 本ファイル |

# あえてやってないこと

（プロジェクト固有の、あえてやってない事があればこの内容を削除して記載する）

# 未対応・残課題(随時更新)

（プロジェクト固有の、未対応・課題があればこの内容を削除して記載する）
