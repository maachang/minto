/**
 * jhtml.browser.js
 * minto - JHTML フロントエンド（ブラウザ用）ランタイム
 * 
 * 機能:
 * 1. 【テンプレートリテラル】 jhtml.html`...` による自動エスケープ付きインラインHTML生成
 * 2. 【生HTML出力】 jhtml.raw(string)
 * 3. 【JHTMLコンパイル】 jhtml.compile(templateString) (<% %>, <%= %>, <%- %>, ${ })
 * 4. 【DOMレンダリング】 jhtml.render(elementOrId, params) / jhtml.renderTo(target, templateOrId, params)
 * 5. 【HTMLエスケープ】 jhtml.escapeHtml(string)
 */

(function (global) {
    'use strict';

    /**
     * HTML特殊文字エスケープ (XSS対策)
     * @param {*} s 対象文字列または値
     * @returns {string} エスケープ済み文字列
     */
    function escapeHtml(s) {
        if (s === undefined || s === null) return '';
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    /**
     * エスケープをスキップして生のHTMLを出力するためのオブジェクトをラップ
     * @param {*} value 生のHTML文字列
     * @returns {{ __raw: boolean, value: string }}
     */
    function raw(value) {
        return {
            __raw: true,
            value: value === undefined || value === null ? '' : String(value)
        };
    }

    /**
     * タグ付きテンプレートリテラル関数: jhtml.html`...`
     * 埋め込み式（${...}）を自動的に escapeHtml で安全にエスケープする。
     * jhtml.raw(string) または配列が渡された場合は適切に展開する。
     */
    function html(strings, ...values) {
        let result = '';
        for (let i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < values.length) {
                const val = values[i];
                if (val === undefined || val === null) {
                    continue;
                } else if (Array.isArray(val)) {
                    result += val.join('');
                } else if (typeof val === 'object' && val.__raw) {
                    result += val.value;
                } else {
                    result += escapeHtml(val);
                }
            }
        }
        return result;
    }

    /**
     * クォーテーションのエスケープ処理
     */
    function indentQuote(string, dc) {
        const len = string.length;
        if (len <= 0) return string;
        const target = dc ? '"' : "'";
        let c, j, yenLen = 0, buf = '';
        for (let i = 0; i < len; i++) {
            c = string[i];
            if (c === target) {
                if (yenLen > 0) {
                    yenLen <<= 1;
                    for (j = 0; j < yenLen; j++) buf += '\\';
                    yenLen = 0;
                }
                buf += '\\' + target;
            } else if (c === '\\') {
                yenLen++;
            } else {
                if (yenLen !== 0) {
                    for (j = 0; j < yenLen; j++) buf += '\\';
                    yenLen = 0;
                }
                buf += c;
            }
        }
        if (yenLen !== 0) {
            for (j = 0; j < yenLen; j++) buf += '\\';
        }
        return buf;
    }

    /**
     * 改行のエスケープ処理
     */
    function indentEnter(s) {
        const len = s.length;
        if (len <= 0) return s;
        let c, ret = '';
        for (let i = 0; i < len; i++) {
            c = s[i];
            if (c === '\n') {
                ret += '\\n';
            } else if (c === '\r') {
                // carriage return はスキップ
            } else {
                ret += c;
            }
        }
        return ret;
    }

    /**
     * ${ ... } -> <%= ... %> への変換 (maachang jhtml.js 互換)
     */
    function analysis$braces(jhtml) {
        let ret = '';
        let c, qt, by = false, $pos = -1, braces = 0;
        const len = jhtml.length;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if ($pos !== -1) {
                if (qt !== undefined) {
                    if (!by && qt === c) {
                        qt = undefined;
                    }
                } else if (c === '"' || c === "'") {
                    qt = c;
                } else if (c === '{') {
                    braces++;
                } else if (c === '}') {
                    braces--;
                    if (braces === 0) {
                        ret += '<%=' + jhtml.substring($pos + 2, i) + '%>';
                        $pos = -1;
                    }
                }
            } else if (c === '$' && i + 1 < len && jhtml[i + 1] === '{') {
                if (by) {
                    ret = ret.substring(0, ret.length - 1) + '${';
                    i++;
                } else {
                    $pos = i;
                }
            } else {
                ret += c;
            }
            by = (c === '\\');
        }
        if ($pos !== -1) {
            ret += jhtml.substring($pos);
        }
        return ret;
    }

    /**
     * <% ... %> の構文解析
     */
    function analysisJHtml(jhtml, out) {
        let c, n, start = -1, bef = 0, ret = '';
        const len = jhtml.length;
        let tagQt = undefined;
        let tagBy = false;

        for (let i = 0; i < len; i++) {
            c = jhtml[i];
            if (start !== -1) {
                if (tagQt !== undefined) {
                    if (!tagBy && c === tagQt) tagQt = undefined;
                    tagBy = (c === '\\');
                    continue;
                }
                if (c === '"' || c === "'" || c === '`') {
                    tagQt = c;
                    tagBy = false;
                    continue;
                }
                if (c === '%' && i + 1 < len && jhtml[i + 1] === '>') {
                    n = jhtml.substring(bef, start);
                    if (n.length > 0) {
                        if (ret.length !== 0) ret += '\n';
                        n = indentEnter(n);
                        n = indentQuote(n, true);
                        ret += out + '("' + n + '");\n';
                    }
                    bef = i + 2;

                    n = jhtml[start + 2];
                    if (n === '=') {
                        // エスケープ出力 <%= ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(';')) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += '\n';
                        ret += out + '($escape(' + code + '));\n';
                    } else if (n === '-') {
                        // 生HTML出力 <%- ... %>
                        let code = jhtml.substring(start + 3, i).trim();
                        if (code.endsWith(';')) code = code.slice(0, -1).trim();
                        if (ret.length !== 0) ret += '\n';
                        ret += out + '(' + code + ');\n';
                    } else if (n === '#') {
                        // コメント
                    } else {
                        // JSロジック <% ... %>
                        if (ret.length !== 0) ret += '\n';
                        ret += jhtml.substring(start + 2, i).trim() + '\n';
                    }

                    start = -1;
                    tagQt = undefined;
                    tagBy = false;
                    i++; // '>' をスキップ
                }
            } else if (c === '<' && i + 1 < len && jhtml[i + 1] === '%') {
                start = i;
                i++;
            }
        }

        n = jhtml.substring(bef);
        if (n.length > 0) {
            n = indentEnter(n);
            n = indentQuote(n, true);
            if (ret.length !== 0) ret += '\n';
            ret += out + '("' + n + '");\n';
        }

        return ret;
    }

    /**
     * JHTML文字列をコンパイルし、async function($params) を生成する
     * @param {string} jhtmlSource 
     * @returns {Function} async function(params): Promise<string>
     */
    function compile(jhtmlSource) {
        if (typeof jhtmlSource !== 'string') {
            throw new TypeError('[jhtml] compile: expected template source string');
        }
        const outFunc = '$out';
        const jsCode = analysisJHtml(analysis$braces(jhtmlSource), outFunc);

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        // with ($params) を利用して、テンプレート内で変数名で直接アクセス可能にする
        const fn = new AsyncFunction(
            '$params',
            '$escape',
            'if ($params === undefined || $params === null) { $params = {}; }\n' +
            'let _$outString = "";\n' +
            'const ' + outFunc + ' = function(n) { _$outString += (n !== undefined && n !== null ? n : ""); return ' + outFunc + '; };\n' +
            'with ($params) {\n' +
            jsCode + '\n' +
            '}\n' +
            'return _$outString;\n'
        );

        return function (params) {
            return fn(params || {}, escapeHtml);
        };
    }

    // コンパイル結果キャッシュ (WeakMap / Map)
    const _elementCache = new WeakMap();
    const _stringCache = new Map();

    /**
     * テンプレート（DOM要素、Element ID、またはテンプレート文字列）を指定してレンダリングする
     * @param {HTMLElement|string} target テンプレート要素またはID、またはテンプレート文字列
     * @param {Object} [params={}] 渡すデータオブジェクト
     * @returns {Promise<string>}
     */
    async function render(target, params) {
        let compiled = null;

        if (typeof target === 'string') {
            const el = typeof document !== 'undefined' ? document.getElementById(target) : null;
            if (el) {
                compiled = _elementCache.get(el);
                if (!compiled) {
                    compiled = compile(el.textContent || '');
                    _elementCache.set(el, compiled);
                }
            } else {
                // 文字列テンプレートとしてキャッシュ利用
                compiled = _stringCache.get(target);
                if (!compiled) {
                    compiled = compile(target);
                    if (_stringCache.size < 500) {
                        _stringCache.set(target, compiled);
                    }
                }
            }
        } else if (target && target.nodeType) {
            compiled = _elementCache.get(target);
            if (!compiled) {
                compiled = compile(target.textContent || '');
                _elementCache.set(target, compiled);
            }
        } else {
            throw new Error('[jhtml] render: invalid target');
        }

        return await compiled(params || {});
    }

    /**
     * 指定したDOM要素の innerHTML にレンダリング結果を直接反映するユーティリティ
     * @param {HTMLElement|string} container 表示先の親要素またはID
     * @param {HTMLElement|string} template テンプレート要素、ID、またはテンプレート文字列
     * @param {Object} [params={}] 
     */
    async function renderTo(container, template, params) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el) throw new Error('[jhtml] renderTo: container element not found: ' + container);
        const htmlStr = await render(template, params);
        el.innerHTML = htmlStr;
        return htmlStr;
    }

    /**
     * 指定したIDまたはセレクタのDOM要素を取得する ($)
     * @param {string|HTMLElement} idOrSelector 要素IDまたはセレクタ文字列
     * @returns {HTMLElement|null}
     */
    function $(idOrSelector) {
        if (!idOrSelector || typeof idOrSelector !== 'string') return idOrSelector || null;
        if (typeof document === 'undefined') return null;
        // 先頭がセレクタ文字 (#, ., [, :, >) でなければ getElementById を優先探索
        if (!/^[#\.\[:> ]/.test(idOrSelector)) {
            const el = document.getElementById(idOrSelector);
            if (el) return el;
        }
        return document.querySelector(idOrSelector);
    }

    /**
     * 指定したセレクタに合致するすべてのDOM要素を取得する ($$)
     * @param {string} selector 
     * @returns {HTMLElement[]}
     */
    function $$(selector) {
        if (!selector || typeof selector !== 'string' || typeof document === 'undefined') return [];
        return Array.from(document.querySelectorAll(selector));
    }

    /**
     * 複数の要素IDを一括取得し、オブジェクトとして返却する
     * 例: const { nameInput, submitBtn } = jhtml.refs('nameInput', 'submitBtn');
     * @param {...string} ids 
     * @returns {Object.<string, HTMLElement|null>}
     */
    function refs(...ids) {
        const result = {};
        if (typeof document === 'undefined') return result;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (typeof id === 'string') {
                result[id] = document.getElementById(id) || document.querySelector(id);
            }
        }
        return result;
    }

    /**
     * イベントリスナーを登録する（イベント委任対応）
     * 
     * 形式1（直接バインド）:
     *   jhtml.on('#btn', 'click', (e) => { ... });
     *   jhtml.on(buttonEl, 'click', (e) => { ... });
     *   jhtml.on('.items', 'click', (e) => { ... }); // 複数要素に一括登録
     * 
     * 形式2（イベント委任・動的要素対応）:
     *   // #container 配下の .btn-del がクリックされた時に発火
     *   jhtml.on('#container', 'click', '.btn-del', (e, target) => { ... });
     * 
     * @param {string|HTMLElement|Window|Document} target 対象要素、セレクタ文字列、または親要素
     * @param {string} eventName イベント名 (例: 'click', 'submit', 'input')
     * @param {string|Function} selectorOrHandler セレクタ文字列（委任時）またはイベントハンドラ
     * @param {Function} [handler] イベントハンドラ (委任時: (event, matchedTarget) => void)
     */
    function on(target, eventName, selectorOrHandler, handler) {
        if (typeof document === 'undefined') return;

        const isDelegation = typeof selectorOrHandler === 'string' && typeof handler === 'function';
        const actualSelector = isDelegation ? selectorOrHandler : null;
        const actualHandler = isDelegation ? handler : selectorOrHandler;

        if (typeof actualHandler !== 'function') {
            throw new TypeError('[jhtml] on: handler must be a function');
        }

        // 対象要素の解決
        let elements = [];
        if (typeof target === 'string') {
            elements = $$(target);
            if (elements.length === 0) {
                // セレクタに合致しない場合、IDとして試行
                const single = $(target);
                if (single) elements = [single];
            }
        } else if (target && typeof target.addEventListener === 'function') {
            elements = [target];
        } else if (Array.isArray(target) || (target && typeof target.length === 'number')) {
            elements = Array.from(target);
        }

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (!el || typeof el.addEventListener !== 'function') continue;

            if (isDelegation) {
                // イベント委任: 親要素で捕捉し、クリックされた要素またはその祖先でセレクタ判定
                el.addEventListener(eventName, function (e) {
                    const match = e.target && typeof e.target.closest === 'function'
                        ? e.target.closest(actualSelector)
                        : null;
                    if (match && el.contains(match)) {
                        actualHandler.call(match, e, match);
                    }
                });
            } else {
                // 直接バインド
                el.addEventListener(eventName, actualHandler);
            }
        }
    }

    /**
     * 軽量 API クライアント (fetch ラッパー)
     * JSON リクエスト/レスポンス、ローディング表示連動、エラーハンドリングを標準提供
     */
    async function apiRequest(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const headers = Object.assign({
            'Accept': 'application/json'
        }, options.headers || {});

        let body = options.body;
        if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
            headers['Content-Type'] = 'application/json; charset=utf-8';
            body = JSON.stringify(body);
        }

        // ローディング要素の連動（指定されている場合、表示/非表示を自動制御）
        const loadingEl = options.loading ? $(options.loading) : null;
        if (loadingEl) {
            loadingEl.style.display = options.loadingDisplay || 'flex';
        }

        try {
            const fetchFn = typeof fetch !== 'undefined' ? fetch : (global.fetch || null);
            if (!fetchFn) throw new Error('[jhtml.api] fetch API is not available');

            const res = await fetchFn(url, Object.assign({}, options, { method, headers, body }));
            const contentType = res.headers.get('content-type') || '';
            let data = null;

            if (contentType.includes('application/json')) {
                data = await res.json();
            } else {
                data = await res.text();
            }

            if (!res.ok) {
                const err = new Error(data && data.error ? data.error : `HTTP ${res.status} ${res.statusText}`);
                err.status = res.status;
                err.response = res;
                err.data = data;
                throw err;
            }

            return data;
        } finally {
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }
    }

    const api = {
        request: apiRequest,
        get: (url, options = {}) => apiRequest(url, Object.assign({}, options, { method: 'GET' })),
        post: (url, body, options = {}) => apiRequest(url, Object.assign({}, options, { method: 'POST', body })),
        put: (url, body, options = {}) => apiRequest(url, Object.assign({}, options, { method: 'PUT', body })),
        del: (url, options = {}) => apiRequest(url, Object.assign({}, options, { method: 'DELETE' })),
        delete: (url, options = {}) => apiRequest(url, Object.assign({}, options, { method: 'DELETE' }))
    };

    /**
     * フォーム・コンテナ要素内の入力要素から値を取得してオブジェクト化する
     * name属性、または id属性をキーとして抽出
     * @param {string|HTMLElement} container フォーム要素、またはコンテナ要素
     * @returns {Object.<string, *>}
     */
    function form(container) {
        const el = $(container);
        const data = {};
        if (!el || typeof el.querySelectorAll !== 'function') return data;

        const inputs = el.querySelectorAll('input, select, textarea');
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const key = input.name || input.id;
            if (!key || input.disabled) continue;

            const type = (input.type || '').toLowerCase();
            if (type === 'checkbox') {
                data[key] = input.checked;
            } else if (type === 'radio') {
                if (input.checked) {
                    data[key] = input.value;
                } else if (data[key] === undefined) {
                    data[key] = null;
                }
            } else if (type === 'number') {
                data[key] = input.value === '' ? null : Number(input.value);
            } else {
                data[key] = input.value;
            }
        }
        return data;
    }

    /**
     * オブジェクトのデータをフォーム・コンテナ内の各入力要素へ一括流し込みする
     * @param {string|HTMLElement} container フォーム要素、またはコンテナ要素
     * @param {Object} data 設定するデータオブジェクト
     */
    form.fill = function (container, data) {
        const el = $(container);
        if (!el || !data || typeof data !== 'object') return;

        for (const [key, val] of Object.entries(data)) {
            // [name="key"] または #key を探索
            const input = el.querySelector(`[name="${key}"], #${key}`);
            if (!input) continue;

            const type = (input.type || '').toLowerCase();
            if (type === 'checkbox') {
                input.checked = Boolean(val);
            } else if (type === 'radio') {
                const radio = el.querySelector(`input[type="radio"][name="${key}"][value="${val}"]`);
                if (radio) radio.checked = true;
            } else {
                input.value = val === undefined || val === null ? '' : val;
            }

            // change イベントをディスパッチ (連動処理用)
            if (typeof Event === 'function') {
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    };

    /**
     * 要素の表示・非表示・クラス操作ユーティリティ
     */
    function show(target, displayType = 'block') {
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            if (els[i] && els[i].style) els[i].style.display = displayType;
        }
    }

    function hide(target) {
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            if (els[i] && els[i].style) els[i].style.display = 'none';
        }
    }

    function toggle(target, condition, displayType = 'block') {
        const isShow = condition !== undefined ? Boolean(condition) : null;
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (!el || !el.style) continue;
            const visible = isShow !== null ? isShow : el.style.display === 'none';
            el.style.display = visible ? displayType : 'none';
        }
    }

    function addClass(target, ...classNames) {
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            if (els[i] && els[i].classList) els[i].classList.add(...classNames);
        }
    }

    function removeClass(target, ...classNames) {
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            if (els[i] && els[i].classList) els[i].classList.remove(...classNames);
        }
    }

    function toggleClass(target, className, condition) {
        const els = typeof target === 'string' ? $$(target) : (target ? [target] : []);
        for (let i = 0; i < els.length; i++) {
            if (els[i] && els[i].classList) els[i].classList.toggle(className, condition);
        }
    }

    /**
     * 簡易リアクティブ状態オブジェクトを作成する
     * オブジェクトのプロパティ変更時にコールバックが自動実行される
     * @param {Object} initialState 初期状態
     * @param {Function} [onChange] 変更時リスナー (prop, val, oldVal) => void
     * @returns {Proxy}
     */
    function state(initialState = {}, onChange) {
        const listeners = [];
        if (typeof onChange === 'function') listeners.push(onChange);

        const proxy = new Proxy(Object.assign({}, initialState), {
            set(target, prop, value) {
                const oldVal = target[prop];
                if (oldVal === value) return true;
                target[prop] = value;
                for (let i = 0; i < listeners.length; i++) {
                    listeners[i](prop, value, oldVal, target);
                }
                return true;
            }
        });

        // 監視コールバック追加メソッド
        Object.defineProperty(proxy, '$watch', {
            enumerable: false,
            value: (fn) => {
                if (typeof fn === 'function') listeners.push(fn);
                return () => {
                    const idx = listeners.indexOf(fn);
                    if (idx !== -1) listeners.splice(idx, 1);
                };
            }
        });

        return proxy;
    }

    /**
     * フォーマット変換ユーティリティ (maachang modules/format.js 互換)
     */
    const format = {
        bytes: function (bytes, decimals = 1) {
            if (bytes === 0 || bytes === '0') return '0 B';
            const num = Number(bytes);
            if (!num || isNaN(num) || num < 0) return '0 B';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
            const i = Math.floor(Math.log(num) / Math.log(k));
            const formatted = parseFloat((num / Math.pow(k, i)).toFixed(dm));
            return `${formatted} ${sizes[i] || 'PB'}`;
        },
        money: function (value, prefix = '') {
            if (value === null || value === undefined || value === '') return '';
            const parts = String(value).split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            return prefix + parts.join('.');
        },
        truncate: function (str, maxLen = 30, suffix = '...') {
            if (!str) return '';
            const s = String(str);
            return s.length > maxLen ? s.slice(0, maxLen) + suffix : s;
        },
        date: function (dateVal, pattern = 'YYYY/MM/DD HH:mm') {
            if (!dateVal) return '';
            const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
            if (isNaN(d.getTime())) return String(dateVal);

            const pad = (n) => String(n).padStart(2, '0');
            const YYYY = String(d.getFullYear());
            const MM = pad(d.getMonth() + 1);
            const DD = pad(d.getDate());
            const HH = pad(d.getHours());
            const mm = pad(d.getMinutes());
            const ss = pad(d.getSeconds());

            return pattern
                .replace('YYYY', YYYY)
                .replace('MM', MM)
                .replace('DD', DD)
                .replace('HH', HH)
                .replace('mm', mm)
                .replace('ss', ss);
        }
    };

    /**
     * 定期実行・プログレス監視ユーティリティ (jhtml.poll)
     * @param {Function} task 非同期関数。true を返すと自動停止
     * @param {Object} [options]
     * @param {number} [options.interval=1000] ポーリング間隔(ms)
     * @param {number} [options.timeout=0] タイムアウト(ms, 0=無限)
     * @returns {Function} 手動停止関数 stop()
     */
    function poll(task, options = {}) {
        const interval = options.interval || 1000;
        const timeout = options.timeout || 0;
        let timer = null;
        let isStopped = false;
        const startTime = Date.now();

        const stop = () => {
            isStopped = true;
            if (timer) clearTimeout(timer);
        };

        const tick = async () => {
            if (isStopped) return;
            if (timeout > 0 && Date.now() - startTime >= timeout) {
                stop();
                if (typeof options.onTimeout === 'function') options.onTimeout();
                return;
            }

            try {
                const done = await task();
                if (done === true) {
                    stop();
                    return;
                }
            } catch (err) {
                if (typeof options.onError === 'function') options.onError(err);
            }

            if (!isStopped) {
                timer = setTimeout(tick, interval);
            }
        };

        timer = setTimeout(tick, 0);
        return stop;
    }

    /**
     * トースト通知ユーティリティ (jhtml.toast)
     */
    function toast(message, options = {}) {
        if (typeof document === 'undefined') return;
        const type = options.type || 'info'; // 'info', 'success', 'error', 'warning'
        const duration = options.duration !== undefined ? options.duration : 3000;

        let container = document.getElementById('_jhtml_toast_container');
        if (!container) {
            container = document.createElement('div');
            container.id = '_jhtml_toast_container';
            container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(container);
        }

        const item = document.createElement('div');
        item.style.cssText = 'padding:12px 18px;border-radius:8px;font-size:14px;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);pointer-events:auto;transition:opacity 0.25s,transform 0.25s;opacity:0;transform:translateY(10px);max-width:360px;word-break:break-all;';

        const bgMap = {
            info: '#2563eb',
            success: '#16a34a',
            error: '#dc2626',
            warning: '#d97706'
        };
        item.style.backgroundColor = bgMap[type] || bgMap.info;
        item.textContent = message;

        container.appendChild(item);

        // フェードイン
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            });
        } else {
            item.style.opacity = '1';
        }

        // 自動フェードアウト
        setTimeout(() => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(10px)';
            setTimeout(() => {
                if (item.parentNode) item.parentNode.removeChild(item);
            }, 300);
        }, duration);
    }
    toast.success = (msg, opt) => toast(msg, Object.assign({}, opt, { type: 'success' }));
    toast.error = (msg, opt) => toast(msg, Object.assign({}, opt, { type: 'error' }));
    toast.warning = (msg, opt) => toast(msg, Object.assign({}, opt, { type: 'warning' }));

    /**
     * 指定した要素内にアラートメッセージを表示する (jhtml.alert)
     */
    function alert(target, message, options = {}) {
        const el = $(target);
        if (!el) return;
        const isError = options.isError || options.type === 'error';
        const timeout = options.timeout !== undefined ? options.timeout : 5000;

        el.textContent = message;
        if (isError) {
            el.classList.remove('alert-success');
            el.classList.add('alert-error');
        } else {
            el.classList.remove('alert-error');
            el.classList.add('alert-success');
        }
        el.style.display = 'block';

        if (timeout > 0) {
            if (el._alertTimer) clearTimeout(el._alertTimer);
            el._alertTimer = setTimeout(() => {
                el.style.display = 'none';
            }, timeout);
        }
    }

    /**
     * localStorage / sessionStorage ラッパー (JSON自動化)
     */
    function createStorageWrapper(isSession) {
        return {
            get: function (key, defaultValue = null) {
                if (typeof window === 'undefined') return defaultValue;
                try {
                    const st = isSession ? window.sessionStorage : window.localStorage;
                    const val = st.getItem(key);
                    return val !== null ? JSON.parse(val) : defaultValue;
                } catch (e) {
                    return defaultValue;
                }
            },
            set: function (key, value) {
                if (typeof window === 'undefined') return;
                try {
                    const st = isSession ? window.sessionStorage : window.localStorage;
                    st.setItem(key, JSON.stringify(value));
                } catch (e) {}
            },
            remove: function (key) {
                if (typeof window === 'undefined') return;
                try {
                    const st = isSession ? window.sessionStorage : window.localStorage;
                    st.removeItem(key);
                } catch (e) {}
            },
            clear: function () {
                if (typeof window === 'undefined') return;
                try {
                    const st = isSession ? window.sessionStorage : window.localStorage;
                    st.clear();
                } catch (e) {}
            }
        };
    }

    const storage = createStorageWrapper(false);
    storage.session = createStorageWrapper(true);

    // 公開API
    const jhtml = {
        escapeHtml,
        escape: escapeHtml,
        raw,
        html,
        compile,
        render,
        renderTo,
        $,
        $$,
        refs,
        on,
        api,
        form,
        show,
        hide,
        toggle,
        addClass,
        removeClass,
        toggleClass,
        state,
        format,
        poll,
        toast,
        alert,
        storage,
        analysis$braces,
        analysisJHtml
    };

    // ブラウザ環境 (window) & モジュール環境 (Node / CommonJS / ES) 両対応
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = jhtml;
    }
    if (typeof global !== 'undefined') {
        global.jhtml = jhtml;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
