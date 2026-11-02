'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function createReceiptStorage(env = process.env, client = null) {
  const required = ['B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_NAME', 'B2_BUCKET_ID', 'B2_ENDPOINT'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error('Receipt object storage is not configured.');
  const s3 = client || new S3Client({
    endpoint: env.B2_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY },
  });
  const bucket = env.B2_BUCKET_NAME;
  return {
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256', Metadata: { sha256: require('node:crypto').createHash('sha256').update(body).digest('hex'), bucketid: env.B2_BUCKET_ID } }));
    },
    async get(key) {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks = [];
      for await (const chunk of result.Body) chunks.push(Buffer.from(chunk));
      return { body: Buffer.concat(chunks), contentType: result.ContentType };
    },
    async delete(key) { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}

module.exports = { createReceiptStorage };
