import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { migrate } from "./db.js";
import { env } from "./env.js";
import { registerRoutes } from "./routes.js";
import { ensureBucket } from "./storage.js";

const maxUploadBytes = 1024 * 1024 * 1024;
const app = Fastify({ logger: true, bodyLimit: maxUploadBytes });

await app.register(cors, {
  origin: [env.webOrigin, "http://localhost:5173", "http://localhost:8327"],
  credentials: true
});
await app.register(cookie);
await app.register(jwt, {
  secret: env.jwtSecret,
  cookie: {
    cookieName: "tripmap_session",
    signed: false
  }
});
await app.register(multipart, {
  limits: {
    fileSize: maxUploadBytes,
    files: 50
  }
});

await migrate();
await ensureBucket();
await registerRoutes(app);

await app.listen({ host: "0.0.0.0", port: env.port });
