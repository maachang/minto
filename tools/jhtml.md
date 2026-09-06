# jhtml ドキュメント

jhtmlテンプレートファイル（`.mt.html`）をJavaScriptコードに変換する超シンプルなテンプレートエンジンモジュール。

---

## 概要

jhtmlテンプレートでは、HTMLテンプレート内にJavaScriptコードを埋め込む独自のテンプレート構文を解析し、実行可能なJavaScriptコードへ変換します。変換後のコードは`exports.handler`として非同期関数にラップされ、実行結果としてHTML文字列を返却します。

jhtmlテンプレートの埋め込み構文は以下のようになります。

- **テンプレート構文** — `<% %>`, `<%= %>`, `<%- %>`, `<%# %>`, `${ }`, `!{ }` / `${! }` の埋め込みタグの説明と使用例
- **組み込み機能** — `$out`, `$escape` / `$escapeHtml`, `$include`, `$params`, `$request`, `$response` の説明

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

### `<%= ... %>` — 式のエスケープ出力（XSS対策）

JavaScriptの式を評価し、HTML特殊文字（`&`, `<`, `>`, `"`, `'`）をエスケープしてHTML出力に挿入します。XSS脆弱性を防ぐためデフォルトでエスケープされます。末尾のセミコロンは自動的に除去されます。

```html
<p>ユーザー名: <%= user.name %></p>
```

### `<%- ... %>` — 式のRaw出力（非エスケープ）

JavaScriptの式を評価し、エスケープを行わずにそのままHTML出力へ挿入します。HTMLタグを直接埋め込みたい場合などに使用します。

```html
<div class="content"><%- rawHtml %></div>
```

### `<%# ... %>` — コメント

コメント用タグ。変換後のJavaScriptには一切出力されません。

```html
<%# ここはコメントです。出力されません。 %>
```

### `${ ... }` — テンプレート式（エスケープ出力のショートハンド）

`<%= ... %>`と同等の機能を持つ簡略記法です。評価結果が自動でHTMLエスケープされます。主に変数出力時の利用を推奨します。ネストした波括弧やクォーテーション内の波括弧も正しく処理されます。

```html
<p>ユーザー名: ${user.name}</p>
<p>合計: ${items.reduce((a, b) => a + b, 0)}</p>
```

### `!{ ... }` / `${! ... }` — テンプレート式（Raw出力のショートハンド）

`<%- ... %>`と同等の機能を持つ簡略記法です。評価結果をエスケープせずに出力します。

```html
<div class="content">!{ rawHtml }</div>
<div class="content">${! rawHtml }</div>
```

---

## テンプレート内で使用可能な組み込み機能

| 名前 | 種別 | 説明 |
|---|---|---|
| `$out` | Function | 文字列をHTML出力に追加する関数。戻り値が`$out`自身のため、`$out("abc")("def")`のようにチェーン呼び出しが可能。 |
| `$escape` / `$escapeHtml` | Function | 文字列内のHTML特殊文字（`&`, `<`, `>`, `"`, `'`）をエスケープする関数。 |
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

## フロントエンド（ブラウザ側）ランタイム (`jhtml.browser.js`)

minto では、クライアントサイド（ブラウザ側）でも jhtml の構文や安全な HTML 生成を行える軽量ランタイム `public/js/jhtml.browser.js` を標準提供しています。外部依存なし（Pure JS、数KB）で動作します。

HTMLファイル（`*.html`）や jhtmlファイル（`*.mt.html`）等において、ブラウザ JavaScript で**「レイアウトの変更を行う＝DOM操作」**（動的DOM構築・挿入、表示切り替え、イベント委任、API通信、フォーム入出力、ポーリング等）を行う場合は、生の `document.getElementById` や生 `fetch` などをベタ書きせず、この `jhtml.browser.js` を利用します。

### 読み込み方法

