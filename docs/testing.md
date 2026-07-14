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
│   └── validate.test.js
│
└── e2e/                     結合テスト(実際にローカルサーバーを起動して確認)
    ├── webapps.test.js
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

### e2e/

- **webapps.test.js**: `test/e2e/.fixtures/sample-project`という最小構成のmintoプロジェクトに対して、`tools/webapps.js`(内部で`lambda/src/index.js`を使用するローカルサーバー実装)を実際に子プロセスとして起動し、実HTTPリクエスト(`fetch`)で以下を確認します。
  - `mt.js`(JSON返却)の動作
  - `mt.html`(jhtml)のURLパラメータ反映・デフォルト値
  - 存在しないパスへの404応答
  - `filter.mt.js`が存在してもtrueを返せば処理が継続すること

  ポートは`net`モジュールでOSに空きポートを割り当ててもらう方式にしており、固定ポートによる競合を避けています。

## テスト対象外にしているもの

以下は実際のAWS/Slack/GitHubへの通信が発生するため、`fetch`のモック化などの追加設計が必要になります。今回は対象外としています。

- `modules/no-sdk/*`(s3client.js, sqs.js, asv4.js)
- `modules/sdk/*`(s3sdk.js, s3MasterTable.js)
- `modules/notification/*`(sendSlack.js, sendGithub.js)
- `modules/auth/session.js`(内部で`modules/sdk/s3sdk.js`を経由してS3にアクセスするため)

必要になった場合は、`fetch`をモックに差し替える仕組みを別途検討してください。

## テストの追加方法

- ファイル名は `*.test.js` とし、`test/` 配下の対応するディレクトリ(`tools/`, `modules/`, `e2e/`)に配置してください
- `node:test`(`test`, `describe`, `before`, `after` など)と`node:assert/strict`のみを使用し、新規の依存パッケージは追加しないでください
- グローバル状態を書き換えるモジュール(`tools/localLog.js`のようにグローバルの`console`を差し替えるもの)や、`process.argv`起動時読み込みに依存するモジュール(`tools/args.js`)をテストする場合は、テストプロセス本体を汚染しないよう、`.fixtures/`配下に子プロセス用のランナースクリプトを用意し、`child_process`経由で実行してください
- 既知の不具合があり、原因は特定できているが修正の可否をまだ判断していない場合は、`test(name, { todo: "理由" }, fn)`のように`todo`オプションを付けることで、失敗しても`npm test`全体の終了コードを汚さずに記録できます(実際に`modules/csv/csvReader.js`のヘッダー解析バグ発見時にこの手法を使い、修正後に`todo`指定を解除しました)

## fixtures を `.fixtures`(隠しディレクトリ)にしている理由

`node --test`(および`bun test`)は、`test/`配下の`.js`ファイルを再帰的に自動検出してテストとして実行しようとします。子プロセス実行用のランナースクリプトやサンプルプロジェクトのファイルは通常のテストファイルではないため、そのままだと誤ってテストとして実行され失敗します。

Node.jsのテストランナーはドット始まりのディレクトリを自動検出の対象外とするため、`fixtures/`ではなく`.fixtures/`という名前にすることで、この問題を回避しています。
