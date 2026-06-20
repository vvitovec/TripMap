import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { env } from "./env.js";

export const s3 = new S3Client({
  region: env.s3Region,
  endpoint: env.s3Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.s3AccessKey,
    secretAccessKey: env.s3SecretKey
  }
});

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  }
}

export async function putObject(key: string, body: Buffer | Readable, contentType: string) {
  const params = {
    Bucket: env.s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  };
  if (!Buffer.isBuffer(body)) {
    await new Upload({
      client: s3,
      params,
      queueSize: 2,
      partSize: 16 * 1024 * 1024,
      leavePartsOnError: false
    }).done();
    return;
  }
  await s3.send(
    new PutObjectCommand(params)
  );
}

export async function getObject(key: string) {
  return await s3.send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: key
    })
  );
}
