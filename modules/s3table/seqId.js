///////////////////////////////////////////////
// Snowflake ID方式の連番的ユニークID発行(autoIncrementの代替).
//
// AIメモ:
// autoIncrementは「insertの度に変わる値をテーブル定義の集約ファイルに
// 同居させると書き込み競合・性能劣化を招く」という理由で廃止済み
// (modules/s3table/s3MasterTable.js・s3IndexTable.jsのAIメモ参照)。
// 本モジュールはロック・中央採番管理を一切必要とせず、各Lambda実行環境が
// 完全に独立して一意なIDを生成できる(s3MasterTable.js/s3IndexTable.js
// 両方から共通で使えるのはこのため)。
//
// - 64bitをタイムスタンプ(42bit)+ワーカーID(10bit)+シーケンス(12bit)に
//   ビットパックする(Twitter社のSnowflake IDと同じ発想)。
// - 用途は主に他テーブルとの紐付けキーであり算術演算の必要性は低いため、
//   JSの安全な整数範囲(2^53)に収める設計は採用しない。内部はBigIntで
//   64bitフル精度を扱い、外部(利用者・ストレージ)には固定長16桁の
//   小文字hex文字列として渡す(JSON.stringifyがBigIntを扱えないことと、
//   固定長にすることで文字列比較(<, >)がそのまま数値順と一致することの
//   両方を満たすため)。
// - ワーカーID(同一ミリ秒内で別のLambda実行環境が生成した場合に衝突しない
//   ための識別子)は、$requestId()を自前のFNV-1a風ハッシュ関数(crypto非使用、
//   Math.imulによる純粋なビット演算)で10bitに畳み込んで使う。crypto.createHash
//   のllrtでのサポート状況が未確認のため、確実に動作する自前実装を選んだ。
//   モジュールロード時点ではまだ有効なリクエストコンテキストが無いため、
//   初回generate()呼び出し時に遅延計算してメモ化する
//   ($requestId()の取得パターンはs3IndexTable.jsのgenerateRowId()と同じ
//   ガード方式を踏襲)。
// - シーケンス(同一ミリ秒内の連番)が4096件を超えた場合は、次のミリ秒に
//   なるまでビジーウェイトする(想定利用規模(1テーブル1万件程度)では
//   実質発生しない前提)。
///////////////////////////////////////////////
(function () {
    'use strict';

    // カスタムエポック(2024-01-01T00:00:00Z). ここからの経過ミリ秒を
    // タイムスタンプ部分として使う(2024年から約139年分表現可能).
    const _EPOCH = 1704067200000n;

    // ビット幅.
    const _TIMESTAMP_BITS = 42n;
    const _WORKER_BITS = 10n;
    const _SEQ_BITS = 12n;

    // 各部の最大値(マスク).
    const _WORKER_MASK = (1n << _WORKER_BITS) - 1n;
    const _SEQ_MASK = (1n << _SEQ_BITS) - 1n;

    // 生成されるIDの16進数桁数(64bit / 4bit = 16桁).
    const _HEX_LEN = 16;

    // 16桁の小文字hex文字列かどうかを判定する正規表現.
    const _VALID_REG = /^[0-9a-f]{16}$/;

    // ワーカーID(初回generate()呼び出し時に遅延計算してメモ化する).
    let _workerId = null;

    // 直前にIDを生成したミリ秒・その時点でのシーケンス番号.
    let _lastMs = -1n;
    let _seq = 0n;

    // $requestId()を取得する(取得できない場合は"0"を返す).
    // s3IndexTable.jsのgenerateRowId()と同じガード方式.
    const _getRequestId = function () {
        if (typeof $requestId === "function") {
            try {
                return $requestId();
            } catch (e) {
                return "0";
            }
        }
        return "0";
    };

    // 文字列をFNV-1a風のハッシュでワーカーID(10bit)に畳み込む.
    // crypto.createHashのllrtサポート状況が未確認のため、Math.imulのみを
    // 使った自前実装にしている.
    const _hashToWorkerId = function (str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        // 符号なし32bit化してから10bitに切り詰める.
        return BigInt(h >>> 0) & _WORKER_MASK;
    };

    // ワーカーIDを取得(遅延初期化・メモ化).
    const _getWorkerId = function () {
        if (_workerId === null) {
            _workerId = _hashToWorkerId(_getRequestId());
        }
        return _workerId;
    };

    // 16桁の小文字hex文字列かどうかを判定する.
    // value 判定対象の値を設定します.
    // 戻り値: 正しい形式の場合true.
    const isValid = function (value) {
        return typeof value === "string" && _VALID_REG.test(value);
    };

    // Snowflake ID方式のユニークIDを1件生成する.
    // 戻り値: 固定長16桁の小文字hex文字列が返却されます.
    const generate = function () {
        const workerId = _getWorkerId();
        let now = BigInt(Date.now());
        if (now === _lastMs) {
            _seq = (_seq + 1n) & _SEQ_MASK;
            if (_seq === 0n) {
                // 同一ミリ秒内でシーケンスが溢れた場合、次のミリ秒まで待つ.
                while (BigInt(Date.now()) === now) {
                    // busy wait.
                }
                now = BigInt(Date.now());
            }
        } else {
            _seq = 0n;
        }
        _lastMs = now;

        const id = ((now - _EPOCH) << (_WORKER_BITS + _SEQ_BITS)) |
            (workerId << _SEQ_BITS) | _seq;
        return id.toString(16).padStart(_HEX_LEN, "0");
    };

    exports.generate = generate;
    exports.isValid = isValid;
})();
