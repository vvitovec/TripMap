import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

export const queueConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null
});

export const mediaQueue = new Queue("media-processing", {
  connection: queueConnection
});
