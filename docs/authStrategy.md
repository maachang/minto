# minto の認証方式の選び方（Lambda関数URLというコスパ制約から）

mintoが前提とするAWS Lambda 関数URL(Function URL)は、**独自ドメインを持たない**
(`https://xxxx.lambda-url.ap-northeast-1.on.aws/`のようなランダムなAWS発行
ドメインになる)。カスタムドメインを付けるにはRoute53でのドメイン取得・
ACM証明書・CloudFrontといった追加のインフラとコストが必要になる。

この「独自ドメイン無し」という制約は、認証方式の選択に直接効いてくる。
一般的なOAuth/OIDC(Google/Microsoft/Okta等)は、事前に固定の`redirect_uri`
(コールバックURL)をアプリ側のドメインとして登録する前提のため、デプロイの
都度変わりうるLambda関数URLのランダムドメインとは相性が悪い。ALB+Cognito
やCloudflare Access等の「リバースプロキシ側でSSO認証してヘッダーに詰める」
方式も、結局はカスタムドメインをLambda関数URLの前段に置く必要があり、同じ
制約に阻まれる(このあたりの検討経緯はやり取りの中で触れた通り)。

「独自ドメイン・追加インフラを増やさずに、社内Webアプリとして十分な認証を
用意する」というコスパを優先した結果、mintoでは以下の2段構えを採用している。

## 1. GoogleWorkspaceがある会社: `gasAuth.js`(擬似SSO)

会社がGoogleWorkspaceを契約していれば、GAS(GoogleAppsScript)を「固定ドメイン
(`script.google.com`)を持ちつつ、任意の(未登録の)コールバックURLへリダイレクト
できる踏み台」として使い、ブラウザの「Googleに既にログイン済み」の状態から
メールアドレスを取得する。ドメイン登録・OAuthクライアント登録が一切不要で、
GASスクリプトを1つ貼り付けるだけで済む。

詳細は[gasAuth.md](https://github.com/maachang/minto/blob/main/docs/gasAuth.md)を参照。

## 2. GoogleWorkspaceが無い会社: ID/パスワード + `mfa.js`(第二要素)

GoogleWorkspace(または他社の同種の仕組み)が無い会社では、gasAuthのような
踏み台が使えないため、`modules/auth/password.js`によるID/パスワードログインが
基本になる。しかし**パスワード単体のログインは、GAS擬似SSOのような
「会社アカウントに紐づく安全性」が無く危険**なため、`modules/auth/mfa.js`で
第二要素(2段階認証)を追加する想定にしている。

`mfa.js`も同じコスパ制約(独自ドメイン無し・追加インフラ無し)を踏まえた設計。
Google Authenticator等の既存TOTPアプリと連携する一般的な方式ではなく、
QRコードの中身を「ただのURL」にして、スマホのカメラで読み取ってブラウザの
ブックマークに登録してもらう。以降はそのブックマークを開くたびに、
サーバー側(mfa.js)がその時点の認証コードを計算して表示し、それを
PC側のログイン画面に入力する、という流れを想定している。ネイティブアプリの
開発・配布(App Store/Google Play審査等)が不要になる点が、GAS方式における
「ドメイン不要」と同じ発想のコスパ最適化になっている。

ただし標準のTOTP(RFC 6238)とは異なる独自アルゴリズムであり、既存の認証
アプリとは互換性が無い点、QRコード由来のURL(ブックマーク)自体が「もう一つの
秘密情報」になり、漏洩した場合は端末を問わず不正利用され得る点は、既存の
議論の通り理解した上で採用する必要がある。

現状`modules/auth/mfa.js`はコード生成のロジック(`create`/`generateRandomCode`)
のみが実装・テスト済みで、QRコード表示ページやログイン画面との統合(実際の
Webアプリとしての組み込み)はまだ行っていない。QRコード描画には
`public/js/qrcode.js`([davidshimjs/qrcodejs](https://github.com/davidshimjs/qrcodejs)、
MITライセンス)を使う想定。

## まとめ

| 会社の状況 | 採用する認証方式 | 理由 |
|---|---|---|
| GoogleWorkspace契約あり | `gasAuth.js`による擬似SSO | ドメイン・OAuthクライアント登録が不要、社内アカウントの安全性をそのまま活用できる |
| GoogleWorkspace契約なし | ID/パスワード(`password.js`) + `mfa.js`による第二要素 | パスワード単体では危険なため、ドメイン・アプリ配布無しで第二要素を追加する |

いずれも「Lambda関数URLに独自ドメインを付けるコスト(Route53/ACM/CloudFront等)を
払わずに、社内Webアプリとして許容できる認証強度を確保する」という同じ方針に
基づいている。
