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
    ├── requestOAuth.mt.js    (サーバー: GASへのURLを生成しリダイレクト)
    ├── requestOAuth.html     (ブラウザ: JSONPでGASへアクセス)
    ├── resultOAuth.mt.js     (サーバー: GASコールバックの検証・ログイン)
    ├── mypage.mt.html        (ログイン後ページ)
    ├── logout.mt.js
    ├── filter.mt.js          (認証フィルター)
    └── assets/
        └── jsonp.js          (ブラウザ用JSONPヘルパー)
```

## なぜこんなに複雑なのか(JSONPを使う理由)

会社契約のGoogleWorkspace配下でGASを公開した場合、`fetch`/`XMLHttpRequest`での
ドメインを超えたアクセスは全て「エラー」になる
([参考](https://qiita.com/faunsu/items/722ab6d7f6178508851c))。
また、Lambda(サーバー側)から直接GASへHTTPアクセスしても、GASのログイン判定は
「ブラウザに紐づくGoogleセッション」を見るため、サーバーサイドからのアクセスでは
意味が無い。

そのため、GASへのアクセスは**必ずブラウザ側から`<script>`タグ(JSONP)**で行う必要が
あり、以下のような複数回のリダイレクトを挟む流れになる。

```
[S]=server, [B]=browser

/index -> [S]requestOAuth -> [B]requestOAuth.html -(JSONP)-> GAS
  <a>        <redirect>           <redirect>                    |
                                                                  v
              ログイン完了画面 <- [S]resultOAuth <- [B](location.href) <-+
                <redirect>
```

## GASの初回利用許可について

GASのWebアプリは、あるGoogleアカウントが初めてそのGASにアクセスする際、
「利用許可(スコープ承認)」画面が挟まる。この画面はJSONP(scriptタグ)経由では
正しく処理できない(期待するコールバックが呼ばれないままタイムアウトする)ため、
`requestOAuth.html`では以下のように対応している。

1. まずJSONPで`target=oAuth`のURLへアクセスを試みる
2. 一定時間内にJSONPのコールバックが呼ばれなければ「未許可」とみなし、
   `target=allowAccountData`のURL(`allowAd`)への直接アクセス(別タブ)リンクを表示する
3. 利用者がそのリンクを開いて許可画面を承認する
4. 「ログイン画面に戻る」から`/index`に戻り、再度ログインをやり直す
   (許可済みであれば2回目以降はJSONPが正常に完了する)

ブラウザによって挙動差があり(Chromeは許可画面表示時もloadイベントが発火するため
タイムアウト判定に頼らざるを得ず、Firefoxはerrorイベントで即座に検知できる)、
どちらでも動くようにタイムアウト+loadイベント併用で実装している
(`public/assets/jsonp.js`参照)。

## セットアップ手順

### 1. GAS側の設定

1. GoogleWorkspaceで新しいGASプロジェクトを作成する
2. `gas/gasAuth.js`(リポジトリ直下)の内容をそのままGASのコードエディタに貼り付ける
3. 以下の「スクリプト プロパティ」を設定する(GASエディタの「プロジェクトの設定」から)
   - `ALLOW_AUTH_KEY_CODE`: 認証用の共有シークレット文字列(下記コマンドで生成)
   - `ALLOW_MAIL_DOMAINS`: 許可するメールアドレスのドメイン名(複数の場合は`aaa, bbb`のようにカンマ区切り)
4. 「デプロイ」→「新しいデプロイ」を実行する
   - 種類: ウェブアプリ
   - 次のユーザーとして実行: `ウェブアプリケーションにアクセスしているユーザー`
   - アクセスできるユーザー: 契約している組織内の全員
5. デプロイ後に発行されるURL(`https://script.google.com/macros/s/xxxx/exec`)を控える

`ALLOW_AUTH_KEY_CODE`用の文字列は、例えば以下のようなランダム文字列生成コマンドや
`crypto.randomBytes(48).toString("base64")`などで生成すればよい(十分な長さのランダム
文字列であれば方式は問わない)。

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
  - `executeOAuthURL(request)`: GASへ問い合わせるための署名付きURLを生成する
  - `getOAuthMail(request)`: GASからのコールバック(`request.params()`の
    `mail`/`redirectToken`/`type`/`tokenKey`)を検証し、認証済みメールアドレスを
    返す(検証失敗時は`HttpError`をthrow)。セッション生成等のログイン処理は
    行わないため、取得したメールアドレスを使ってどうログインさせるかは
    呼び出し側(このサンプルでは`resultOAuth.mt.js`)の自由。
  - `allowAccountDataURL()`: GASの利用許可画面へ直接アクセスするためのURLを生成する
  - `encodeRedirectUrlParams(url)`: 元々アクセスしたかったURL(`srcURL`)へ
    リダイレクトする際に、パスとパラメータを安全に再エンコードするヘルパー
- `modules/auth/gasAuthSig.js`: トークン・セッションIDの生成に使う軽量な
  ハッシュ/エンコードの部品(`modules/auth/gasAuth.js`が内部で利用)
- `modules/auth/convb.js`: 汎用バイナリエンコード/デコードライブラリ
  (`gasAuthSig.js`が内部で利用)
