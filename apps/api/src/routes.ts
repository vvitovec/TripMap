import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { env } from "./env.js";
import { mediaQueue } from "./queue.js";
import { getObject, putObject } from "./storage.js";

type AuthUser = { id: string; email: string; name: string };
type PlaceResult = {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string>;
  namedetails?: Record<string, string>;
};

const placeSearchCache = new Map<string, { expiresAt: number; places: unknown[] }>();
let lastNominatimSearchAt = 0;

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  password: z.string().min(8).max(200)
});

const loginSchema = registerSchema.pick({ email: true, password: true });

const folderSchema = z.object({
  title: z.string().min(1).max(80),
  color: z.string().min(4).max(24).default("#3b82f6")
});

const tripSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(140),
  description: z.string().max(2000).default(""),
  type: z.enum(["one_destination", "road_trip"]),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional()
});

const stopSchema = z.object({
  title: z.string().min(1).max(140),
  note: z.string().max(2000).default(""),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  sortOrder: z.number().int().default(0),
  arrivedAt: z.string().datetime().nullable().optional(),
  departedAt: z.string().datetime().nullable().optional(),
  branchOf: z.string().uuid().nullable().optional()
});

const placeSearchSchema = z.object({
  q: z.string().trim().min(3).max(180),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional()
});

function placeName(result: PlaceResult) {
  return (
    result.name ||
    result.namedetails?.name ||
    result.address?.hotel ||
    result.address?.attraction ||
    result.address?.resort ||
    result.address?.amenity ||
    result.address?.tourism ||
    result.address?.road ||
    result.display_name.split(",")[0]?.trim() ||
    "Place"
  );
}

function placeCategory(result: PlaceResult) {
  if (result.class === "tourism" && result.type) return result.type;
  if (result.class === "amenity" && result.type) return result.type;
  if (result.class === "historic" && result.type) return result.type;
  if (result.class === "leisure" && result.type) return result.type;
  return result.class || result.type || "place";
}

function viewbox(lat: number, lng: number) {
  const delta = 2.5;
  return `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`;
}

async function waitForNominatimSlot() {
  const elapsed = Date.now() - lastNominatimSearchAt;
  const waitMs = Math.max(0, 1100 - elapsed);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastNominatimSearchAt = Date.now();
}

async function searchPlaces(input: z.infer<typeof placeSearchSchema>) {
  const cacheKey = JSON.stringify(input).toLowerCase();
  const cached = placeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.places;

  await waitForNominatimSlot();
  const params = new URLSearchParams({
    q: input.q,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    limit: "8",
    "accept-language": "en"
  });
  if (input.lat !== undefined && input.lng !== undefined) {
    params.set("viewbox", viewbox(input.lat, input.lng));
    params.set("bounded", "0");
  }

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
      Referer: "https://trip.vvitovec.com"
    }
  });
  if (!response.ok) {
    throw new Error(`Place search failed with status ${response.status}`);
  }
  const data = (await response.json()) as PlaceResult[];
  const places = data
    .map((result) => ({
      id: `${result.osm_type ?? "place"}-${result.osm_id ?? result.place_id}`,
      name: placeName(result),
      label: result.display_name,
      category: placeCategory(result),
      type: result.type ?? result.class ?? "place",
      lat: Number(result.lat),
      lng: Number(result.lon),
      importance: result.importance,
      address: result.address ?? {},
      source: "nominatim" as const
    }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));

  placeSearchCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 30,
    places
  });
  if (placeSearchCache.size > 200) {
    const firstKey = placeSearchCache.keys().next().value;
    if (firstKey) placeSearchCache.delete(firstKey);
  }
  return places;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.cookieSecure,
    path: "/"
  };
}

async function currentUser(request: FastifyRequest): Promise<AuthUser | null> {
  try {
    const payload = await request.jwtVerify<{ id: string }>();
    const { rows } = await pool.query<AuthUser>(
      "SELECT id, email, name FROM users WHERE id = $1",
      [payload.id]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send({ error: "Not signed in" });
    return null;
  }
  return user;
}

async function canEditTrip(tripId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM trips WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2 AND role = 'editor'`,
    [tripId, userId]
  );
  return (rowCount ?? 0) > 0;
}

async function canViewTrip(tripId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM trips WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2`,
    [tripId, userId]
  );
  return (rowCount ?? 0) > 0;
}

