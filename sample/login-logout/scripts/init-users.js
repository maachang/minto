// ************************************************************
// 初期ユーザー登録スクリプト (デプロイ後に1度実行)
// 実行: node scripts/init-users.js
// ************************************************************

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

const BUCKET = "my-minto-app-bucket";
const REGION = "ap-northeast-1";
const PREFIX = "users/";

const s3 = new S3Client({ region: REGION });

// modules/auth/password.js と同じ PBKDF2-HMAC-SHA256(反復10000回)を
// Node標準の crypto.pbkdf2Sync で計算する.
// (本スクリプトは llrt ではなく通常のnode.jsで実行するため
//  crypto.pbkdf2Sync が利用できる. 導出結果は
//  modules/auth/password.js の derive() と一致することを確認済み.)
const ITERATIONS = 10000;

function hashPw(pw) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(
        pw, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha256"
    ).toString("hex");
    return { salt: salt, hash: hash, iterations: ITERATIONS };
}

async function createUser(uid, pw, name, role) {
    const hashed = hashPw(pw);
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: PREFIX + uid + ".json",
        Body: JSON.stringify({
            userId: uid, name: name, role: role,
            salt: hashed.salt, passwordHash: hashed.hash,
            passwordIterations: hashed.iterations,
            createdAt: new Date().toISOString()
        }),
        ContentType: "application/json"
    }));
    console.log("Created: " + uid);
}

(async () => {
    await createUser("admin", "admin123", "管理者ユーザー", "admin");
    await createUser("user01", "pass1234", "一般ユーザー", "user");
    await createUser("demo", "demo", "デモユーザー", "user");
    console.log("Done.");
})();
