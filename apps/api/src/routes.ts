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
const placeReverseCache = new Map<string, { expiresAt: number; place: unknown }>();
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

const tripUpdateSchema = tripSchema
  .pick({
    folderId: true,
    title: true,
    description: true,
    startsAt: true,
    endsAt: true
  })
  .partial();

const collaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(["viewer", "editor"])
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

const stopUpdateSchema = stopSchema.partial();

const mediaUpdateSchema = z.object({
  stopId: z.string().uuid().nullable()
});

const placeSearchSchema = z.object({
  q: z.string().trim().min(3).max(180),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional()
});

const placeReverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
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

const nearbyCategoryQueries = new Map([
  ["hotel", "hotel"],
  ["hotels", "hotel"],
  ["resort", "resort"],
  ["resorts", "resort"],
  ["campsite", "camp site"],
  ["campsites", "camp site"],
  ["campground", "camp site"],
  ["campgrounds", "camp site"],
  ["landmark", "tourist attraction"],
  ["landmarks", "tourist attraction"],
  ["attraction", "tourist attraction"],
  ["attractions", "tourist attraction"],
  ["restaurant", "restaurant"],
  ["restaurants", "restaurant"],
  ["cafe", "cafe"],
  ["cafes", "cafe"],
  ["coffee", "cafe"],
  ["bar", "bar"],
  ["bars", "bar"],
  ["viewpoint", "viewpoint"],
  ["viewpoints", "viewpoint"],
  ["park", "park"],
  ["parks", "park"],
  ["museum", "museum"],
  ["museums", "museum"],
  ["fuel", "fuel"],
  ["gas", "fuel"],
  ["parking", "parking"],
  ["airport", "airport"],
  ["airports", "airport"],
  ["station", "train station"],
  ["stations", "train station"],
  ["train station", "train station"],
  ["train stations", "train station"],
  ["beach", "beach"],
  ["beaches", "beach"],
  ["grocery", "supermarket"],
  ["groceries", "supermarket"],
  ["supermarket", "supermarket"],
  ["supermarkets", "supermarket"],
  ["pharmacy", "pharmacy"],
  ["pharmacies", "pharmacy"],
  ["atm", "atm"],
  ["atms", "atm"]
]);

function normalizePlaceQuery(query: string) {
  return nearbyCategoryQueries.get(query.trim().toLowerCase()) ?? query.trim();
}

