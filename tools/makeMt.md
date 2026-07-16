# mkmt - minto プロジェクト作成コマンド

## 概要

`mkmt` は、minto プロジェクトの雛形を作成するコマンドラインツールです。指定したプロジェクト名でディレクトリ構造と初期設定ファイルを自動生成します。

またこのコマンドで作成されたプロジェクトは プロジェクトカレントディレクトリ以下で `minto` コマンドを実施する事で、ローカル上で minto シミュレーターが軌道して、テストする事が可能となります。

## 使い方

```
mkmt [PROJECT NAME]
```

### 引数

| 引数 | 説明 |
|------|------|
| `PROJECT NAME` | 作成する minto プロジェクトの名前（必須） |

### オプション

| オプション | 説明 |
|------------|------|
| `-h`, `--help` | ヘルプメッセージを表示する |

## 実行例

```bash
# プロジェクトを作成する
> mkmt testProject
[success] testProject project created.
  > cd testProject && npm install

# ヘルプを表示する
> mkmt -h
```

## 生成されるディレクトリ構造

コマンドを実行すると、以下のディレクトリとファイルが生成されます。

```
<PROJECT NAME>/
├── public/          # 公開用静的ファイル格納ディレクトリ
├── lib/             # ライブラリ格納ディレクトリ
├── conf/            # 設定ファイル格納ディレクトリ
│   ├── env.json     # 環境設定ファイル
│   └── minto.json   # minto サーバー設定ファイル
├── package.json     # modules/s3table が必要とする @aws-sdk/client-s3 の
│                       ローカルインストール用
└── .claude/
    └── CLAUDE.md    # Claude Code がセッション開始時に自動読み込みする
                        プロジェクト固有情報ファイルの雛形
```

## テンプレートファイルについて

`package.json`・`.claude/CLAUDE.md`は、`tools/projectConf/`配下に置かれた
テンプレートファイル(`package.json`、`claude.md`)から生成されます。
テンプレート内の`${PROJECT_NAME}`のような`${変数名}`は、生成時にプロジェクト名等へ
置き換えられます。

雛形の内容を変更したい場合は、`tools/projectConf/`配下の該当ファイルを
直接編集してください(`mkmt`のソースコードを変更する必要はありません)。

## 生成される設定ファイル

### conf/env.json

環境固有の設定を記述するファイルです。`modules/s3table`(S3をデータストアとして使うモジュール群)のローカル検証環境(`localS3`)向けの環境変数がデフォルトで設定されます。

```json
{
    "MINTO_LOCAL_S3_ENDPOINT": "http://localhost:9911"
}
```

AWSクレデンシャルは設定不要です(`MINTO_LOCAL_S3_ENDPOINT`設定時は`s3sdk.js`/`s3Lock.js`側が自動的にダミー値を使います)。`modules/s3table`を利用しない場合は`MINTO_LOCAL_S3_ENDPOINT`を削除しても問題ありません。実際のAWS S3を使う場合は`AWS_PROFILE`(`~/.aws/credentials`のプロファイル名)を追加してください。詳しくは[docs/localS3.md](https://github.com/maachang/minto/blob/main/docs/localS3.md)・[docs/setup.md](https://github.com/maachang/minto/blob/main/docs/setup.md)を参照してください。

### package.json

`modules/s3table`が実行時に必要とする`@aws-sdk/client-s3`を、プロジェクトローカルへ`npm install`できるようにするためのファイルです(ローカル検証専用。AWS Lambda本番実行時は`llrt-lambda-{cpu名}-full-sdk.zip`のLayerが`@aws-sdk/client-s3`を提供するため、このファイル自体はデプロイパッケージ(`mtpk`)には含まれません)。

```json
{
    "name": "<PROJECT NAME>",
    "version": "1.0.0",
    "private": true,
    "dependencies": {
        "@aws-sdk/client-s3": "latest"
    }
}
```

生成後は以下でインストールしてください。

```bash
> cd <PROJECT NAME>
> npm install
```

### .claude/CLAUDE.md

Claude Codeがセッション開始時に自動的に読み込む、プロジェクト固有情報ファイルの雛形です。プロジェクト概要・ディレクトリ構成・コーディング規約等のセクションが空欄付きで用意されるので、プロジェクトの内容に合わせて編集してください。

### conf/minto.json

minto サーバーの設定を記述するファイルです。初期状態ではバインドポートのみが定義されます。

```json
{
    "bindPort": 3210
}
```

| プロパティ | 型 | デフォルト値 | 説明 |
|------------|------|--------------|------|
| `bindPort` | number | `3210` | サーバーがリッスンするポート番号 |

## エラーケース

| エラーメッセージ | 原因 |
|------------------|------|
| `[ERROR] Project name not set.` | プロジェクト名が指定されていない |
| `[ERROR] Project directory already exists: <name>` | 同名のディレクトリが既に存在する |
| `[ERROR] Failed to create project directory: <name>` | ディレクトリの作成に失敗した（権限不足など） |
