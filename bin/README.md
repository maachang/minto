# minto コマンド利用方法.

mintoコマンドは、以下のコマンドが存在します.
- minto
  ローカル環境でmintoを実行・確認するためのコマンド
- mtpk
  ローカルmintoをデプロイして aws lambda 用の zip ファイル化するためのコマンド
- localS3
  `modules/s3table/s3sdk.js`・`modules/s3table/s3Lock.js`が利用するS3を、実AWSに接続せず
  ファイル/ディレクトリベースでローカル動作確認するためのS3エミュレータ起動コマンド
- tableTool
  `modules/s3table/s3MasterTable.js`・`modules/s3table/s3IndexTable.js`が管理するテーブル
  定義に対して、createTable/dropTable/alterTable/alterIndexを実行するコマンド

まずこれらコマンドを利用するための設定を行うための説明を行います.

## 0. initMinto で自動セットアップする(推奨)

`git clone`した`minto`ディレクトリの直下で以下を実行すると、`MINTO_HOME`環境変数と
`PATH`へのbin追加が、利用中のシェル設定ファイル(bash: `.bashrc`(macOSのみ
`.bash_profile`)、zsh: `.zshrc`)へ自動的に追記されます(Linux・macOS・
WSL2に対応。WSL2はLinuxと同じ扱いになります)。

~~~sh
cd minto
./bin/initMinto
~~~

再実行しても二重に追記されません(マーカーコメントで既存設定を検知してスキップします)。
追記後は表示された案内に従い、`source {設定ファイル}`するかターミナルを再起動してください。

bash/zsh以外のシェルを使っている場合や、手動で設定したい場合は、以下の
「1. MINTO_HOME パスを定義します」以降を参照してください。

## 1. MINTO_HOME パスを定義します

~/.bashrc などに以下のように設定を行います.

~~~sh
export MINTO_HOME={minto 対象ディレクトリを設定}
~~~

たとえば `~/project/minto` が対象ディレクトリの場合.

~~~sh
export MINTO_HOME=~/project/minto
~~~

を設定します.

## 2. MINTO_HOME/bin/ 以下を PATH設定する.

~/.bashrc などに以下のように設定を行います.

~~~sh
export PATH=${MINTO_HOME}/bin:${PATH}
~~~

これにより、minto のコマンドが利用できます.

# 各コマンド説明.

次にmintoが提供するローカル実行向けのコマンドについて説明します.

## mkmt コマンド

新しいmintoプロジェクトを作成します.

~~~sh
cd {mintoプロジェクトを作成するディレクトリ名}
> mkmt {mintoプロジェクト名}
~~~

このコマンドにより、新しいmintoプロジェクトで必要なディレクトリが作成できます.

## mintoローカル実行用コマンド

~~~sh
> cd {mintoプロジェクト名}
> minto
~~~

このコマンドは、ローカル環境で minto 実装内容のテストを行なうためのサーバ起動コマンドです.

ここで「ローカル動作確認」対象のディレクトリをカレントディレクトリとして、実行します,

また、カレントディレクトリには、以下の構成を元に実行確認を行なう事ができます.
~~~
mkmt で作成された mintoプロジェクトによるWebアプリ実装ディレクトリ:
[current]
    +-- public: HTMLなどのWebコンテンツ配置先.
    |
    +-- lib: minto 対象の モジュールjs の配置先.
    |
    +-- conf: minto 実行に対する conf ファイル(json) 配置先.
    |     |
    |     +-- env.json: ローカル環境で 環境変数定義が設定出来ます.
    |     |
    |     +-- minto.json ローカルminto定義(bindPortなど).
    |
    +-- package.json: modules/s3table が必要とする @aws-sdk/client-s3 を
          ローカルインストールするためのもの.
~~~

`mkmt`で作成したプロジェクトには`package.json`(`@aws-sdk/client-s3`依存)が
含まれているため、`modules/s3table`(S3をデータストアとして使うモジュール群)を
利用する場合は、以下の通りローカルインストールしてください。

~~~sh
> cd {mintoプロジェクト名}
> npm install
~~~

※ ちなみに llrt だと http or https モジュールが利用できないようなので、minto=nodeしか利用できません.

## localS3 コマンド

