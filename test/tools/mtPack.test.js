// tools/mtPack.js(mtpkコマンド)のテスト.
// 実際に子プロセスとして `node tools/mtPack.js -t {target}` を実行し、
// 生成された mtpack.zip の中身をunzipして検証する。
// modules/*** のpack自体は既存動作(変更無し)のため、今回追加した
// 「$MINTO_HOME/public/ 以下のpack対応」に絞って検証する。
//   1. public/js のような modules/*** に対応するディレクトリが無いものは
//      --target指定に関わらず常にコピーされる.
//   2. public/auth のような modules/auth に対応するものは、"-t auth"
//      (または "-t all")を指定した場合のみコピーされ、パス構造は
//      modules側と違いそのまま維持される(mt.htmlはjhtml変換される).
//   3. --targetでauthを指定しない場合はpublic/auth自体がコピーされない.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const MINTO_HOME = path.resolve(__dirname, "..", "..");
const MT_PACK_JS = path.join(MINTO_HOME, "tools", "mtPack.js");

let projectDir;

before(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtpack-test-"));
    fs.mkdirSync(path.join(projectDir, "public"));
    fs.mkdirSync(path.join(projectDir, "lib"));
    fs.mkdirSync(path.join(projectDir, "conf"));
});

after(() => {
    if (projectDir != null) {
        fs.rmSync(projectDir, { recursive: true, force: true });
    }
});

// mtPack.jsを子プロセス実行し、生成されたzipのファイル一覧を返す.
const runPackAndListZip = function (args) {
    const zipPath = path.join(projectDir, "mtpack.zip");
    if (fs.existsSync(zipPath)) {
        fs.rmSync(zipPath);
    }
    execFileSync(process.execPath, [MT_PACK_JS, ...args], {
        cwd: projectDir,
        env: Object.assign({}, process.env, { MINTO_HOME: MINTO_HOME })
    });
    const out = execFileSync("unzip", ["-l", zipPath]).toString();
    return out;
};

test("mtpk: -t auth 指定時、public/authはpath構造を維持しjhtml変換されてpackされる", () => {
    const list = runPackAndListZip(["-t", "auth"]);
    // modules側(lib/)は従来通りflatten.
    assert.match(list, /lib\/mfa\.js/);
    assert.match(list, /lib\/mfaKey\.js/);
    // public側はauthディレクトリ構造を維持(flattenされない).
    assert.match(list, /public\/auth\/js\/qrcode\.js/);
    assert.match(list, /public\/auth\/mfa\/mfa\.jhtml\.js/);
    assert.match(list, /public\/auth\/mfa\/viewMfa\.jhtml\.js/);
    assert.match(list, /public\/auth\/mfa\/authMfa\.jhtml\.js/);
    // mt.jsはjhtml変換されずそのまま.
    assert.match(list, /public\/auth\/mfa\/authMfaVerify\.mt\.js/);
});

test("mtpk: -t auth 指定時でも、modules/***に対応しないpublic/jsは常にpackされる", () => {
    const list = runPackAndListZip(["-t", "auth"]);
    assert.match(list, /public\/js\/marked\.umd\.js/);
});

test("mtpk: -t s3table のようにauthを指定しない場合、public/authはpackされない", () => {
    const list = runPackAndListZip(["-t", "s3table"]);
    assert.doesNotMatch(list, /public\/auth/);
    // modules/***と紐付かないpublic/jsは、authを指定していなくても常にpackされる.
    assert.match(list, /public\/js\/marked\.umd\.js/);
});

test("mtpk: -t all の場合、public/auth(modules/authに対応)もpackされる", () => {
    const list = runPackAndListZip(["-t", "all"]);
    assert.match(list, /public\/auth\/mfa\/mfa\.jhtml\.js/);
    assert.match(list, /public\/js\/marked\.umd\.js/);
});
