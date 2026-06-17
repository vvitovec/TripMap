import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 8328),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  cookieSecure:
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" &&
      (process.env.WEB_ORIGIN ?? "").startsWith("https://")),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://tripmap:tripmap@localhost:5432/tripmap",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  s3PublicEndpoint:
    process.env.S3_PUBLIC_ENDPOINT ??
    process.env.S3_ENDPOINT ??
    "http://localhost:9000",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "tripmap-media",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "tripmap",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "tripmap-secret"
};
