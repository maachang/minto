/**
 * AIメモ:
 * - encrypt.js: AES-256-GCM による可逆暗号化・復号、ランダムトークン生成ユーティリティ。
 * - Node.js / Bun / LLRT (AWS Lambda) 共通の WebCrypto (crypto.subtle) を使用し、完全なランタイム互換性を担保。
 * - 主な機能:
 *   - encrypt(plainText, key): AES-256-GCM 暗号化 (Promise<string>, 改ざん検知 AuthTag 付き)
 *   - decrypt(cipherText, key): 復号 (Promise<string|null>, 改ざん時は null を返却)
 *   - randomToken(len): URL セーフなランダムトークン生成
 *   - sha256(text): SHA-256 ハッシュ文字列生成
 *   - hmac(text, key): HMAC-SHA256 署名生成
 * - CommonJS 形式。
 */

'use strict';

const crypto = typeof $require === 'function' ? $require('crypto') : require('node:crypto');

const IV_LENGTH = 12; // GCM 推奨 IV 長 (12 bytes)

/**
 * 任意の長さの暗号化キーを 32 バイト (256 bits) の Buffer / Uint8Array に正規化
 * @param {string|Buffer|Uint8Array} secretKey 
 * @returns {Promise<Uint8Array>}
 */
async function normalizeKey(secretKey) {
    if (Buffer.isBuffer(secretKey) && secretKey.length === 32) {
        return secretKey;
    }
    if (secretKey instanceof Uint8Array && secretKey.length === 32) {
        return secretKey;
    }
    if (typeof crypto !== 'undefined' && typeof crypto.createHash === 'function') {
        return crypto.createHash('sha256').update(String(secretKey)).digest();
    }
    const hash = await globalThis.crypto.subtle.digest('SHA-256', Buffer.from(String(secretKey), 'utf-8'));
    return new Uint8Array(hash);
}

/**
 * 平文を AES-256-GCM で暗号化
 * @param {string|Object} plainText 
 * @param {string|Buffer|Uint8Array} secretKey 
 * @returns {Promise<string>} 'iv:authTag:cipherText' 形式の hex 文字列
 */
async function encrypt(plainText, secretKey) {
    if (plainText === null || plainText === undefined || plainText === '') return '';
    const text = typeof plainText === 'object' ? JSON.stringify(plainText) : String(plainText);
    const keyBytes = await normalizeKey(secretKey);

    const aesKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );

    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plainBuf = Buffer.from(text, 'utf-8');

    const encryptedBuf = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        aesKey,
        plainBuf
    );

    const encryptedBytes = new Uint8Array(encryptedBuf);
    const cipherBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);
    const authTagBytes = encryptedBytes.slice(encryptedBytes.length - 16);

    const ivHex = Buffer.from(iv).toString('hex');
    const authTagHex = Buffer.from(authTagBytes).toString('hex');
    const cipherHex = Buffer.from(cipherBytes).toString('hex');

    return `${ivHex}:${authTagHex}:${cipherHex}`;
}

/**
 * 暗号化文字列を復号
 * @param {string} encryptedString 'iv:authTag:cipherText' 形式
 * @param {string|Buffer|Uint8Array} secretKey 
 * @returns {Promise<string|null>} 復号された平文文字列 (鍵の不一致や改ざん時は null)
 */
async function decrypt(encryptedString, secretKey) {
    if (!encryptedString || typeof encryptedString !== 'string') return null;
    const parts = encryptedString.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, cipherHex] = parts;

    try {
        const keyBytes = await normalizeKey(secretKey);
        const aesKey = await globalThis.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const cipher = Buffer.from(cipherHex, 'hex');
        const cipherWithTag = Buffer.concat([cipher, authTag]);

        const decryptedBuf = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            cipherWithTag
        );

        return Buffer.from(decryptedBuf).toString('utf-8');
    } catch (e) {
        return null;
    }
}

/**
 * セキュアなランダムトークンを生成
 * @param {number} [length=32] 
 * @returns {string}
 */
function randomToken(length = 32) {
    const bytes = Math.ceil(length * 0.75);
    const buf = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
    return Buffer.from(buf).toString('base64url').slice(0, length);
}

/**
 * SHA-256 ハッシュ値を計算 (hex)
 * @param {string|Buffer} text 
 * @returns {string}
 */
function sha256(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * HMAC-SHA256 署名を計算 (hex)
 * @param {string|Buffer} text 
 * @param {string|Buffer} key 
 * @returns {string}
 */
function hmac(text, key) {
    return crypto.createHmac('sha256', String(key)).update(String(text)).digest('hex');
}

module.exports = {
    encrypt,
    decrypt,
    randomToken,
    sha256,
    hmac
};