minto では `${MINTO_HOME}/public/` 配下が自動フォールバック配信され、`mtpk` デプロイ時も `public/js/` は常にデプロイ zip に含まれます。そのため、HTML 内で以下を読み込むだけで即座に利用できます。

```html
<script src="/js/jhtml.browser.js"></script>
```

> **プロジェクトでのカスタマイズ（オーバーライド）**:
> もしプロジェクト側の `public/js/jhtml.browser.js` に同名ファイルを配置した場合は、プロジェクト側のファイルが優先して配信されます。

---

### 主な機能と使い方

`jhtml.browser.js` は、用途に合わせて **テンプレートリテラル** や **JHTML 構文**、各種クライアントサイドヘルパーを提供します。

#### 1. タグ付きテンプレートリテラル (`jhtml.html` / `jhtml.raw`)
JavaScript 内でサクッと安全に HTML を組み立てたい場合に最適です。式（`${...}`）は自動的に HTML エスケープされます（XSS対策）。

```javascript
const { html, raw } = jhtml;

// 自動エスケープ（XSS対策）
const userContent = '<script>alert(1)</script>';
const title = 'お知らせ';
const cardHtml = html`
  <div class="card">
    <h3>${title}</h3>
    <p>${userContent}</p>
    ${raw('<span class="badge">Safe HTML</span>')}
  </div>
`;

// 配列展開も自動連結
const listHtml = html`
  <ul>
    ${items.map(item => html`<li>${item.name}</li>`)}
  </ul>
`;
```

#### 2. JHTML テンプレート構文 (`<script type="text/jhtml">`)
HTML 側に `<% %>` や `${}` を使ったテンプレートを宣言しておき、データだけを渡してブラウザ上で動的レンダリングします。

```html
<!-- HTML 側 -->
<script type="text/jhtml" id="tpl-user-card">
  <div class="user-card <%= isActive ? 'active' : '' %>">
    <h4>${name}</h4>
    <% if (bio) { %>
      <p class="bio">${bio}</p>
    <% } %>
  </div>
</script>

<div id="userList"></div>

<!-- JavaScript 側 -->
<script>
  // DOM の ID を指定してレンダリング
  const htmlStr = await jhtml.render('tpl-user-card', {
    name: 'Taro',
    bio: 'よろしくお願いします',
    isActive: true
  });

  // または renderTo で要素へ直接挿入
  await jhtml.renderTo('userList', 'tpl-user-card', userData);
</script>
```

#### 3. DOM 操作ショートカット (`jhtml.$` / `jhtml.$$` / `jhtml.refs`)

`document.getElementById` や `querySelectorAll` の記述量を大幅に削減する極小ヘルパーです。

```javascript
const { $, $$, refs } = jhtml;

// 単一要素取得 (ID または セレクタ)
const btn = $('submitBtn');             // getElementById('submitBtn') 優先
const activeTab = $('.tab-btn.active'); // querySelector('.tab-btn.active')

// 複数要素取得 (Array.from(querySelectorAll))
const tabButtons = $$('.tab-btn');
tabButtons.forEach(b => b.classList.remove('active'));

// 複数 ID の一括取得 (オブジェクト分割代入で大量の const 宣言を1行に短縮)
const { overlay, title, progressBar, alertBox } = refs(
    'overlay', 'title', 'progressBar', 'alertBox'
);
```

#### 4. イベントリスナー & イベント委任 (`jhtml.on`)

直接要素への登録に加え、動的追加・再描画後もイベントが途切れない **イベント委任（Event Delegation）** をサポートしています。

```javascript
const { on } = jhtml;

// 直接バインド
on('.tab-btn', 'click', (e) => {
    // タブ切り替え
});

// イベント委任 (動的生成要素に対応)
// #userList 配下の .btn-delete がクリックされた時に発火
on('#userList', 'click', '.btn-delete', (e, target) => {
    console.log('削除ID:', target.dataset.id);
});
```