async function tripPayload(tripId: string) {
  const trip = await pool.query(
    `SELECT t.*, f.title AS folder_title
     FROM trips t LEFT JOIN folders f ON f.id = t.folder_id
     WHERE t.id = $1`,
    [tripId]
  );
  if (!trip.rows[0]) return null;

  const stops = await pool.query(
    "SELECT * FROM stops WHERE trip_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [tripId]
  );
  const media = await pool.query(
    "SELECT * FROM media_items WHERE trip_id = $1 ORDER BY captured_at NULLS LAST, created_at ASC",
    [tripId]
  );
  const notes = await pool.query(
    "SELECT * FROM notes WHERE trip_id = $1 ORDER BY created_at ASC",
    [tripId]
  );

  return {
    trip: trip.rows[0],
    stops: stops.rows,
    notes: notes.rows,
    media: media.rows.map((item) => ({
      ...item,
      originalUrl: `/api/media/${item.id}/original`,
      optimizedUrl: item.optimized_key ? `/api/media/${item.id}/optimized` : null,
      thumbnailUrl: item.thumbnail_key ? `/api/media/${item.id}/thumbnail` : null
    }))
  };
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const hash = await bcrypt.hash(input.password, 12);
    const { rows } = await pool.query<AuthUser>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [input.email.toLowerCase(), input.name, hash]
    );
    const token = app.jwt.sign({ id: rows[0]!.id });
    reply.setCookie("tripmap_session", token, cookieOptions());
    return { user: rows[0] };
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { rows } = await pool.query<
      AuthUser & { password_hash: string }
    >("SELECT id, email, name, password_hash FROM users WHERE email = $1", [
      input.email.toLowerCase()
    ]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      reply.code(401).send({ error: "Invalid email or password" });
      return;
    }
    const token = app.jwt.sign({ id: user.id });
    reply.setCookie("tripmap_session", token, cookieOptions());
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("tripmap_session", { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (request) => ({ user: await currentUser(request) }));

  app.get("/places/search", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const input = placeSearchSchema.parse(request.query);
    try {
      return { places: await searchPlaces(input) };
    } catch (error) {
      request.log.warn({ error }, "place search failed");
      reply.code(502).send({ error: "Place search is temporarily unavailable" });
    }
  });

  app.get("/folders", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { rows } = await pool.query(
      "SELECT * FROM folders WHERE user_id = $1 ORDER BY created_at ASC",
      [user.id]
    );
    return { folders: rows };
  });

  app.post("/folders", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const input = folderSchema.parse(request.body);
    const { rows } = await pool.query(
      "INSERT INTO folders (user_id, title, color) VALUES ($1, $2, $3) RETURNING *",
      [user.id, input.title, input.color]
    );
    return { folder: rows[0] };
  });

  app.get("/trips", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { rows } = await pool.query(
      `SELECT t.*, f.title AS folder_title,
        COALESCE(json_agg(s.* ORDER BY s.sort_order) FILTER (WHERE s.id IS NOT NULL), '[]') AS stops
       FROM trips t
       LEFT JOIN folders f ON f.id = t.folder_id
       LEFT JOIN stops s ON s.trip_id = t.id
       WHERE t.owner_id = $1
          OR EXISTS (SELECT 1 FROM trip_collaborators c WHERE c.trip_id = t.id AND c.user_id = $1)
       GROUP BY t.id, f.title
       ORDER BY t.updated_at DESC`,
      [user.id]
    );
    return { trips: rows };
  });

  app.post("/trips", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const input = tripSchema.parse(request.body);
    const { rows } = await pool.query(
      `INSERT INTO trips (owner_id, folder_id, title, description, type, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        user.id,
        input.folderId ?? null,
        input.title,
        input.description,
        input.type,
        input.startsAt ?? null,
        input.endsAt ?? null
      ]
    );
    return { trip: rows[0] };
  });

  app.get("/trips/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canViewTrip(id, user.id))) {
      reply.code(404).send({ error: "Trip not found" });
      return;
    }
    return await tripPayload(id);
  });

  app.post("/trips/:id/stops", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const input = stopSchema.parse(request.body);
    const { rows } = await pool.query(
      `INSERT INTO stops (trip_id, title, note, lat, lng, sort_order, arrived_at, departed_at, branch_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.title,
        input.note,
        input.lat,
        input.lng,
        input.sortOrder,
        input.arrivedAt ?? null,
        input.departedAt ?? null,
        input.branchOf ?? null
      ]
    );
    await pool.query("UPDATE trips SET updated_at = now() WHERE id = $1", [id]);
    return { stop: rows[0] };
  });

  app.post("/trips/:id/notes", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const input = z
      .object({ stopId: z.string().uuid().nullable().optional(), body: z.string().min(1).max(4000) })
      .parse(request.body);
    const { rows } = await pool.query(
      "INSERT INTO notes (trip_id, stop_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, input.stopId ?? null, user.id, input.body]
    );
    return { note: rows[0] };
  });

  app.post("/trips/:id/share-links", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const token = randomUUID().replaceAll("-", "");
    const { rows } = await pool.query(
      "INSERT INTO share_links (trip_id, token, role) VALUES ($1, $2, 'viewer') RETURNING *",
      [id, token]
    );
    return { share: rows[0] };
  });

  app.get("/share/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const { rows } = await pool.query(
      "SELECT trip_id FROM share_links WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())",
      [token]
    );
    const link = rows[0];
    if (!link) {
      reply.code(404).send({ error: "Share link not found" });
      return;
    }
    return await tripPayload(link.trip_id);
  });

  app.get("/media/:id/:variant", async (request, reply) => {
    const { id, variant } = request.params as { id: string; variant: string };
    const { rows } = await pool.query(
      "SELECT * FROM media_items WHERE id = $1",
      [id]
    );
    const media = rows[0];
    if (!media) {
      reply.code(404).send({ error: "Media not found" });
      return;
    }
    const key =
      variant === "thumbnail"
        ? media.thumbnail_key
        : variant === "optimized"
          ? media.optimized_key
          : media.original_key;
    if (!key) {
      reply.code(404).send({ error: "Media variant not ready" });
      return;
    }
    const object = await getObject(key);
    const contentType =
      variant === "thumbnail"
        ? media.kind === "video"
          ? "image/jpeg"
          : "image/webp"
        : variant === "optimized"
          ? media.kind === "video"
            ? "video/mp4"
            : "image/webp"
          : media.mime_type;
    reply.type(contentType);
    reply.header("Cache-Control", "private, max-age=604800");
    return reply.send(object.Body);
  });

  app.post("/media/upload", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parts = request.parts();
    let tripId = "";
    let stopId: string | null = null;
    const created = [];

    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "tripId") tripId = String(part.value);
        if (part.fieldname === "stopId") stopId = part.value ? String(part.value) : null;
        continue;
      }

      if (!tripId || !(await canEditTrip(tripId, user.id))) {
        reply.code(403).send({ error: "No edit access" });
        return;
      }

      const buffer = await part.toBuffer();
      const kind = part.mimetype.startsWith("video/") ? "video" : "image";
      const mediaId = randomUUID();
      const key = `originals/${tripId}/${mediaId}-${part.filename}`;
      await putObject(key, buffer, part.mimetype);
      const { rows } = await pool.query(
        `INSERT INTO media_items
         (id, trip_id, stop_id, uploader_id, kind, original_key, mime_type, file_name, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          mediaId,
          tripId,
          stopId,
          user.id,
          kind,
          key,
          part.mimetype,
          part.filename,
          buffer.length
        ]
      );
      await mediaQueue.add("process-media", { mediaId });
      created.push(rows[0]);
    }

    return { media: created };
  });
}
