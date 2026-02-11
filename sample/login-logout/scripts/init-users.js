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

function hashPw(pw, salt) {
    return crypto.createHash("sha256")
        .update(salt + ":" + pw).digest("hex");
}

async function createUser(uid, pw, name, role) {
    const salt = crypto.randomBytes(16).toString("hex");
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: PREFIX + uid + ".json",
        Body: JSON.stringify({
            userId: uid, name: name, role: role,
            salt: salt, passwordHash: hashPw(pw, salt),
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