`modules/s3table/s3sdk.js`・`modules/s3table/s3Lock.js`を使うプロジェクトを、実際のAWS S3に
接続せずローカルのファイル/ディレクトリだけで動作確認するためのS3エミュレータです。

~~~sh
> localS3
もしくは
> localS3 -p {ポート番号} -d {ストレージ保存先ディレクトリ}
~~~

- `-p` / `--port`: バインドポート(デフォルト `9911`)
- `-d` / `--dir`: バケット内容を保存するローカルディレクトリ(デフォルト `./.localS3`)

起動後、`minto`コマンド実行時に読み込まれる `conf/env.json` などで以下の環境変数を
設定することで、`s3sdk.js`/`s3Lock.js`が自動的にこのローカルサーバーへ接続します
(実AWS環境で使う場合は、この環境変数を設定しなければ通常通りAWS S3に接続します)。

~~~json
{
  "MINTO_LOCAL_S3_ENDPOINT": "http://localhost:9911"
}
~~~

AWSクレデンシャル(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)は設定不要です。
`MINTO_LOCAL_S3_ENDPOINT`が設定されており、かつ他に明示的なクレデンシャル指定が
無い場合、`s3sdk.js`/`s3Lock.js`側で自動的にダミークレデンシャルが使われます
(`localS3`側では署名検証を行わないため実害はありません)。

サポートしているS3操作は PutObject(条件付き書き込み`If-None-Match`含む)・GetObject・
DeleteObject・ListObjectsV2 の最低限のみです。それ以外の操作(バージョニング、
マルチパートアップロードなど)には対応していません。

## tableTool コマンド

`s3MasterTable.js`・`s3IndexTable.js`が管理するテーブル定義(カラム・インデックス)に
対して、テーブルの作成・削除・カラム変更・インデックス変更、およびバックアップ/
リストア(両モジュール共通)を行うコマンドです。
実装は`lambda/src/index.js`側に集約されており、AWSコンソールの「テスト実行」で
以下と同じ形のevent(JSON)を渡して実行することもできます(ローカル実行・Lambda実行
どちらでも全く同じ処理が行われます)。

~~~sh
> tableTool -t <master|index> -c <createTable|dropTable|alterTable|alterIndex|backupTable|restoreTable|listBackups|previewRestore|pruneBackups> [-n <テーブル名>] [-b <backupId>] [-k <keep>]
~~~

- `-t` / `--target`: 対象(`master` = s3MasterTable.js、`index` = s3IndexTable.js)
- `-c` / `--command`: 実行するコマンド
  - `createTable`: 定義済みで未作成のテーブルのみ作成する
  - `dropTable`: 定義から消えたテーブルを実体ごと削除する
  - `alterTable`: 既存テーブルのカラム定義差分(追加・削除)を反映する
  - `alterIndex`: 指定した1テーブルのインデックス定義差分を反映する
    (`target=index`のみ対応、`-n`必須)
  - `backupTable`: 指定した1テーブルの新しいバックアップ世代を作成する
    (`master`/`index`両対応、`-n`必須)
  - `restoreTable`: 指定した世代のバックアップ内容でテーブルを全置換する
    (`master`/`index`両対応、`-n`・`-b`必須)
  - `listBackups`: 指定した1テーブルの既存バックアップ世代(backupId)一覧を返す
    (`master`/`index`両対応、`-n`必須)
  - `previewRestore`: `restoreTable`のdry-run。現在とバックアップの行数を
    比較するだけで復元はしない(`master`/`index`両対応、`-n`・`-b`必須)
  - `pruneBackups`: 直近`keep`世代だけ残し、古いバックアップ世代を削除する
    (`master`/`index`両対応、`-n`・`-k`必須)
- `-n` / `--table`: `alterIndex`/`backupTable`/`restoreTable`/`listBackups`/
  `previewRestore`/`pruneBackups`実行時に対象とするテーブル名(必須)
- `-b` / `--backupId`: `restoreTable`/`previewRestore`実行時に対象とする
  バックアップ世代ID(必須、`backupTable`の実行結果で返る`backupId`を指定する)
- `-k` / `--keep`: `pruneBackups`実行時に残す世代数(0以上の整数、必須)

対象(`master`/`index`)ごとに、プロジェクトの`conf/table/master.json`・
`conf/table/index.json`に「あるべきテーブル定義」を記載しておく必要があります。

