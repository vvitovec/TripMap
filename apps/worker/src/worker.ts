import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Worker } from "bullmq";
import dotenv from "dotenv";
import exif from "exif-parser";
import { Redis } from "ioredis";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { env } from "./env.js";

dotenv.config();

const execFileAsync = promisify(execFile);
const pool = new pg.Pool({ connectionString: env.databaseUrl });
const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
const s3 = new S3Client({
  region: env.s3Region,
  endpoint: env.s3Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.s3AccessKey,
    secretAccessKey: env.s3SecretKey
  }
});

async function getObjectBuffer(key: string) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: env.s3Bucket, Key: key })
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

function readExif(buffer: Buffer) {
  try {
    const parsed = exif.create(buffer).parse();
    return {
      latitude: parsed.tags.GPSLatitude,
      longitude: parsed.tags.GPSLongitude,
      capturedAt: parsed.tags.DateTimeOriginal
        ? new Date(parsed.tags.DateTimeOriginal * 1000).toISOString()
        : null,
      metadata: {
        make: parsed.tags.Make,
        model: parsed.tags.Model,
        lens: parsed.tags.LensModel,
        orientation: parsed.tags.Orientation,
        exif: parsed.tags
      }
    };
  } catch {
    return { latitude: null, longitude: null, capturedAt: null, metadata: {} };
  }
}

async function processImage(media: any) {
  const original = await getObjectBuffer(media.original_key);
  const metadata = await sharp(original).metadata();
  const extracted = readExif(original);
  const base = `processed/${media.trip_id}/${media.id}`;
  const optimizedKey = `${base}.webp`;
  const thumbKey = `${base}-thumb.webp`;

  const optimized = await sharp(original)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumbnail = await sharp(original)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer();

  await putObject(optimizedKey, optimized, "image/webp");
  await putObject(thumbKey, thumbnail, "image/webp");

  await pool.query(
    `UPDATE media_items
     SET optimized_key = $1, thumbnail_key = $2, width = $3, height = $4,
         captured_at = COALESCE($5, captured_at), latitude = COALESCE($6, latitude),
         longitude = COALESCE($7, longitude), metadata = $8, processing_status = 'ready',
         processing_error = NULL
     WHERE id = $9`,
    [
      optimizedKey,
      thumbKey,
      metadata.width ?? null,
      metadata.height ?? null,
      extracted.capturedAt,
      extracted.latitude,
      extracted.longitude,
      extracted.metadata,
      media.id
    ]
  );
}

async function processVideo(media: any) {
  const original = await getObjectBuffer(media.original_key);
  const dir = await mkdtemp(path.join(tmpdir(), "tripmap-"));
  const input = path.join(dir, media.file_name);
  const output = path.join(dir, "optimized.mp4");
  const poster = path.join(dir, "poster.jpg");
  const base = `processed/${media.trip_id}/${media.id}`;
  const optimizedKey = `${base}.mp4`;
  const thumbKey = `${base}.jpg`;

  try {
    await writeFile(input, original);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-ss",
      "00:00:01",
      "-frames:v",
      "1",
      poster
    ]);
    const optimized = await readFile(output);
    const thumbnail = await readFile(poster);
    await putObject(optimizedKey, optimized, "video/mp4");
    await putObject(thumbKey, thumbnail, "image/jpeg");
    await pool.query(
      `UPDATE media_items
       SET optimized_key = $1, thumbnail_key = $2, processing_status = 'ready',
           processing_error = NULL
       WHERE id = $3`,
      [optimizedKey, thumbKey, media.id]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

new Worker(
  "media-processing",
  async (job) => {
    const mediaId = job.data.mediaId as string;
    await pool.query(
      "UPDATE media_items SET processing_status = 'processing' WHERE id = $1",
      [mediaId]
    );
    const { rows } = await pool.query("SELECT * FROM media_items WHERE id = $1", [
      mediaId
    ]);
    const media = rows[0];
    if (!media) return;
    try {
      if (media.kind === "image") await processImage(media);
      else await processVideo(media);
    } catch (error) {
      await pool.query(
        "UPDATE media_items SET processing_status = 'failed', processing_error = $1 WHERE id = $2",
        [error instanceof Error ? error.message : String(error), mediaId]
      );
      throw error;
    }
  },
  { connection: redis }
);

console.log("TripMap media worker started");
