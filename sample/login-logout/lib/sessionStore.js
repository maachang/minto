// ************************************************************
// lib/sessionStore.js
// modules/auth/session.js の再エクスポート.
// 接続設定(bucket等)はsession.js自身がconf/session.jsonから自動的に
// 読み込むため、ここではcreate()せずそのまま再エクスポートするだけで良い.
// ************************************************************
module.exports = require("../../../modules/auth/session.js");
