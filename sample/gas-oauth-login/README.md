# minto + GAS(GoogleAppsScript) を使った擬似oAuthログイン サンプル

GoogleWorkspaceを会社契約している場合、契約組織内のユーザーのみが利用できる形で
GAS(GoogleAppsScript)を公開できる。この性質を利用し、GASを「認可機関」として
使うことで、ドメインを持たないLambda関数URL環境でも、GoogleWorkspaceにログイン中の
メールアドレスを取得して疑似的なSSOログインを実現する。

- GAS側の実装: `gas/gasAuth.js`(リポジトリ直下。GASに`.gs`として展開する専用コード)
- minto側の実装: `modules/auth/gasAuth.js`(GASへのURL生成・コールバック検証)
- このサンプル: 上記2つを実際に組み合わせて動かすWebアプリ一式

## ディレクトリ構成

```
sample/gas-oauth-login/
├── conf/
│   ├── app.json     (S3バケット等のアプリ設定)
│   └── env.json     (GAS連携用の環境変数。ローカル実行時に読み込まれる)
├── lib/
│   └── sessionStore.js (modules/auth/session.js のラッパー)
└── public/
    ├── index.mt.html         (ログインページ)
    ├── requestOAuth.mt.js    (GASへのURLを生成し直接リダイレクト)
    ├── resultOAuth.mt.js     (GASからのコールバックの検証・ログイン)
    ├── mypage.mt.html        (ログイン後ページ)
    ├── logout.mt.js
    └── filter.mt.js          (認証フィルター)
```

## 全体の流れ(fetch/XHR/JSONPは一切使わない)

