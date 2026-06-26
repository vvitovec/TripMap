import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Worker } from "bullmq";
import dotenv from "dotenv";
import exif from "exif-parser";
import { Redis } from "ioredis";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { env } from "./env.js";

type MediaKind = "image" | "video";

type MediaItem = {
  id: string;
  trip_id: string;
  kind: MediaKind;
  original_key: string;
  file_name: string;
};

type MediaProcessingJob = {
  mediaId: string;
};

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

async function getObjectFile(key: string, filePath: string) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: env.s3Bucket, Key: key })
  );
  await pipeline(response.Body as AsyncIterable<Buffer>, createWriteStream(filePath));
}

async function putObject(key: string, body: Buffer | Readable, contentType: string) {
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

async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
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

function parseNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

async function probeVideo(filePath: string) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]);
    const probed = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: Record<string, string>; format_name?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        duration?: string;
        tags?: Record<string, string>;
        side_data_list?: Array<Record<string, unknown>>;
      }>;
    };
    const video = probed.streams?.find((stream) => stream.codec_type === "video");
    const capturedAtRaw = probed.format?.tags?.creation_time ?? video?.tags?.creation_time ?? null;
    const capturedAt = capturedAtRaw && !Number.isNaN(new Date(capturedAtRaw).getTime())
      ? new Date(capturedAtRaw).toISOString()
      : null;
    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      duration: parseNumber(probed.format?.duration) ?? parseNumber(video?.duration),
      capturedAt,
      metadata: {
        format: probed.format?.format_name,
        codec: video?.codec_name,
        originalSize: parseNumber(probed.format?.size),
        video
      }
    };
  } catch (error) {
    console.warn(`Unable to probe video ${filePath}`, error);
    return { width: null, height: null, duration: null, capturedAt: null, metadata: {} };
  }
}

async function processImage(media: MediaItem) {
  const original = await getObjectBuffer(media.original_key);
  const uploadedKey = media.original_key;
  const metadata = await sharp(original).metadata();
  const extracted = readExif(original);
  const base = `processed/${media.trip_id}/${media.id}`;
  const optimizedKey = `${base}.webp`;
  const thumbKey = `${base}-thumb.webp`;

  const optimized = await sharp(original, { limitInputPixels: false })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 5 })
    .toBuffer();
  const thumbnail = await sharp(original, { limitInputPixels: false })
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72, effort: 4 })
    .toBuffer();

  await putObject(optimizedKey, optimized, "image/webp");
  await putObject(thumbKey, thumbnail, "image/webp");

  await pool.query(
    `UPDATE media_items
     SET original_key = $1, optimized_key = $1, thumbnail_key = $2, mime_type = 'image/webp',
         file_name = $3, size_bytes = $4, width = $5, height = $6,
         captured_at = COALESCE($7, captured_at), latitude = COALESCE($8, latitude),
         longitude = COALESCE($9, longitude), metadata = $10, processing_status = 'ready',
         processing_error = NULL
     WHERE id = $11`,
    [
      optimizedKey,
      thumbKey,
      `${path.parse(media.file_name).name}.webp`,
      optimized.length,
      metadata.width ?? null,
      metadata.height ?? null,
      extracted.capturedAt,
      extracted.latitude,
      extracted.longitude,
      extracted.metadata,
      media.id
    ]
  );

  if (uploadedKey !== optimizedKey) {
    try {
      await deleteObject(uploadedKey);
    } catch (error) {
      console.warn(`Unable to delete uploaded source ${uploadedKey}`, error);
    }
  }
}

async function processVideo(media: MediaItem) {
  const uploadedKey = media.original_key;
  const dir = await mkdtemp(path.join(tmpdir(), "tripmap-"));
  const input = path.join(dir, path.basename(media.file_name || "upload"));
  const output = path.join(dir, "optimized.mp4");
  const poster = path.join(dir, "poster.jpg");
  const base = `processed/${media.trip_id}/${media.id}`;
  const optimizedKey = `${base}.mp4`;
  const thumbKey = `${base}.jpg`;

  try {
    await getObjectFile(uploadedKey, input);
    const originalProbe = await probeVideo(input);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "25",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      output
    ]);
    const optimizedProbe = await probeVideo(output);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      output,
      "-ss",
      "00:00:00.5",
      "-frames:v",
      "1",
      "-vf",
      "scale='min(640,iw)':-2",
      poster
    ]);
    const optimizedStat = await stat(output);
    await putObject(optimizedKey, createReadStream(output), "video/mp4");
    await putObject(thumbKey, createReadStream(poster), "image/jpeg");
    await pool.query(
      `UPDATE media_items
       SET original_key = $1, optimized_key = $1, thumbnail_key = $2, mime_type = 'video/mp4',
           file_name = $3, size_bytes = $4, width = $5, height = $6,
           duration_seconds = $7, captured_at = COALESCE($8, captured_at),
           metadata = $9, processing_status = 'ready', processing_error = NULL
       WHERE id = $10`,
      [
        optimizedKey,
        thumbKey,
        `${path.parse(path.basename(media.file_name || "upload")).name}.mp4`,
        optimizedStat.size,
        optimizedProbe.width ?? originalProbe.width,
        optimizedProbe.height ?? originalProbe.height,
        optimizedProbe.duration ?? originalProbe.duration,
        originalProbe.capturedAt,
        { ...optimizedProbe.metadata, original: originalProbe.metadata },
        media.id
      ]
    );
    if (uploadedKey !== optimizedKey) {
      try {
        await deleteObject(uploadedKey);
      } catch (error) {
        console.warn(`Unable to delete uploaded source ${uploadedKey}`, error);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

new Worker<MediaProcessingJob>(
  "media-processing",
  async (job) => {
    const { mediaId } = job.data;
    await pool.query(
      "UPDATE media_items SET processing_status = 'processing' WHERE id = $1",
      [mediaId]
    );
    const { rows } = await pool.query<MediaItem>("SELECT * FROM media_items WHERE id = $1", [
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
