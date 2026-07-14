// e2eテスト用のシンプルなJSON返却サンプル.
exports.handler = async function () {
    return { hello: "world", requestId: $requestId() };
};
