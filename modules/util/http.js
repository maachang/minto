/**
 * AIメモ:
 * - http.js: タイムアウト・リトライ制御・クエリ付与・JSON送受信を備えた軽量 HTTP クライアント。
 * - ゼロ依存 (Bun/Node 標準の fetch / AbortSignal のみ)。
 * - 主な機能:
 *   - http.get(url, { query, timeout, retry, headers })
 *   - http.postJson(url, data, { timeout, headers })
 *   - http.post(url, body, options)
 *   - http.put(url, body, options)
 *   - http.delete(url, options)
 * - CommonJS 形式。
 */

'use strict';

/**
 * URL にクエリパラメータを結合
 * @param {string} url 
 * @param {Object} [query] 
 * @returns {string}
 */
function appendQuery(url, query) {
    if (!query || typeof query !== 'object') return url;
    const urlObj = new URL(url, 'http://localhost');
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
            urlObj.searchParams.append(k, String(v));
        }
    }
    return url.startsWith('http') ? urlObj.toString() : urlObj.pathname + urlObj.search;
}

/**
 * タイムアウト・リトライ付きの fetch リクエスト実行
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function executeFetch(url, options = {}) {
    const timeoutMs = options.timeout || 10000;
    const retries = options.retry || 0;
    const retryDelay = options.retryDelay || 300;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);

        try {
            const fetchOptions = {
                ...options,
                signal: controller.signal
            };

            const response = await fetch(url, fetchOptions);
            clearTimeout(timer);

            // 5xx 系サーバーエラー時はリトライ対象
            if (!response.ok && response.status >= 500 && attempt < retries) {
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
            }

            return response;
        } catch (err) {
            clearTimeout(timer);
            lastError = err;
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }
    }

    throw lastError || new Error(`Failed to fetch ${url}`);
}

/**
 * GET リクエスト
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function get(url, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'GET',
        ...options
    });
}

/**
 * GET リクエストして JSON を直接取得
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<any>}
 */
async function getJson(url, options = {}) {
    const res = await get(url, {
        ...options,
        headers: {
            'Accept': 'application/json',
            ...(options.headers || {})
        }
    });
    return res.json();
}

/**
 * POST リクエスト
 * @param {string} url 
 * @param {any} body 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function post(url, body, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'POST',
        body,
        ...options
    });
}

/**
 * POST リクエスト (JSON 送信 ＆ JSON 受信)
 * @param {string} url 
 * @param {Object} jsonData 
 * @param {Object} [options] 
 * @returns {Promise<any>}
 */
async function postJson(url, jsonData, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    const res = await executeFetch(fullUrl, {
        method: 'POST',
        body: JSON.stringify(jsonData),
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
        }
    });
    return res.json();
}

/**
 * PUT リクエスト
 * @param {string} url 
 * @param {any} body 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function put(url, body, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'PUT',
        body,
        ...options
    });
}

/**
 * DELETE リクエスト
 * @param {string} url 
 * @param {Object} [options] 
 * @returns {Promise<Response>}
 */
async function del(url, options = {}) {
    const fullUrl = appendQuery(url, options.query);
    return executeFetch(fullUrl, {
        method: 'DELETE',
        ...options
    });
}

module.exports = {
    fetch: executeFetch,
    get,
    getJson,
    post,
    postJson,
    put,
    delete: del,
    appendQuery
};
