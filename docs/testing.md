# minto のテスト環境

このドキュメントでは、`lambda/src`・`modules`・`tools` の動作確認を行うためのテスト環境について説明します。

## 目次

- [テストの実行方法](#テストの実行方法)
- [採用している仕組み](#採用している仕組み)
- [ディレクトリ構成](#ディレクトリ構成)
- [各テストの内容](#各テストの内容)
- [テスト対象外にしているもの](#テスト対象外にしているもの)
- [テストの追加方法](#テストの追加方法)
- [fixtures を `.fixtures`(隠しディレクトリ)にしている理由](#fixtures-を-fixtures隠しディレクトリにしている理由)

## テストの実行方法

プロジェクトルートで以下のいずれかを実行します。

~~~sh
npm test
~~~

または

~~~sh
node --test
~~~

`tools` はNode.js/Bun.js両方で動作させる方針のため、Bunでも同様に実行できます。

~~~sh
bun test
~~~

いずれも `test/` 配下を自動的に再帰検出して実行します(個別ファイルを指定する場合は `node --test test/tools/args.test.js` のように直接パスを渡してください)。

## 採用している仕組み

- 新規の依存パッケージは追加せず、Node.js標準の `node:test` / `node:assert/strict` のみを使用しています(`node --test` と `bun test` の両方で同一のテストファイルがそのまま動作することを確認済みです)
- ルートの `package.json` は `npm test` 実行のためだけに追加した最小構成で、依存パッケージ(`dependencies`)は定義していません
- 例外として、`modules/sdk/*`・`modules/s3table/*`が実行時に前提とする`@aws-sdk/client-s3`のみ`devDependencies`として追加しています(後述の`s3IndexTable-crud.test.js`が実際にこのSDKを使って`tools/localS3.js`と通信するため)。`npm install`を実行すれば自動的にインストールされます

## ディレクトリ構成

~~~
test/
├── tools/                  tools/ 配下の単体テスト
│   ├── args.test.js
│   ├── xor128.test.js
│   ├── mintoUtil.test.js
│   ├── localLog.test.js
│   ├── llrtCheck.test.js
│   └── .fixtures/          テスト用の補助スクリプト(子プロセス実行用)
│
├── modules/                modules/ 配下の単体テスト
│   ├── csv.test.js
│   ├── auth-password.test.js
│   ├── auth-jwt.test.js
│   ├── http-response.test.js
│   ├── validate.test.js
│   ├── seqId.test.js
│   ├── s3IndexTable-encode.test.js
│   ├── s3IndexTable-crud.test.js
│   ├── s3MasterTable.test.js
│   └── s3MasterTable-crud.test.js
│
└── e2e/                     結合テスト(実際にローカルサーバーを起動して確認)
    ├── webapps.test.js
    ├── tableTool.test.js
    └── .fixtures/
        ├── runServer.js            テスト用サーバー起動スクリプト
        └── sample-project/         最小構成のサンプルmintoプロジェクト
            └── public/
                ├── hello.mt.js     JSON返却サンプル
                ├── index.mt.html   jhtmlサンプル
                └── filter.mt.js    フィルターサンプル(常にtrueを返す)
~~~

## 各テストの内容

### tools/

- **args.test.js**: `tools/args.js` はrequire時に`process.argv`を読み込む作りのため、実際のCLI起動を再現するように`.fixtures/argsRunner.js`を子プロセスとして起動し、様々な引数パターンでの`get`/`next`/`getArray`/`isValue`/`getFirst`/`getLast`等を検証します
- **xor128.test.js**: 乱数生成の再現性(同一seed)、`getUUID()`がRFC4122のversion(4)/variant(10)ビットに準拠したフォーマットで返却されること、`getPassword()`の文字種・桁数・境界値などを検証します
- **mintoUtil.test.js**: `existsFileSync`/`existsDirSync`/`loadJson`/`listDir`/`listFile`(再帰指定含む)を、一時ディレクトリを使って検証します
- **localLog.test.js**: `tools/localLog.js`はrequire時にグローバルの`console`を差し替える作りのため、`.fixtures/localLogRunner.js`を子プロセスとして起動して検証します。ログレベル設定によるファイル出力の抑制/許可、`console.count`のカウントアップ動作を確認します
- **llrtCheck.test.js**: `tools/llrtCheck.js`のllrt互換性チェック(未サポートAPI検出、`for await`検出、問題なしの場合の空配列返却など)を検証します

### modules/

- **csv.test.js**: `modules/csv/csvReader.js`・`csvWriter.js`・`jsonb.js`・`memoryTable.js`について、README.mdに記載の使用例をベースにパース・書き出し・エンコード/デコード・検索/更新/削除・保存/復元を検証します
- **auth-password.test.js**: `modules/auth/password.js`のPBKDF2-HMAC-SHA256によるパスワードハッシュ化・検証を検証します。`derive()`の出力がNode標準の`crypto.pbkdf2Sync`と完全に一致することも確認しています
- **auth-jwt.test.js**: `modules/auth/jwt.js`のHS256署名/検証(sign/verify)を検証します。secret不一致・期限切れ(exp)・フォーマット不正時の検証失敗、`options.noError == false`時の例外throwも確認しています
- **http-response.test.js**: `modules/http/response.js`のJSON/エラーレスポンス組み立て(`json`/`error`)を検証します。グローバルの`$response()`を呼び出し内容を記録するスタブに差し替えて検証しています
- **validate.test.js**: `modules/validate/validate.js`のスキーマベース検証(`check`)を検証します。required/type/minLen・maxLen/min・max/pattern/enum/customの各ルール、default値補完、元データを変更しないことなどを確認しています
- **seqId.test.js**: `modules/s3table/seqId.js`(Snowflake ID方式のユニークID発行、旧`autoIncrement`の代替)を検証します。固定長16桁の小文字hex文字列を返すこと、大量生成しても重複しないこと(同一ミリ秒内のシーケンス処理含む)、生成順に文字列比較で単調増加すること、`$requestId()`が使えない環境でもエラーにならないことを確認しています
- **s3MasterTable.test.js**: `modules/s3table/s3MasterTable.js`のCRUD/検索エンジン本体を、実際のS3通信を行わずインメモリのフェイクな`s3sdk`/`s3Lock`を`$loadLib`経由で注入して検証します(`s3MasterTable.js`はlistを使用しないため、s3IndexTable.jsと異なりフェイクだけでCRUD全体を実際に動かして検証できます)。createTable/insert/select/update/delete/CSV往復に加え、`flush`/`transaction`(ロック取得→fn実行→flush→ロック解放、例外時のロールバック、ロック競合時のエラー)も検証しています。
- **s3IndexTable-encode.test.js**: `modules/s3table/s3IndexTable.js`のうち、S3通信を伴わない値エンコードロジック(`encodeInt`/`encodeFloat`/`encodeString`/`encodeBoolean`/`encodeDate`)が数値順・辞書順と一致すること、`generateRowId`の一意性などを検証します
- **s3IndexTable-crud.test.js**: `modules/s3table/s3IndexTable.js`のCRUD/検索エンジン本体を検証します。`tools/localS3.js`(ローカルS3エミュレータ)を子プロセスとして起動し、実際に`@aws-sdk/client-s3`経由で通信させることで、以下を確認しています。
  - createTable/insert/select(eq検索)
  - 複合インデックス(先頭カラム範囲検索+後続カラム完全一致)
  - 範囲検索(gt/gte/lt/lte)・in検索
  - orderBy(インデックス順序利用・メモリソート双方)、offset/limit
  - groupBy + 集計(count/sum/avg/min/max)
  - update/delete
  - 行ファイルを直接削除した場合の自己修復(stale索引の自動削除)
  - createIndexによる既存行へのバックフィル、dropIndex、dropTable
  - listTables(全テーブル定義の一覧取得)、alterColumns(カラム定義の差し替え、
    削除したカラムがselect結果から除外されること)
  - seqId型カラムの自動採番、インデックス経由の範囲検索(gt)での生成順ソート確認
  - backupTable/restoreTable/listBackups(行データ・インデックス・スキーマの
    バックアップ世代管理、バックアップ時点への全置換リストア、存在しない
    backupId指定時のエラー)

  ポートは`test/e2e/webapps.test.js`と同様に`net`モジュールでOSに空きポートを割り当てる方式、ストレージ先は`os.tmpdir()`配下の一時ディレクトリを使い、テスト終了後に削除しています。
- **s3MasterTable-crud.test.js**: `modules/s3table/s3MasterTable.js`(テーブル全体1JSON方式)のCRUD/検索エンジン本体を、`s3IndexTable-crud.test.js`と同じ方式(`tools/localS3.js`を子プロセスとして起動)で検証します。
  - createTable(重複作成のエラー含む)/insert/select(全件)
  - where演算子(eq/ne/gt/gte/lt/lte/in/ni/between/regexp)
  - orderBy(asc/desc)、offset/limit、columns指定(カラム投影)
  - groupBy + 集計(count/sum/avg/min/max)
  - update/delete
  - primaryKey/uniqueカラムの重複挿入エラー
  - date型カラムのDateオブジェクトでの挿入・取得・比較
  - dropTable後のdescribeTable/selectのエラー化
  - exportCsv/importCsvによるテーブル内容の往復
  - listTables(全テーブル定義の一覧取得)、alterColumns(カラム定義の差し替え、
    削除したカラムがselect結果から除外されること)
  - seqId型カラムの自動採番、範囲検索(gt)での生成順ソート確認
  - insert/flushの反映タイミング(flushするまで実際のS3に反映されないこと)、
    transaction(実際のS3上での`master.テーブル名`ロック取得、ロック競合時のエラー)
  - backupTable/restoreTable/listBackups(行データ・スキーマのバックアップ
    世代管理、バックアップ時点への全置換リストア、backupTableがflush前の
    未反映な変更も対象に含むこと、存在しないbackupId指定時のエラー)

### e2e/

- **webapps.test.js**: `test/e2e/.fixtures/sample-project`という最小構成のmintoプロジェクトに対して、`tools/webapps.js`(内部で`lambda/src/index.js`を使用するローカルサーバー実装)を実際に子プロセスとして起動し、実HTTPリクエスト(`fetch`)で以下を確認します。
  - `mt.js`(JSON返却)の動作
  - `mt.html`(jhtml)のURLパラメータ反映・デフォルト値
  - 存在しないパスへの404応答
  - `filter.mt.js`が存在してもtrueを返せば処理が継続すること

  ポートは`net`モジュールでOSに空きポートを割り当ててもらう方式にしており、固定ポートによる競合を避けています。

- **tableTool.test.js**: `tools/tableTool.js`(テーブル管理コマンド: createTable/dropTable/alterTable/alterIndex/backupTable/restoreTable/listBackups)を、`tools/localS3.js`を子プロセスとして起動した上で、実際に`node tools/tableTool.js -t ... -c ...`を子プロセス実行して標準出力のJSON結果を検証します。以下を確認しています。
  - createTableが未作成テーブルのみを作成すること(べき等性)
  - alterTableがカラムの追加・削除を反映すること
  - alterTableがnotNullカラム追加時にdefault未指定だと検証エラーで中断すること(何も適用されない)
  - alterTableがprimaryKey/unique変更を検知すると中断すること
  - dropTableが定義から消えたテーブルを削除すること
  - target=indexでのcreateTable→alterIndexによるインデックス追加
  - backupTable/restoreTable/listBackupsの呼び出し・世代管理・JSON出力の形
    (target=master/index両方。実際の行データ・インデックスの複製内容の検証は
    s3IndexTable-crud.test.js・s3MasterTable-crud.test.js側で行う)
  - backupTable等でtableName未指定時のエラー
  - 定義ファイル(`conf/table/{target}.json`)が存在しない場合のエラー応答

  fixtureプロジェクトの`lib/`には、`modules/s3table/*.js`をコピーせず絶対パスでre-exportするスタブファイルを配置し、実体との重複・鮮度ズレを避けています。

## テスト対象外にしているもの

以下は実際のAWS/Slack/GitHubへの通信が発生するため、`fetch`のモック化などの追加設計が必要になります。今回は対象外としています。

- `modules/notification/*`(sendSlack.js, sendGithub.js)
- `modules/sdk/dynamoDbSdk.js`・`sqsSdk.js`・`snsSdk.js`・`secretsManagerSdk.js`・`parameterStoreSdk.js`・`sesSdk.js`・`kmsSdk.js`(S3以外のAWSサービス。`tools/localS3.js`はS3のみが対象のため未対応)

一方で `modules/s3table/s3sdk.js`・`s3IndexTable.js`・`s3MasterTable.js`・`s3Lock.js` は、[tools/localS3.js](https://github.com/maachang/minto/blob/main/docs/localS3.md)(ファイル/ディレクトリベースのローカルS3エミュレータ)を子プロセスとして起動することで、実AWSへの通信無しに実際の`@aws-sdk/client-s3`経由のテストが可能になっています(`s3IndexTable-crud.test.js`・`s3MasterTable-crud.test.js`を参照)。

以下はまだこの方式でのテストが未整備です。

- `modules/auth/session.js`(内部で`modules/s3table/s3sdk.js`を経由してS3にアクセスするため、同様の方式でテスト可能)

必要になった場合は、`fetch`をモックに差し替える仕組みや、上記の`localS3`を使ったテストの追加を検討してください。

## テストの追加方法

- ファイル名は `*.test.js` とし、`test/` 配下の対応するディレクトリ(`tools/`, `modules/`, `e2e/`)に配置してください
- `node:test`(`test`, `describe`, `before`, `after` など)と`node:assert/strict`のみを使用し、新規の依存パッケージは追加しないでください
- グローバル状態を書き換えるモジュール(`tools/localLog.js`のようにグローバルの`console`を差し替えるもの)や、`process.argv`起動時読み込みに依存するモジュール(`tools/args.js`)をテストする場合は、テストプロセス本体を汚染しないよう、`.fixtures/`配下に子プロセス用のランナースクリプトを用意し、`child_process`経由で実行してください
- 既知の不具合があり、原因は特定できているが修正の可否をまだ判断していない場合は、`test(name, { todo: "理由" }, fn)`のように`todo`オプションを付けることで、失敗しても`npm test`全体の終了コードを汚さずに記録できます(実際に`modules/csv/csvReader.js`のヘッダー解析バグ発見時にこの手法を使い、修正後に`todo`指定を解除しました)

## fixtures を `.fixtures`(隠しディレクトリ)にしている理由

`node --test`(および`bun test`)は、`test/`配下の`.js`ファイルを再帰的に自動検出してテストとして実行しようとします。子プロセス実行用のランナースクリプトやサンプルプロジェクトのファイルは通常のテストファイルではないため、そのままだと誤ってテストとして実行され失敗します。

Node.jsのテストランナーはドット始まりのディレクトリを自動検出の対象外とするため、`fixtures/`ではなく`.fixtures/`という名前にすることで、この問題を回避しています。
