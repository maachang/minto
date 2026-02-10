# mtpk コマンド ドキュメント

## 概要

`mtpk` は、ローカルの minto 環境を AWS Lambda へデプロイするための ZIP パッケージを生成するビルドツールです。ソースコードのコピー、JS ミニファイ、JHTML→JS 変換、ETag 生成、gzip 圧縮などを行い、最終的に `mtpack.zip` を出力します。

## 前提条件

- **環境変数 `MINTO_HOME`** が設定されていること（minto のインストールディレクトリ）
- **Node.js** がインストールされていること
- **uglifyjs** コマンドが利用可能であること（`-m` / `--min` オプション使用時）
- **zip** コマンドが利用可能であること

## 使い方

```
mtpk [OPTION]...
```

## オプション一覧

| オプション | 説明 |
|---|---|
| `-m`, `--min` | JS ファイルを uglifyjs でミニファイする |
| `-e`, `--etag` | public 配下のコンテンツに対して ETag（SHA-256 ハッシュ）キャッシュを有効にする |
| `-z`, `--gz` | gz 対応の MIME タイプを持つコンテンツを gzip 圧縮する |
| `-all`, `--all` | `min`、`etag`、`gz` の全オプションを一括で有効にする |
| `-t`, `--target` | パック対象のモジュール名を指定する。`-t all` で全モジュールを対象にする。`-all` とは無関係 |
| `-h`, `--help` | ヘルプを表示する |

### 使用例

```bash
# 全オプション有効 + 全モジュール対象
mtpk -all -t all

# ミニファイのみ有効、特定モジュールを指定
mtpk -m -t myModule

# オプションなし（単純コピーのみ）
mtpk
```

## ディレクトリ構成

### 入力（ソース側）

```
$MINTO_HOME/
├── lambda/src/
│   ├── index.js          # Lambda エントリポイント
│   └── conf/             # Lambda 設定ファイル
├── modules/              # 共有ライブラリモジュール群
│   ├── <module_A>/
│   └── <module_B>/
└── tools/                # mtpk 本体が配置されるディレクトリ

<カレントディレクトリ>/
├── lib/                  # プロジェクト固有のライブラリ
├── conf/                 # プロジェクト固有の設定ファイル
└── public/               # 静的コンテンツ（HTML, CSS, JS, 画像など）
```

### 出力（ビルド成果物）

```
<カレントディレクトリ>/
├── .workDir/             # 一時作業ディレクトリ（ビルド後に削除）
└── mtpack.zip            # 最終デプロイ用 ZIP ファイル
```

### ZIP 内部構造

```
mtpack.zip
├── index.cjs             # Lambda エントリポイント（index.js → index.cjs にリネーム）
├── lib/                  # modules + カレント lib の統合
├── conf/                 # Lambda conf + カレント conf の統合
└── public/               # 静的コンテンツ
```

## ビルドパイプライン

`mtpk` は以下の順序で処理を実行します。

### 1. 作業ディレクトリの初期化

- `.workDir/` を削除し、新規作成する。

### 2. modules のパック

- `-t all` 指定時: `$MINTO_HOME/modules/` 配下の全モジュールをコピー。
- `-t <name>` 指定時: 指定されたモジュールのみコピー。
- コピー先は `.workDir/lib/`。
- JS ファイルは `-m` オプション有効時にミニファイされる。

### 3. カレント lib のパック

- `<カレント>/lib/` 配下を `.workDir/lib/` にコピー。
- JS ファイルは `-m` オプション有効時にミニファイされる。

### 4. conf のパック

- `$MINTO_HOME/lambda/src/conf/` → `.workDir/conf/` にコピー。
- `<カレント>/conf/` → `.workDir/conf/` にコピー（上書きによるオーバーライドが可能）。

### 5. public のパック

- `<カレント>/public/` 配下を `.workDir/public/` にコピー。
- ファイル種別に応じて以下の処理が適用される:

| ファイル種別 | 処理内容 |
|---|---|
| `*.mt.js`（minto 実行ファイル） | ミニファイ（`-m` 時） |
| `*.mt.html`（JHTML） | JS に変換 → ミニファイ（`-m` 時） |
| `*.js`（通常 JS） | ミニファイ（`-m` 時） |
| その他の静的ファイル | ETag ハッシュ生成（`-e` 時）、gzip 圧縮（`-z` 時、MIME 設定で gz 有効のもの） |

### 6. index.js のパック

- `$MINTO_HOME/lambda/src/index.js` を `.workDir/index.cjs` としてコピー。
- `-m` オプション有効時にミニファイされる。

### 7. ETag 設定ファイルの出力

- `-e` オプション有効時、`conf/etags.json` に各 public ファイルの SHA-256 ハッシュマップを出力する。

### 8. ZIP 圧縮・成果物の出力

- `.workDir/` 内を ZIP 圧縮し、カレントディレクトリに `mtpack.zip` として出力。
- `.workDir/` を削除して終了。

## 特殊ファイル形式

### JHTML（`.mt.html`）

minto 独自のテンプレート形式。ビルド時に `jhtml.js` モジュールによって JS ファイルに変換される。変換後のファイル拡張子は `.mt.html` → `.mt.js` に変更される。

### minto 実行ファイル（`.mt.js`）

minto フレームワークの動的実行ファイル。public 配下に配置され、Lambda 上でサーバーサイド処理として実行される。

## 注意事項

- `-t` / `--target` オプションと `-all` / `--all` オプションは独立した機能です。`-all` は min/etag/gz の一括有効化であり、モジュール選択とは関係ありません。
- conf のパックでは Lambda conf → カレント conf の順でコピーされるため、カレント側の設定で Lambda 側のデフォルト設定をオーバーライドできます。
- gzip 圧縮は MIME タイプの設定（`$mime` 関数）で `gz: true` となっているファイルタイプのみが対象です。圧縮後、元ファイルは削除され `.gz` 拡張子のファイルのみが残ります。

