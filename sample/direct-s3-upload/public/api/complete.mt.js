// sample/direct-s3-upload/public/api/complete.mt.js
const directUpload = $loadLib("directUpload.js");

exports.handler = async () => {
    const params = $request().params();
    const bucket = params.bucket;
    const key = params.key;

    if (!bucket || !key) {
        $response().status(400, "Bad Request");
        return { ok: false, error: "bucket and key are required" };
    }

    const result = await directUpload.verifyUploadedFile(bucket, key, {
        maxSize: 100 * 1024 * 1024
    });

    if (!result.valid) {
        $response().status(400, "Bad Request");
        return { ok: false, error: result.error };
    }

    // 必要に応じてダウンロードURLも発行して返却
    const downloadTicket = directUpload.createDownloadTicket(bucket, key, {
        expiresIn: 3600
    });

    return {
        ok: true,
        file: {
            bucket: result.bucket,
            key: result.key,
            size: result.size,
            contentType: result.contentType,
            etag: result.etag,
            downloadUrl: downloadTicket.downloadUrl
        }
    };
};
