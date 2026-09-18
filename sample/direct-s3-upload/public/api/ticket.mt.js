// sample/direct-s3-upload/public/api/ticket.mt.js
const directUpload = $loadLib("directUpload.js");

exports.handler = async () => {
    const params = $request().params();
    const filename = params.filename || "file.bin";
    const contentType = params.contentType || "application/octet-stream";

    try {
        const ticket = directUpload.createUploadTicket({
            bucket: process.env.S3_UPLOAD_BUCKET || "sample-bucket",
            prefix: "uploads/",
            filename: filename,
            contentType: contentType,
            allowedTypes: ["image/*", "application/pdf", "video/*", "text/*"],
            maxSize: 100 * 1024 * 1024 // 100MB上限
        });
        return { ok: true, ticket: ticket };
    } catch (e) {
        $response().status(400, "Bad Request");
        return { ok: false, error: e.message };
    }
};