#### 5. 軽量 API 通信クライアント (`jhtml.api`)

ブラウザ標準の `fetch` をラップし、JSON シリアライズ/デシリアライズ、エラー判定、ローディング表示の連動を 1 行で完結させます。

```javascript
const { api } = jhtml;

// 1. GET リクエスト (自動 JSON パース)
const res = await api.get('/api/users');

// 2. POST リクエスト (自動 JSON 化 & Content-Type 付与)
await api.post('/api/users', { name: 'Yamada' });

// 3. ローディング要素との自動連動
// 通信開始時に #loadingOverlay を表示し、完了時に自動で非表示化
await api.post('/api/update', data, { loading: '#loadingOverlay' });

// 4. その他の HTTP メソッド
await api.put('/api/users/1', updateData);
await api.del('/api/users/1');
```

#### 6. フォーム入出力ユーティリティ (`jhtml.form` / `jhtml.form.fill`)

```javascript
const { form, api } = jhtml;

// フォーム入力値を一括オブジェクト化 (name/id 属性キー、checkbox/number 自動変換)
const formData = form('#userForm');
await api.post('/api/users', formData);

// オブジェクトデータをフォーム各項目へ一括反映 (fill)
const user = await api.get('/api/users/1');
form.fill('#userForm', user);
```

#### 7. 表示・スタイル制御 (`show` / `hide` / `toggle` / `addClass` / `removeClass`)

```javascript
const { show, hide, toggle, addClass, removeClass } = jhtml;

show('#loadingOverlay');         // display = 'block'
show('#loadingOverlay', 'flex'); // display = 'flex'
hide('#loadingOverlay');         // display = 'none'
toggle('#modal', isOpen);        // 真偽値で表示切り替え
addClass('.tab-btn', 'active');
removeClass('.tab-btn', 'active');
```

#### 8. 簡易リアクティブ状態 (`jhtml.state`)

Proxy を利用した極小のリアクティブオブジェクトです。プロパティを更新するだけで画面を自動再描画できます。

```javascript
const { state, renderTo, api } = jhtml;

const app = state({ users: [] }, async (prop, val) => {
    await renderTo('userList', 'tpl-user-card', { users: app.users });
});

// 代入するだけで画面が自動再描画される
app.users = await api.get('/api/users');
```

#### 9. フォーマット変換 (`jhtml.format`)

minto の `modules/util/format.js` と同等のフォーマットをブラウザ側でも行えます。

```javascript
const { format } = jhtml;

format.bytes(10485760);                      // "10.0 MB"
format.money(1250000);                       // "1,250,000"
format.truncate('長い文章です', 5);           // "長い文章..."
format.date(new Date(), 'YYYY/MM/DD HH:mm'); // "2026/09/06 12:30"
```

#### 10. プログレス監視・定期ポーリング (`jhtml.poll`)

```javascript
const { poll, api } = jhtml;

// 1秒ごとに確認し、true を返すと自動停止
const stop = poll(async () => {
    const res = await api.get('/api/task?id=123');
    $('#progressBar').style.width = `${res.progress}%`;
    return res.progress >= 100;
}, { interval: 1000, timeout: 60000 });

// 手動停止: stop();
```

#### 11. トースト & アラート通知 (`jhtml.toast` / `jhtml.alert`)

```javascript
const { toast, alert } = jhtml;

toast.success('保存しました');
toast.error('エラーが発生しました');

// アラート要素 (#statusAlert) にメッセージ注入＆自動タイマー消去
alert('#statusAlert', '保存完了', { timeout: 3000 });
```

#### 12. クライアントストレージ (`jhtml.storage`)

`localStorage` / `sessionStorage` への保存・取得を JSON 自動シリアライズ付きで行います。

```javascript
const { storage } = jhtml;

storage.set('settings', { theme: 'dark' });
const settings = storage.get('settings', { theme: 'light' });

storage.session.set('tab', 'list');
```