~~~json
{
  "options": { "bucket": "my-bucket", "prefix": "master/", "region": "ap-northeast-1" },
  "tables": {
    "users": {
      "columns": {
        "name": { "type": "string", "notNull": true },
        "email": { "type": "string", "unique": true }
      }
    }
  }
}
~~~

- `alterTable`はカラムを追加・削除する前に、対象の全テーブルを検証してから
  一括で適用する(1つでも問題があれば何も適用せず中断する)。
  - 追加するカラムが`notNull: true`の場合は`default`の指定が必須(既存行に
    値が無いままnot null違反になる問題を避けるため)
  - `primaryKey`/`unique`の変更は非対応(変更したい場合はテーブルの再作成
    (`dropTable`→`createTable`)が必要)
  - カラム削除時、既存の行データ自体は書き換えない(select結果から除外されるだけ)
- `createTable`/`dropTable`/`alterTable`はmaster/indexの対象テーブル全体を
  一括で処理するが、`alterIndex`はインデックス追加時のバックフィル処理に
  時間がかかる可能性があるため、テーブルを1つずつ指定して実行する
- `backupTable`は行データ・スキーマ定義(`target=index`の場合はインデックス
  エントリも含む)を`backup/{テーブル名}/{backupId}/`配下(`backupId`は
  実行時のUnixTimeミリ秒)にそのまま複製する(物理コピー方式)。複数世代を
  保持でき、`pruneBackups`を呼ばない限り古い世代は自動では削除されない
- `restoreTable`は指定した世代の内容で現在のテーブル(行データ・スキーマ、
  `target=index`の場合はインデックスも含む)を**全置換**する(差分マージは
  しない。実行前に現在の内容は破棄される)。整合性の取れたバックアップ/
  リストアを行うには、通常のCRUD処理が行われていないメンテナンス時間帯に
  実行する運用が前提となる
  (バックアップ/リストア実行中も通常のCRUD処理自体はロックされないため)
- `restoreTable`は破壊的操作のため、実行前に`previewRestore`で現在の行数と
  バックアップの行数を比較しておくことを推奨する(実際の復元・削除は
  一切行わないdry-run)
- `pruneBackups`は`listBackups`で古い順に取得した世代のうち、直近`keep`
  世代を残して古いものを削除する(`keep`以下の世代数なら何もしない)
- 実行中は`modules/s3table/s3Lock.js`によるメンテナンスロック(タイムアウト無し)を
  取得するため、同時に複数のテーブル管理コマンドを実行することはできない
  (他の実行が進行中の場合はエラーで即座に終了する)。異常終了等でロックが
  残ってしまった場合は、S3上の`locks/table-migration.lock`を手動で削除する

## mtpk コマンド

リリース対象の minto 環境を zip 化して、デプロイ可能にするためのコマンドです.

これも `minto` コマンドと同じように、対象の `mintoによるWebアプリ実装ディレクトリ` に移動してから、このコマンドを実行する事で lambda にデプロイ可能な zip ファイル形式で固められます.

~~~sh
> cd {mintoによるWebアプリ実装ディレクトリ}
> mtpk
~~~

これにより、コマンドを実行したカレントディレクトリに `mtproj.zip` ファイルが作成されます.

また、ここでは jsをminimize するために

- uglifyjs: https://www.npmjs.com/package/uglify-js

をインストールして、コマンド引数を設定する事で利用可能となります.
~~~sh
> npm install uglify-js -g
~~~

これを有効にする場合は以下コマンドで実施出来ます.
~~~sh
> mtpk -m
もしくは
> mtpk --min
~~~

js の minimize を適用する事で「ファイルサイズやデプロイ速度がある程度上がる（パース分等）」と言えますが、一方でException 関連の行数がわからなくなるので、ケースバイケースであると言えます.

それ以外に以下のパラメータが利用可能です.

### 1. modules デプロイ.

ローカルmintoでは modulesディレクトリ以下の js ライブラリを利用する事ができます.

一方で lambda環境で利用したい modules を定義して利用可能にする必要があります.

~~~sh
> mtpk -t {module名} -t {module名} ...
もしくは
> mtpk --target {module名} --target {module名} ...
~~~

