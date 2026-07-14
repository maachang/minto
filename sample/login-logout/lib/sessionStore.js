// ************************************************************
// lib/sessionStore.js
// conf/app.json の設定を元に modules/auth/session.js の
// セッションストアを生成するアプリ固有のラッパー.
// ************************************************************

(function () {
    'use strict';

    // modules/auth/session.js ("session.js" という同名ファイルが
    // lib配下に存在しないため、$loadLib は modules 配下を検索する).
    const authSession = $loadLib("session.js");
    const _conf = $loadConf("app.json");

    const _store = authSession.create({
        bucket: _conf.s3Bucket,
        prefix: _conf.sessionPrefix,
        timeoutMin: _conf.sessionTimeoutMin,
        region: _conf.region
    });

    exports.start = _store.start;
    exports.get = _store.get;
    exports.destroy = _store.destroy;
    exports.count = _store.count;
})();
