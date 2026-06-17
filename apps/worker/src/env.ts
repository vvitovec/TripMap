import dotenv from "dotenv";

dotenv.config();

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://tripmap:tripmap@localhost:5432/tripmap",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "tripmap-media",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "tripmap",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "tripmap-secret"
};
