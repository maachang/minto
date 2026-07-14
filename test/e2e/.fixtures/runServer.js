// e2eテスト用: tools/webapps.js のローカルサーバーを起動するだけのスクリプト.
// argv[2] = プロジェクトディレクトリ(絶対パス), argv[3] = bindPort
// MINTO_HOME環境変数が設定されている前提(tools/webapps.js側の要件).
const path = require("path");

const projectDir = process.argv[2];
const port = parseInt(process.argv[3], 10);

const webapps = require(path.join(process.env.MINTO_HOME, "tools", "webapps.js"));
webapps.startup(projectDir, port);