GASのdoGetに`fetch`/`XMLHttpRequest`でアクセスすると、GASはCORSのpreflight
(OPTIONS)に対応していないため、ブラウザ側でレスポンスの読み取りがブロックされる
([参考](https://qiita.com/faunsu/items/722ab6d7f6178508851c))。過去にはこれを
JSONP(scriptタグ)で回避する方式を試みたが、JSONPは「バックグラウンドでの
script読み込み」であるためGASの初回利用許可画面(通常のページ遷移でしか
描画・完了できない)と相性が悪く、ブラウザ差異への対応も含めて複雑になっていた。

このサンプルでは、そもそも**fetch/XHR/JSONPを一切使わず、ブラウザによる
通常のページ遷移(フルナビゲーション)だけでやり取りする**方式を採る。
ページ遷移にはCORSは関係無く、GASの初回利用許可画面も普通のWebアプリアクセスの
一部として自然に表示・完了する(特別なハンドリングが不要になった)。

```
[S]=server, [B]=browser

/index -> [S]requestOAuth -(redirect)-> GAS(doGet) -(redirect)-> [S]resultOAuth -(redirect)-> /mypage
```

1. `/requestOAuth`(サーバー)がGASへの署名付きURL(`callbackURL=.../resultOAuth`を含む)
   を生成し、ブラウザをそのURLへリダイレクトする
2. ブラウザがGASのURLへ**直接ページ遷移**する(初回はここでGoogleの利用許可画面が
   表示され、承認すれば自動的に続行される)
3. GAS(`gas/gasAuth.js`)がログイン中のメールアドレスを取得・ドメイン許可チェックし、
   `HtmlService`で返すHTML内の`<script>`で`top.location.href`を使い、ブラウザを
   `callbackURL`(`/resultOAuth`)へ`mail`/`redirectToken`/`type`/`tokenKey`/`srcURL`
   付きで直接リダイレクトする
   (`HtmlService`のレスポンスはサンドボックスiframe内に描画されるため、
   `window.location`ではなく`top.location`でトップレベルウィンドウをリダイレクト
   させる必要がある点に注意)
4. `/resultOAuth`(サーバー)が`gasAuth.getOAuthMail(req)`でシグニチャーを検証し、
   認証済みメールアドレスを取得。ログインセッションを作成し、`srcURL`
   (無ければ`/mypage`)へリダイレクトする

## GASの初回利用許可について

GASのWebアプリは、あるGoogleアカウントが初めてそのGASにアクセスする際、
「利用許可(スコープ承認)」画面が挟まる。通常のページ遷移でGASへアクセスする
この方式では、この許可画面もGoogleが提供する通常のフローとしてそのまま
表示・承認・続行されるため、アプリ側で特別な対応は不要。

## セットアップ手順

### 1. GAS側の設定

1. GoogleWorkspaceで新しいGASプロジェクトを作成する
2. `gas/gasAuth.js`(リポジトリ直下)の内容をそのままGASのコードエディタに貼り付ける
3. 以下の「スクリプト プロパティ」を設定する(GASエディタの「プロジェクトの設定」から)
   - `ALLOW_AUTH_KEY_CODE`: 認証用の共有シークレット文字列(十分な長さのランダム
     文字列。例えば`crypto.randomBytes(48).toString("base64")`等で生成する)
   - `ALLOW_MAIL_DOMAINS`: 許可するメールアドレスのドメイン名(複数の場合は
     `aaa, bbb`のようにカンマ区切り)
4. 「デプロイ」→「新しいデプロイ」を実行する
   - 種類: ウェブアプリ
   - 次のユーザーとして実行: `ウェブアプリケーションにアクセスしているユーザー`
   - アクセスできるユーザー: 契約している組織内の全員
5. デプロイ後に発行されるURL(`https://script.google.com/macros/s/xxxx/exec`)を控える

### 2. minto側の設定(このサンプル)

`conf/env.json`を編集し、GAS側と対応する値を設定する。

```json
{
    "GAS_AUTH_URL": "GASデプロイ後のURL",
    "ALLOW_GAS_AUTH_KEY_CODE": "GAS側のALLOW_AUTH_KEY_CODEと同じ値"
}
```

**`ALLOW_GAS_AUTH_KEY_CODE`はGAS側の`ALLOW_AUTH_KEY_CODE`と完全に同じ値にすること**
(この値を鍵にHMAC-SHA256でシグニチャーを作成・検証しているため、GAS側とminto側で
値がずれると認証が必ず失敗する)。またこの値は共有シークレットなので、実際の値を
gitにコミットしないよう注意すること(`docs/setup.md`の`conf/env.json`の扱いを参照)。

`conf/app.json`のS3バケット名は自環境のものに合わせる。

### 3. 動作確認

ローカル実行(`minto`コマンド)、またはLambdaへのデプロイ(`mtpk`)後、`/index`へ
アクセスし「GASでログイン」からログインできることを確認する。

## モジュールの役割整理

- `modules/auth/gasAuth.js`
  - `executeOAuthURL(request, callbackPath)`: GASへ問い合わせるための署名付きURLを
    生成する。`callbackPath`はGASからの認証結果を受け取るアプリ側のパス
    (例: `"/resultOAuth"`)で必須。
  - `getOAuthMail(request)`: GASからのコールバック(`request.params()`の
    `mail`/`redirectToken`/`type`/`tokenKey`、失敗時は`error`)を検証し、
    認証済みメールアドレスを返す(検証失敗時は`HttpError`をthrow)。セッション
    生成等のログイン処理は行わないため、取得したメールアドレスを使ってどう
    ログインさせるかは呼び出し側(このサンプルでは`resultOAuth.mt.js`)の自由。
  - `allowAccountDataURL()`: GASの利用許可画面へ直接アクセスするためのURLを生成する
    (通常のページ遷移方式に変更した現在は必須ではないが、任意のタイミングで
    明示的に許可させたい場合向けに残してある)
  - `encodeRedirectUrlParams(url)`: 元々アクセスしたかったURL(`srcURL`)へ
    リダイレクトする際に、パスとパラメータを安全に再エンコードするヘルパー
- `modules/auth/gasAuthSig.js`: トークン・セッションIDの生成に使う軽量な
  ハッシュ/エンコードの部品(`modules/auth/gasAuth.js`が内部で利用)
- `modules/auth/convb.js`: 汎用バイナリエンコード/デコードライブラリ
  (`gasAuthSig.js`が内部で利用)

## シグニチャー検証の仕組み(GAS側・minto側で対応関係にある実装)

- minto側`createSendToken`は、`target`/`tokenKeyCode`に加えて、それ以外の
  追加パラメータ(`callbackURL`・`srcURL`等)を**キー名の昇順で全て**signatureに
  連結してHMAC-SHA256を計算する。
- GAS側`isAuthRequestAccessToken`もこれに合わせて、認証管理用パラメータ
  (`target`/`request-token-key`/`request-token`)以外の全パラメータをキー名の
  昇順でsignatureに連結する汎用実装にしてある。これにより、将来
  `executeOAuthURL`に新しいパラメータを追加しても、GAS側の対応漏れが起きない。
- `redirectToken`(GAS→minto側の戻りの検証)は`requestTokenKey`/`type`に加えて
  `mail`もシグニチャーの対象に含めている。これにより、有効な`redirectToken`/
  `tokenKey`を得た後で`mail`パラメータだけを別の値に差し替えるなりすましを防いでいる。
