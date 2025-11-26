///////////////////////////////////////////////
// GithubRepogitoryに対する送信実装.
//
// GithubToken利用でのGithubRepogitory送信処理.
///////////////////////////////////////////////
(function () {
    'use strict';

    // signatureVersion4.
    // request(httpClient)だけを利用する.
    const { request } = require("./asv4.js");

    // issue作成対象のURLを取得.
    const _getURL = function (oganization, repository) {
        let path;
        if (oganization == undefined || oganization == null ||
            oganization == "") {
            path = "repos/" + repository + "/issues";
        } else {
            path = "repos/" + oganization +
                "/" + repository + "/issues";
        }
        return {
            host: "api.github.com",
            path: path
        }
    }

    // githubRepogitoryに新しいissueを作成.
    // token 対象のTokenを設定します.
    // oganization 組織契約しているrepositoryの場合は設定します.
    // repository 対象のrepository名を設定します.
    // title issueタイトルを設定します.
    // body issueボディを設定します.
    // labels ラベル群をArray(string)で設定します.
    //        ここでのラベルはissueに付くラベル名群.
    // 戻り値: {url, title, number}
    //         url: 新しいissueのURL.
    //         title: issueのタイトル.
    //         number: issueの番号.
    const createIssue = async function (
        token, oganization, repository, title, body, labels) {
        // URLを生成.
        const url = _getURL(oganization, repository);

        // HTTPヘッダにトークンセット.
        const headers = {
            "Authorization": "token " + token,
            "User-Agent": "minto/" + Date.now(),
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        };

        // labelsが存在しない場合は空をセット.
        if (labels == undefined || labels == null) {
            labels = [];
        }

        // 送信Payloadを設定.
        const payload = JSON.stringify({
            title: title,
            body: body,
            labels: labels
        });

        // 送信処理.
        const response = {};
        let result = await request(
            url.host, url.path,
            {
                method: "POST",
                headers: headers,
                body: payload,
                response: response,
                // resultType = json返却.
                resultType: "json"
            }
        );
        // responseのstatusが400以上の場合.
        if (response.status >= 400) {
            // エラー表示.
            throw new Error("HTTP status " +
                response.status + " error occurred: " +
                JSON.stringify(url, null, "  "));
        }
        return {
            url: result.html_url,
            title: result.title,
            number: result.number
        };
    }

    /////////////////////////////////////////////////////
    // 外部定義.
    /////////////////////////////////////////////////////
    exports.createIssue = createIssue;

})();