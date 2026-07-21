# GoogleWorkspace企業の社内Webアプリ向け: GASを使った擬似SSOログイン

mintoは「AWS Lambda関数URL＋S3」だけで完結する軽量Webアプリ基盤ですが、
**社内向けWebアプリ**を作ろうとすると必ず「社員だけがアクセスできるログイン
機能」が必要になります。ここで問題になるのが、Lambda関数URLには**カスタム
ドメインが無い**ことが多く、通常の Google OAuth(Google Cloud Consoleでの
OAuthクライアント登録・同意画面の設定・ドメイン確認等)をフルセットで用意
するのは、ちょっとした社内ツールには明らかにオーバースペックだという点です。

mintoは、GoogleWorkspaceを契約している企業であれば標準で使える
**GAS(GoogleAppsScript)**を「認可機関」として利用することで、この問題を
ほぼゼロコストで解決します。これにより、**GoogleWorkspace企業の社内Web
アプリ開発において、mintoは「ログイン機能込みで最速に立ち上げられる」
選択肢**になります。

## なぜこれが「使いやすい」のか

- **Google Cloud側の追加設定が一切不要**: OAuthクライアントID発行も、
  同意画面の審査も、ドメイン確認も要らない。GASを1つ作ってデプロイする
  だけで、GoogleWorkspaceにログイン中の社員のメールアドレスが取得できる
- **カスタムドメイン不要**: Lambda関数URLのデフォルトURL(`*.lambda-url.*.on.aws`)
  のままで動く。社内ツールにわざわざ独自ドメインを取る必要が無い
- **アプリ側の実装はフィルターへの1行追加だけ**:
  ```js
  // public/filter.mt.js
  if (user == null) {
      gasAuth.redirectToOAuth(req, $response(), "/resultOAuth");
      return;
  }
  ```
  未ログイン判定した箇所からこれを1回呼ぶだけで、GASへのログイン導線
  (URL生成＋リダイレクト)が完結する。あとはGAS側から戻ってきた
  コールバックを`gasAuth.getOAuthMail(req)`で検証してメールアドレスを
  受け取るだけで良い
- **ドメイン許可制がそのまま「社内限定アクセス」になる**: GAS側の
  `ALLOW_MAIL_DOMAINS`スクリプトプロパティに自社ドメインを設定するだけで、
  「契約組織内の社員のみアクセス可能」という制約をそのまま利用できる
  (GAS自体がGoogleWorkspaceの権限管理下にあるため)
- **fetch/XHR/JSONPを一切使わない、シンプルな作り**: GASはCORSの
  preflightに対応していないため、素朴に`fetch`で呼ぶとハマるが、
  mintoの実装は最初から「ブラウザの通常のページ遷移(フルナビゲーション)
  だけでやり取りする」設計なので、CORSやJSONPの落とし穴を意識する必要が
  そもそも無い。GASの初回利用許可画面も、普通のWebアプリアクセスとして
  自然に表示・完了する
- **動くサンプルがそのままコピペで使える**: [`sample/gas-oauth-login/`](https://github.com/maachang/minto/tree/main/sample/gas-oauth-login)
  に、ログイン前ページ・保護ページ・フィルター・GASコールバック処理まで
  一式が揃っている

## 全体の流れ

```
[S]=server, [B]=browser

/mypage -(filter未ログイン検知)-> [S]redirectToOAuth -(redirect)-> GAS(doGet) -(redirect)-> [S]resultOAuth -(redirect)-> /mypage
```

1. 未ログインで保護対象ページへアクセスすると、フィルターが
   `gasAuth.redirectToOAuth()`を1回呼ぶだけでGASへリダイレクトする
2. ブラウザがGASのURLへ直接ページ遷移する(初回はGoogleの利用許可画面が
   表示され、承認すれば自動的に続行される。2回目以降は不要)
3. GASがログイン中のメールアドレスを取得・自社ドメインチェックし、
   結果を署名付きでアプリ側のコールバックURLへ直接リダイレクトする
4. アプリ側が`gasAuth.getOAuthMail(req)`でシグニチャーを検証し、認証済み
   メールアドレスを取得。ログインセッションを作成して元のページへ戻る

詳細な仕組み・セットアップ手順(GAS側のスクリプトプロパティ設定・デプロイ
手順・環境変数設定)は、実際に動くサンプルと合わせて
[`sample/gas-oauth-login/README.md`](https://github.com/maachang/minto/blob/main/sample/gas-oauth-login/README.md)
にまとめてある。

## セキュリティ設計の要点

- GAS⇔minto間のURL・パラメータはHMAC-SHA256による署名付きで、共有シークレット
  (GAS側`ALLOW_AUTH_KEY_CODE` / minto側`ALLOW_GAS_AUTH_KEY_CODE`、同一の値)を
  知らない第三者は偽造できない
- GAS→アプリ側への戻り(`redirectToken`)は、認証済みメールアドレス自体も
  署名対象に含めているため、正規のトークンを使い回して別人のメール
  アドレスに差し替える、といったなりすましもできない
- リクエストトークンには有効期限があり、古いリクエストの使い回しを防ぐ

## 認証ログの永続化

GAS実行環境は標準では実行ログが長期間残らないため、`gas/gasLog.js`を
併用することで、認証の成功/失敗の履歴をGoogle Drive上にユーザー単位・
月単位のJSONファイルとして永続化できる(スクリプトプロパティ
`GLOG_FOLDER_ID`に出力先フォルダIDを設定するだけ。未設定でも通常の
`console.log`相当の動作にフォールバックするため、設定は任意)。
「誰が・いつ・成功/失敗いずれで」ログインを試みたかの監査ログとして
使える。

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `gas/gasAuth.js` | GAS側の実装(GASに`.gs`として展開する専用コード) |
| `gas/gasLog.js` | GAS実行ログの永続化(Google Drive出力、任意) |
| `modules/auth/gasAuth.js` | minto側の実装(URL生成・コールバック検証) |
| `modules/auth/gasAuthSig.js` | トークン生成用の軽量ハッシュ/エンコード部品 |
| `modules/auth/convb.js` | 汎用バイナリエンコード/デコードライブラリ |
| `sample/gas-oauth-login/` | 実際に動くサンプルWebアプリ一式・詳細セットアップ手順 |
