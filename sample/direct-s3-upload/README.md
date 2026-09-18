# S3 Direct-to-S3 アップロード サンプル

Lambda Function URLs の 6MB 上限を回避し、ブラウザから S3 へ大容量ファイルを直接アップロードするサンプルです。

## ディレクトリ構成

- `public/index.html`: ファイル選択・ドラッグ＆ドロップ・リアルタイム進捗バー（%表示）付き UI
- `public/api/ticket.mt.js`: 署名付きアップロード URL 発行 API
- `public/api/complete.mt.js`: S3 実ファイル検証・完了通知 API

## 動作の流れ

```
[ブラウザ] ---- 1. POST /api/ticket (filename, contentType) ----> [Minto Lambda]
                                                                        |
[ブラウザ] <--- 2. { uploadUrl (Presigned PUT), bucket, key } <----------+
    |
    | (Lambdaを経由せず、直接S3へ大容量PUT送信 / プログレスバー表示)
    v
[AWS S3]
    |
[ブラウザ] ---- 3. POST /api/complete (bucket, key) -----------> [Minto Lambda]
                                                                        |
                                                         (S3 HEADで実在・サイズ検証)
                                                                        |
[ブラウザ] <--- 4. { ok: true, file, downloadUrl } <--------------------+
```

## ローカルでの実行確認

```bash
# S3エミュレータ起動
node tools/localAws.js -p 9000

# サンプルプロジェクト実行
MINTO_LOCAL_S3_ENDPOINT=http://127.0.0.1:9000 S3_UPLOAD_BUCKET=sample-bucket bin/webapps sample/direct-s3-upload
```

ブラウザで `http://localhost:3000` にアクセスして動作確認できます。