function parseCoordinateQuery(query: string) {
  const trimmed = query.trim();
  const urlMatch = trimmed.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const directMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  const match = urlMatch ?? directMatch;
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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

  const coordinates = parseCoordinateQuery(input.q);
  if (coordinates) {
    const place = await reversePlace(coordinates);
    const places = [place];
    placeSearchCache.set(cacheKey, {
      expiresAt: Date.now() + 1000 * 60 * 30,
      places
    });
    return places;
  }

  const normalizedQuery = normalizePlaceQuery(input.q);
  const hasAnchor = input.lat !== undefined && input.lng !== undefined;
  const isNearbyCategory = nearbyCategoryQueries.has(input.q.trim().toLowerCase());

  async function fetchSearch(bounded: boolean) {
    await waitForNominatimSlot();
    const params = new URLSearchParams({
      q: normalizedQuery,
      format: "jsonv2",
      addressdetails: "1",
      namedetails: "1",
      extratags: "1",
      limit: "8",
      "accept-language": "en"
    });
    if (hasAnchor) {
      params.set("viewbox", viewbox(input.lat!, input.lng!));
      params.set("bounded", bounded ? "1" : "0");
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
    return (await response.json()) as PlaceResult[];
  }

  let data = await fetchSearch(hasAnchor && isNearbyCategory);
  if (!data.length && hasAnchor && isNearbyCategory) {
    data = await fetchSearch(false);
  }
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

function normalizePlace(result: PlaceResult, source: "nominatim" | "map" = "nominatim") {
  return {
    id: `${result.osm_type ?? "place"}-${result.osm_id ?? result.place_id}`,
    name: placeName(result),
    label: result.display_name,
    category: placeCategory(result),
    type: result.type ?? result.class ?? "place",
    lat: Number(result.lat),
    lng: Number(result.lon),
    importance: result.importance,
    address: result.address ?? {},
    source
  };
}

async function reversePlace(input: z.infer<typeof placeReverseSchema>) {
  const cacheKey = `${input.lat.toFixed(5)},${input.lng.toFixed(5)}`;
  const cached = placeReverseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.place;

  await waitForNominatimSlot();
  const params = new URLSearchParams({
    lat: String(input.lat),
    lon: String(input.lng),
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    zoom: "18",
    "accept-language": "en"
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: {
      "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
      Referer: "https://trip.vvitovec.com"
    }
  });
  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status ${response.status}`);
  }
  const data = (await response.json()) as PlaceResult & { error?: string };
  const place =
    data.error || !data.lat || !data.lon
      ? {
          id: `map-${cacheKey}`,
          name: "Dropped pin",
          label: cacheKey,
          category: "map pin",
          type: "pin",
          lat: input.lat,
          lng: input.lng,
          address: {},
          source: "map" as const
        }
      : normalizePlace(data, "nominatim");

  placeReverseCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 30,
    place
  });
  if (placeReverseCache.size > 200) {
    const firstKey = placeReverseCache.keys().next().value;
    if (firstKey) placeReverseCache.delete(firstKey);
  }
  return place;
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

  app.get("/places/reverse", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const input = placeReverseSchema.parse(request.query);
    try {
      return { place: await reversePlace(input) };
    } catch (error) {
      request.log.warn({ error }, "reverse place lookup failed");
      return {
        place: {
          id: `map-${input.lat}-${input.lng}`,
          name: "Dropped pin",
          label: `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`,
          category: "map pin",
          type: "pin",
          lat: input.lat,
          lng: input.lng,
          address: {},
          source: "map"
        }
      };
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

  app.patch("/trips/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const input = tripUpdateSchema.parse(request.body);
    const { rows } = await pool.query(
      `UPDATE trips
       SET folder_id = CASE WHEN $2 THEN $3 ELSE folder_id END,
           title = CASE WHEN $4 THEN $5 ELSE title END,
           description = CASE WHEN $6 THEN $7 ELSE description END,
           starts_at = CASE WHEN $8 THEN $9 ELSE starts_at END,
           ends_at = CASE WHEN $10 THEN $11 ELSE ends_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.folderId !== undefined,
        input.folderId ?? null,
        input.title !== undefined,
        input.title ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.startsAt !== undefined,
        input.startsAt ?? null,
        input.endsAt !== undefined,
        input.endsAt ?? null
      ]
    );
    return { trip: rows[0] };
  });

  app.get("/trips/:id/collaborators", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT c.trip_id, c.user_id, c.role, c.created_at, u.email, u.name
       FROM trip_collaborators c
       JOIN users u ON u.id = c.user_id
       WHERE c.trip_id = $1
       ORDER BY c.created_at ASC`,
      [id]
    );
    return { collaborators: rows };
  });

  app.post("/trips/:id/collaborators", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const input = collaboratorSchema.parse(request.body);
    const target = await pool.query<AuthUser>(
      "SELECT id, email, name FROM users WHERE email = $1",
      [input.email.toLowerCase()]
    );
    const collaborator = target.rows[0];
    if (!collaborator) {
      reply.code(404).send({ error: "No TripMap user found for that email" });
      return;
    }
    const owner = await pool.query("SELECT owner_id FROM trips WHERE id = $1", [id]);
    if (owner.rows[0]?.owner_id === collaborator.id) {
      reply.code(400).send({ error: "Trip owner already has full access" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO trip_collaborators (trip_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (trip_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING trip_id, user_id, role, created_at`,
      [id, collaborator.id, input.role]
    );
    return {
      collaborator: {
        ...rows[0],
        email: collaborator.email,
        name: collaborator.name
      }
    };
  });

  app.delete("/trips/:id/collaborators/:userId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, userId } = request.params as { id: string; userId: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const { rowCount } = await pool.query(
      "DELETE FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2",
      [id, userId]
    );
    if (!rowCount) {
      reply.code(404).send({ error: "Collaborator not found" });
      return;
    }
    return { ok: true };
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

  app.patch("/trips/:id/stops/:stopId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, stopId } = request.params as { id: string; stopId: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const input = stopUpdateSchema.parse(request.body);
    const { rows } = await pool.query(
      `UPDATE stops
       SET title = CASE WHEN $3 THEN $4 ELSE title END,
           note = CASE WHEN $5 THEN $6 ELSE note END,
           lat = CASE WHEN $7 THEN $8 ELSE lat END,
           lng = CASE WHEN $9 THEN $10 ELSE lng END,
           sort_order = CASE WHEN $11 THEN $12 ELSE sort_order END,
           arrived_at = CASE WHEN $13 THEN $14 ELSE arrived_at END,
           departed_at = CASE WHEN $15 THEN $16 ELSE departed_at END,
           branch_of = CASE WHEN $17 THEN $18 ELSE branch_of END
       WHERE trip_id = $1 AND id = $2
       RETURNING *`,
      [
        id,
        stopId,
        input.title !== undefined,
        input.title ?? null,
        input.note !== undefined,
        input.note ?? null,
        input.lat !== undefined,
        input.lat ?? null,
        input.lng !== undefined,
        input.lng ?? null,
        input.sortOrder !== undefined,
        input.sortOrder ?? null,
        input.arrivedAt !== undefined,
        input.arrivedAt ?? null,
        input.departedAt !== undefined,
        input.departedAt ?? null,
        input.branchOf !== undefined,
        input.branchOf ?? null
      ]
    );
    if (!rows[0]) {
      reply.code(404).send({ error: "Stop not found" });
      return;
    }
    await pool.query("UPDATE trips SET updated_at = now() WHERE id = $1", [id]);
    return { stop: rows[0] };
  });

  app.delete("/trips/:id/stops/:stopId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, stopId } = request.params as { id: string; stopId: string };
    if (!(await canEditTrip(id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    const { rowCount } = await pool.query(
      "DELETE FROM stops WHERE trip_id = $1 AND id = $2",
      [id, stopId]
    );
    if (!rowCount) {
      reply.code(404).send({ error: "Stop not found" });
      return;
    }
    await pool.query("UPDATE trips SET updated_at = now() WHERE id = $1", [id]);
    return { ok: true };
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

  app.patch("/media/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = mediaUpdateSchema.parse(request.body);
    const { rows } = await pool.query(
      "SELECT id, trip_id FROM media_items WHERE id = $1",
      [id]
    );
    const media = rows[0];
    if (!media) {
      reply.code(404).send({ error: "Media not found" });
      return;
    }
    if (!(await canEditTrip(media.trip_id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    if (input.stopId) {
      const { rowCount } = await pool.query(
        "SELECT 1 FROM stops WHERE id = $1 AND trip_id = $2",
        [input.stopId, media.trip_id]
      );
      if (!rowCount) {
        reply.code(400).send({ error: "Stop is not part of this trip" });
        return;
      }
    }
    const updated = await pool.query(
      "UPDATE media_items SET stop_id = $1 WHERE id = $2 RETURNING *",
      [input.stopId, id]
    );
    return { media: updated.rows[0] };
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
