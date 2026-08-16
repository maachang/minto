/**
 * AIメモ:
 * - format.js: 日本語Web開発・業務画面向けの文字列・数値・データ整形ユーティリティ。
 * - ゼロ依存 (Node/Bun 標準機能のみ)。
 * - 主な機能:
 *   - 金額/数値カンマ区切り: format.money(1250000) -> "1,250,000"
 *   - 全角半角変換: format.toHalfWidth("ＡＢＣ１２３") -> "ABC123"
 *   - カナ変換: format.toHiragana("テスト") -> "てすと", format.toKatakana("てすと") -> "テスト"
 *   - バイトサイズ表記: format.bytes(1048576) -> "1.0 MB"
 *   - 伏字（マスキング）: format.mask("09012345678", 3, 4) -> "090****5678"
 *   - 文字列切り詰め: format.truncate("長い文章です", 5) -> "長い文章..."
 * - CommonJS 形式。
 */

'use strict';

/**
 * 数値を金額・カンマ区切り文字列に変換
 * @param {number|string} value 
 * @param {string} [prefix=''] 例: '¥'
 * @returns {string}
 */
function money(value, prefix = '') {
    if (value === null || value === undefined || value === '') return '';
    const num = Number(value);
    if (isNaN(num)) return String(value);

    const parts = String(value).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return prefix + parts.join('.');
}

/**
 * 全角英数・スペース・記号を半角に変換
 * @param {string} str 
 * @returns {string}
 */
function toHalfWidth(str) {
    if (!str) return '';
    return String(str)
        .replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' ');
}

/**
 * 半角英数・スペースを全角に変換
 * @param {string} str 
 * @returns {string}
 */
function toFullWidth(str) {
    if (!str) return '';
    return String(str)
        .replace(/[!-~]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xFEE0))
        .replace(/ /g, '　');
}

/**
 * 全角カタカナをひらがなに変換
 * @param {string} str 
 * @returns {string}
 */
function toHiragana(str) {
    if (!str) return '';
    return String(str).replace(/[\u30a1-\u30f6]/g, (match) => {
        const chr = match.charCodeAt(0) - 0x60;
        return String.fromCharCode(chr);
    });
}

/**
 * ひらがなを全角カタカナに変換
 * @param {string} str 
 * @returns {string}
 */
function toKatakana(str) {
    if (!str) return '';
    return String(str).replace(/[\u3041-\u3096]/g, (match) => {
        const chr = match.charCodeAt(0) + 0x60;
        return String.fromCharCode(chr);
    });
}

/**
 * バイト数を人間が読みやすい単位（B, KB, MB, GB, TB）に変換
 * @param {number} bytes 
 * @param {number} [decimals=1] 小数点桁数
 * @returns {string}
 */
function bytes(bytes, decimals = 1) {
    if (bytes === 0 || bytes === '0') return '0 B';
    const num = Number(bytes);
    if (!num || isNaN(num) || num < 0) return '0 B';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(num) / Math.log(k));
    const formatted = parseFloat((num / Math.pow(k, i)).toFixed(dm));
    return `${formatted} ${sizes[i] || 'PB'}`;
}

/**
 * 文字列の特定部分を伏字（マスク）にする
 * @param {string} str 
 * @param {number} [startKeep=3] 先頭に残す文字数
 * @param {number} [endKeep=4] 末尾に残す文字数
 * @param {string} [maskChar='*'] マスク文字
 * @returns {string}
 */
function mask(str, startKeep = 3, endKeep = 4, maskChar = '*') {
    if (!str) return '';
    const s = String(str);
    const len = s.length;
    if (len <= startKeep + endKeep) {
        return maskChar.repeat(len);
    }
    const head = s.slice(0, startKeep);
    const tail = s.slice(len - endKeep);
    const masked = maskChar.repeat(len - startKeep - endKeep);
    return head + masked + tail;
}

/**
 * 指定文字数を超えた場合に末尾を省略記号（...）にする
 * @param {string} str 
 * @param {number} maxLen 
 * @param {string} [ellipsis='...'] 
 * @returns {string}
 */
function truncate(str, maxLen, ellipsis = '...') {
    if (!str) return '';
    const s = String(str);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + ellipsis;
}

/**
 * HTML特殊文字をエスケープ
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

module.exports = {
    money,
    comma: money,
    toHalfWidth,
    toFullWidth,
    toHiragana,
    toKatakana,
    bytes,
    mask,
    truncate,
    escapeHtml
};
