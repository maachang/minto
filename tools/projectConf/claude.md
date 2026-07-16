# ${PROJECT_NAME} プロジェクト固有の情報

このファイルはClaude Codeがセッション開始時に自動的に読み込みます。ここにはプロジェクト固有の事実を書く。汎用的な開発知識（言語仕様・設計原則の教科書的説明など）は書かない。

# プロジェクト概要

このプロジェクトは [minto](https://github.com/maachang/minto)（llrtを使ったAWS Lambda軽量化フレームワーク）を使って構築されたWebアプリケーションです。

（このプロジェクト「${PROJECT_NAME}」が何をするものか、ここに記載する）

# 作業領域（.claudeWork）

- プロジェクト直下の `.claudeWork/` はClaude Code専用の作業領域（Gitには一切コミットしない、.gitignore済み）
- セッションが落ちて再起動すると直前の会話内容は失われるため、途中の提案・調査結果・未確定の方針などで残しておきたいものは、このフォルダにファイルとして書いておくこと
- セッション開始時、作業に関連しそうであれば `.claudeWork/` の中身を確認すること
- プロジェクト固有の永続的な事実はここではなく本ファイル（CLAUDE.md）に書く。`.claudeWork`はあくまで一時的な作業メモ置き場

# コーディング規約

- 対象プロジェクトディレクトリは、minto環境上でのプロジェクト実装なので、minto本体である `${MINTO_HOME}` 環境変数以下のプログラムが実装上必要となる.
  - ${MINTO_HOME}/lambda/src/index.js: 実際に aws lambda で関数URLとして実行されるハンドラ本体(デプロイ時は`mtpk`により`index.cjs`にリネームされる).
  - ${MINTO_HOME}/modules: mintoを支援するモジュール群が格納されており、これらは $loadLib("モジュール.js") でフラットに呼び出しができる.
    - **注意**: これは`minto`コマンドによる**ローカル実行時のみ**の挙動(`${MINTO_HOME}/modules`配下を自動フォールバック検索する)。`mtpk`でAWS Lambda用にデプロイパッケージ化する場合、`modules/`配下は`-t {カテゴリ名}`(例: `-t s3table`)や`-t all`で明示的に指定したものしかzipに含まれない。ローカルでは動くのにLambda上で`$loadLib`が失敗する場合、このデプロイオプション指定漏れを疑うこと.
  - ${MINTO_HOME}/bin: mintoのコマンドが格納されており、これらはPATHが通ってるので、フラットに実行が可能.
  - ${MINTO_HOME}/docs: mintoフレームワーク自体の機能ドキュメント(mt.js/jhtml記法、s3MasterTable.js/s3IndexTable.js等のs3table関連、テーブル管理コマンド(tableTool)、ローカル検証環境、AWS Lambdaデプロイ手順など)が格納されている。実装で迷ったらまずここを参照すること.
- これらを前提として、本プロジェクトの実装を行う.

（プロジェクト固有のコーディングルールがあればこの内容を削除して記載する）

# ローカル実行・デプロイ手順

- ローカル検証環境の起動:
  ~~~sh
  npm install    # package.json記載の@aws-sdk/client-s3をインストール(s3table利用時に必要)
  minto          # ローカルでURL Function相当の検証サーバーを起動(デフォルト http://127.0.0.1:3210/)
  ~~~
- AWS Lambdaへのデプロイパッケージ作成:
  ~~~sh
  mtpk -t all    # modules配下を全て含めてzip化する場合
  ~~~
  必要なモジュールカテゴリだけに絞りたい場合は `mtpk -t {カテゴリ名}` を対象数分指定する(詳細は`${MINTO_HOME}/bin/README.md`のmtpkコマンド節を参照)。

# ディレクトリ構成

| ディレクトリ・ファイル | 役割 |
|-------------|------|
| public | HTMLなどのWebコンテンツ・動的コンテンツ(`*.mt.js`/`*.mt.html`)の配置先 |
| lib | `$loadLib()`で読み込むモジュールJSの配置先 |
| conf | `$loadConf()`で読み込む設定JSON(`env.json`/`minto.json`/`table/*.json`等)の配置先 |
| package.json | `modules/s3table`が必要とする`@aws-sdk/client-s3`のローカルインストール用(`npm install`) |
| .claude/CLAUDE.md | 本ファイル |

# 設計原則

（プロジェクト固有の設計方針があればこの内容を削除して記載する）

# あえてやってないこと

（プロジェクト固有の、あえてやってない事があればこの内容を削除して記載する）

# 未対応・残課題(随時更新)

（プロジェクト固有の、未対応・課題があればこの内容を削除して記載する）