ここでの `{module名}` は以下ディレクトリ [modules](https://github.com/maachang/minto/tree/main/modules) で定義されている `ディレクトリ名` を設定する事で、対象ディレクトリ配下の js ライブラリ群を pack化します.

また、全ての modulesを pack化したい場合は
~~~sh
> mtpk -t all
もしくは
> mtpk --target all
~~~

とします.

### 2. 静的コンテンツに対するetagのキャッシュタグを抽出.
~~~sh
> mtpk -e
もしくは
> mtpk --etag
~~~

ブラウザでキャッシュ設定を行なうhttpヘッダの `etag` がありますが、これの情報は対象コンテンツのHash値を設定する必要があります。

一方で「これを毎回HTTPResponse毎」に行なうと、毎回対象コンテンツの内容を元にHash化処理が必要になり、パフォーマンスが悪くなります。

これを `mtpkコマンド` で aws lambda デプロイ向けの zip 化において、情報を演算する事がこのパラメータができます。

対象となるのは `public` 以下で、そこで「minto js系」以外の静的コンテンツを対象として「etag対象のHash計算」がされ、それらが AWS Lambda上で利用可能となります。

### 3. 静的コンテンツに対するgzip化
~~~sh
> mtpk -z
もしくは
> mtpk --gz
~~~

gzip可能な `public` 以下の 静的コンテンツに対する gzip 利用で圧縮可能なコンテンツ(文字列系)に、予め gzip 化する場合に利用します。

これによって例えば `xxxx.html` と言うファイルが `xxxx.html.gs` と言う名前で gzip 圧縮され、これらが gzip 圧縮されたものとして、実際の aws lambda  の url function で利用できます。

またこれらは 拡張子に対して mime定義 から gzip 利用可能なものが、変換対象となります.
- txt: text/plain
- html or htm: text/html
- xhtml: application/xhtml+xml
- xml: text/xml
- json: application/json
- css: text/css
- js: text/javascript

現状では上記の拡張子(mime) が gzip 化され、そして `/conf/mime.json` で `gz=true` の内容が gzip 対象となります。

これらを行なう事で aws lambda の url function 実行において対象が 実行時に gzip 処理が不要となるので、高速にレスポンス実行ができます.

### 4. llrt互換性チェック.
~~~sh
> mtpk -c
もしくは
> mtpk --check
~~~

llrt(https://github.com/awslabs/llrt) は node.js の全機能をサポートしているわけではなく、「AWS Lambdaで動かすために不要な機能は対応しない」という方針のランタイムです。そのため node.js のローカル検証環境(`minto`コマンド)では動いても、実際に llrt 上にデプロイすると動かない実装が紛れ込むことがあります。

このオプションを指定すると、pack化(zip作成)を行なう前に、`lambda/src`・`modules`・カレントディレクトリの`lib`/`public`以下を対象に、llrtで未サポートと確認済みのAPI(`crypto.createCipheriv`、`crypto.pbkdf2`、`crypto.scrypt`、`for await`構文など)が使われていないかをチェックします。

問題が見つかった場合は、対象ファイル名・行番号・理由を表示したうえで、pack化処理そのものを中断します(zipは作成されません)。

~~~
# mtpk: {"min":false,"etag":false,"gz":false,"check":true}
# llrt compatibility check
  ... 1 issue(s) found:
  /path/to/lib/xxx.js:25 - llrtでは for-await-of 構文が動作しない事例が確認されています...
# mtpk aborted due to llrt compatibility issues.
~~~

なお、このチェックは正規表現による簡易的な静的解析であり、コメント文中の記述なども区別せず検出対象になる点にご注意ください(コメントアウトされたコードも警告として表示されます)。また、ここでの検出対象はこれまでに確認できた既知のNG項目のみであり、llrtの対応状況が今後変わった場合は、`tools/llrtCheck.js`内の検出ルール(`_RULES`)を更新する必要があります。

このチェックだけを単体で実行したい場合は、以下のようにも実行できます。
~~~sh
> node ${MINTO_HOME}/tools/llrtCheck.js
~~~

### 5. 全てを有効にしたい場合.
~~~sh
> mtpk --all
~~~

上の実行を行なう事で実際には以下のコマンドパラメータと同義になります.
~~~sh
> mtpk -m -e -z
もしくは
> mtpk --min --etag --gz
~~~

## EOF.