# jhtml ドキュメント

jhtmlテンプレートファイル（`.mt.html`）をJavaScriptコードに変換する超シンプルなテンプレートエンジンモジュール。

---

## 概要

jhtmlテンプレートでは、HTMLテンプレート内にJavaScriptコードを埋め込む独自のテンプレート構文を解析し、実行可能なJavaScriptコードへ変換します。変換後のコードは`exports.handler`として非同期関数にラップされ、実行結果としてHTML文字列を返却します。

jhtmlテンプレートの埋め込み構文は以下のようになります。

- **テンプレート構文** — `<% %>`, `<%= %>`, `<%# %>`, `${ }` の4種類の埋め込みタグの説明と使用例
- **組み込み機能** — `$out`, `$include`, `$params`, `$request`, `$response` の説明

また、この jhtml テンプレートファイルは、aws lambda 上では利用されず `mtpk` コマンドで、対象プロジェクトをデプロイする時に `.jhtml.js` ファイルに変換される。

---

## テンプレート構文

### `<% ... %>` — コード埋め込み

テンプレート内にJavaScriptコードを埋め込みます。出力は行われず、制御構文（`if`、`for`など）の記述に使用します。

```html
<% if (showHeader) { %>
  <h1>ヘッダー</h1>
<% } %>
```

### `<%= ... %>` — 式の出力

JavaScriptの式を評価し、結果をHTML出力に挿入します。末尾のセミコロンは自動的に除去されます。

```html
<p>ユーザー名: <%= user.name %></p>
```

### `<%# ... %>` — コメント

コメント用タグ。変換後のJavaScriptには一切出力されません。

```html
<%# ここはコメントです。出力されません。 %>
```

### `${ ... }` — テンプレート式（出力のショートハンド）

`<%= ... %>`と同等の機能を持つ簡略記法です。主に変数出力時の利用を推奨します。ネストした波括弧やクォーテーション内の波括弧も正しく処理されます。

```html
<p>ユーザー名: ${user.name}</p>
<p>合計: ${items.reduce((a, b) => a + b, 0)}</p>
```

---

## テンプレート内で使用可能な組み込み機能

| 名前 | 種別 | 説明 |
|---|---|---|
| `$out` | Function | 文字列をHTML出力に追加する関数。戻り値が`$out`自身のため、`$out("abc")("def")`のようにチェーン呼び出しが可能。 |
| `$include` | Async Function | 別テンプレート（`.mt.html` / `.jhtml.js` / `.html`）を読み込んで展開する関数。パラメータ受け渡しに対応。 |
| `$params` | Object | `$include` 呼び出し時に渡されたパラメータオブジェクト（未指定時は `{}`）。 |
| `$request` | Function | リクエストオブジェクトを取得する関数（`$request()`）。 |
| `$response` | Function | レスポンスオブジェクトを取得する関数（`$response()`）。 |

---

## `$include` の使用方法

別ファイルに分割された共通部品（ヘッダー、フッター、ナビゲーション、カードなど）をテンプレート内にインクルードできます。

### 基本的な書き方（拡張子省略を推奨）

```html
${$include("./parts/header")}
```

または式タグでも利用できます（自動で `await` が補完されます）。

```html
<%= $include("./parts/header") %>
```

### なぜ拡張子省略（`${$include("./parts/header")}`）が推奨されるか

minto では、**開発中（ローカル）の実ファイルは `.mt.html`** ですが、**デプロイ時（Lambda環境）には `mtpk` コマンドにより事前コンパイルされて `.jhtml.js`** に変換されます。

`$include` は内部で拡張子を自動解決するため、コード上は拡張子を省略して記述することで、開発環境とデプロイ環境の両方で透過的かつ安全に動作します。

| パス指定例 | 開発環境（ローカル）の解決先 | デプロイ環境（Lambda）の解決先 | 備考 |
|---|---|---|---|
| `${$include("./parts/header")}` | `parts/header.mt.html` | `parts/header.jhtml.js` | **★ 推奨記法** |
| `${$include("./parts/header.mt.html")}` | `parts/header.mt.html` | `parts/header.jhtml.js`（自動読み替え） | 互換動作 |
| `${$include("./parts/footer.html")}` | `parts/footer.html` | `parts/footer.html` | 静的HTMLの読み込み |

### パラメータの受け渡し (`$params`)

第2引数にオブジェクトを渡すことで、インクルード先テンプレートで `$params` として受け取ることができます。

**呼び出し元 (index.mt.html):**
```html
${$include("./parts/header", { title: "マイページ", isLogin: true })}
<main>コンテンツ</main>
${$include("./parts/footer.html")}
```

**インクルード先 (parts/header.mt.html):**
```html
<header>
  <h1>${$params.title}</h1>
  <% if ($params.isLogin) { %>
    <a href="/logout">ログアウト</a>
  <% } %>
</header>
```

### パス指定のルール

- **相対パス**: `./header` や `../common/footer`（呼び出し元テンプレートのディレクトリ基準）
- **ルートパス**: `/parts/header`（`public/` ディレクトリ基準）
- **拡張子省略**: `${$include("./parts/header")}`（`.mt.html`、`.jhtml.js`、`.html` を自動解決）
- **静的HTMLのインクルード**: `footer.html` などのプレーンなHTMLファイルもそのままインクルード可能


---

## jhtml サンプル

**使用例:**

```html
<%
    const title = "テストタイトル";
    const items = [];
    item.push("hoge");
    item.push("moge");
%>
<html>
<body>
  <h1><%= title %></h1>
  <ul>
  <% for (let i = 0; i < items.length; i++) { %>
    <li>${items[i]}</li>
  <% } %>
  </ul>
</body>
</html>
```

---
