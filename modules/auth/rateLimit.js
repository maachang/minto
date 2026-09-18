///////////////////////////////////////////////
// 軽量インメモリ・レートリミットモジュール (rateLimit.js).
//
// 固定費0円・外部npm依存ゼロでAPIやエンドポイントへの
// 過剰アクセス・総当たり攻撃を防御する.
//
// Lambda実行コンテナ内のインメモリMap + スライディングログ
// または固定ウィンドウカウンタ方式で動作し、
// 同一コンテナへの過剰リクエストを瞬時に遮断(HTTP 429)する.
//
// AIメモ:
// - Lambdaはマルチコンテナでスケールするため、各コンテナ内のメモリに
//   分散されるが、「単一コンテナへの集中DoSや高速総当たり攻撃」に対して
//   追加コストゼロ($0)で強力な緩和策として機能する.
// - 外部RedisやDynamoDBを使わないため、通信遅延ゼロ・APIコストゼロ.
// - メモリリーク防止のため、最大キー数制限(_MAX_KEYS)と
//   アクセス時の期限切れエントリ自動パージ(_purgeExpired)を備える.
// - check(key, options): 単体レートリミット判定API.
// - guard(options): $request() / $response() と連携した自動遮断ガードAPI.
//   filter.mt.js や *.mt.js の先頭で呼び出し、制限超過時に 429 Too Many Requests
//   および Retry-After, X-RateLimit-* ヘッダーを設定して false を返す.
///////////////////////////////////////////////
(function () {
    'use strict';

    // 内部メモリストア: key -> { count: number, resetAt: number }
    const _store = new Map();

    // デフォルト設定値
    const _DEFAULT_WINDOW_MS = 60 * 1000; // 1分 (60,000ms)
    const _DEFAULT_LIMIT = 60;            // 60回/分
    const _MAX_KEYS = 10000;              // メモリ上限対策(最大1万IP/キー)

    // 期限切れエントリのパージ
    const _purgeExpired = function (now) {
        now = now || Date.now();
        for (const [k, v] of _store.entries()) {
            if (v.resetAt <= now) {
                _store.delete(k);
            }
        }
    };

    // 最古エントリの削除(キャパシティ超過時の緊急クリーンアップ)
    const _evictOldest = function () {
        const iter = _store.keys();
        const first = iter.next().value;
        if (first !== undefined) {
            _store.delete(first);
        }
    };

    // レートリミットの判定・カウントインクリメント
    // key: 制限対象キー(IPアドレスやユーザーIDなど)
    // options: {
    //   windowMs: 制限時間枠ミリ秒 (デフォルト: 60,000ms = 1分)
    //   limit: 時間枠あたりの最大許容回数 (デフォルト: 60回)
    //   cost: 消費コスト (デフォルト: 1)
    // }
    // 戻り値: {
    //   allowed: boolean,    // 許容内なら true, 超過なら false
    //   limit: number,      // 設定された上限値
    //   remaining: number,  // 残り許容回数 (超過時は 0)
    //   resetMs: number,    // ウィンドウリセットまでの残りミリ秒
    //   resetTime: number   // ウィンドウリセット時刻 (UnixTimeミリ秒)
    // }
    const check = function (key, options) {
        if (key === undefined || key === null || key === "") {
            key = "anonymous";
        } else {
            key = "" + key;
        }

        options = options || {};
        const windowMs = options.windowMs != null ? Math.max(1, Number(options.windowMs)) : _DEFAULT_WINDOW_MS;
        const limit = options.limit != null ? Math.max(1, Number(options.limit)) : _DEFAULT_LIMIT;
        const cost = options.cost != null ? Math.max(1, Number(options.cost)) : 1;
        const now = Date.now();

        let entry = _store.get(key);

        // 期限切れ、または新規エントリの場合
        if (!entry || entry.resetAt <= now) {
            // キャパシティチェック
            if (!entry && _store.size >= _MAX_KEYS) {
                _purgeExpired(now);
                if (_store.size >= _MAX_KEYS) {
                    _evictOldest();
                }
            }

            entry = {
                count: cost,
                resetAt: now + windowMs
            };
            _store.set(key, entry);

            const allowed = entry.count <= limit;
            const remaining = Math.max(0, limit - entry.count);
            const resetMs = Math.max(0, entry.resetAt - now);

            return {
                allowed: allowed,
                limit: limit,
                remaining: remaining,
                resetMs: resetMs,
                resetTime: entry.resetAt
            };
        }

        // 既存ウィンドウ内でのインクリメント
        entry.count += cost;
        const allowed = entry.count <= limit;
        const remaining = Math.max(0, limit - entry.count);
        const resetMs = Math.max(0, entry.resetAt - now);

        return {
            allowed: allowed,
            limit: limit,
            remaining: remaining,
            resetMs: resetMs,
            resetTime: entry.resetAt
        };
    };

    // 特定キーのカウントをリセット
    const reset = function (key) {
        if (key !== undefined && key !== null) {
            _store.delete("" + key);
        }
    };

    // 全エントリをクリア(テスト用)
    const clear = function () {
        _store.clear();
    };

    // 現在の管理キー数を取得(デバッグ・メトリクス用)
    const size = function () {
        return _store.size;
    };

    // リクエストの識別子を抽出(デフォルトはIPアドレス)
    const _extractKey = function (req, options) {
        options = options || {};
        if (typeof options.keyGenerator === "function") {
            return options.keyGenerator(req);
        }
        if (options.key) {
            return options.key;
        }
        if (req && typeof req.ip === "function") {
            const ip = req.ip();
            if (ip) return ip;
        }
        return "unknown-client";
    };

    // Lambda / minto ハンドラ・フィルター用ガードヘルパー
    // options: {
    //   windowMs: 制限時間枠ミリ秒 (デフォルト: 60,000ms = 1分)
    //   limit: 最大回数 (デフォルト: 60回)
    //   key: 識別キー(指定なしの場合はクライアントIP)
    //   keyGenerator: function(req): 識別キー生成関数
    //   statusCode: 429 (デフォルト: 429)
    //   message: "Too Many Requests" (エラーメッセージ)
    //   setHeaders: true (デフォルト: true, X-RateLimit-* および Retry-After を設定)
    // }
    // 戻り値: 制限内なら true, 制限超過時は false (かつ $response() に 429 とヘッダーを設定)
    const guard = function (options) {
        options = options || {};
        const req = (typeof $request === "function") ? $request() : null;
        const res = (typeof $response === "function") ? $response() : null;

        const key = _extractKey(req, options);
        const result = check(key, options);

        if (res && options.setHeaders !== false) {
            res.header("x-ratelimit-limit", "" + result.limit);
            res.header("x-ratelimit-remaining", "" + result.remaining);
            res.header("x-ratelimit-reset", "" + Math.ceil(result.resetTime / 1000));
        }

        if (!result.allowed) {
            if (res) {
                const retryAfterSec = Math.max(1, Math.ceil(result.resetMs / 1000));
                res.status(options.statusCode || 429, options.message || "Too Many Requests");
                res.header("retry-after", "" + retryAfterSec);
                res.body({
                    status: options.statusCode || 429,
                    message: options.message || "Too Many Requests",
                    retryAfter: retryAfterSec
                });
            }
            return false;
        }

        return true;
    };

    exports.check = check;
    exports.reset = reset;
    exports.clear = clear;
    exports.size = size;
    exports.guard = guard;
})();
