import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
type PlaceSource = "nominatim" | "map" | "mapy" | "overpass" | "photon";
type SearchPlace = {
  id: string;
  name: string;
  label: string;
  category: string;
  type: string;
  lat: number;
  lng: number;
  importance?: number;
  address: Record<string, string>;
  source: PlaceSource;
};
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};
type OverpassTagFilter = { key: string; values?: string[] };
type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
};
type MapyEntity = {
  name: string;
  label: string;
  position: { lon: number; lat: number };
  bbox?: [number, number, number, number];
  type: string;
  location?: string;
  regionalStructure?: Array<{ name: string; type: string; isoCode?: string }>;
  zip?: string;
};

const placeSearchCache = new Map<string, { expiresAt: number; places: unknown[] }>();
const placeReverseCache = new Map<string, { expiresAt: number; place: unknown }>();
let lastNominatimSearchAt = 0;

const imageTypesByExt: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
const videoTypesByExt: Record<string, string> = {
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

function classifyUpload(filename: string | undefined, mimeType: string | undefined) {
  const normalizedMime = (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = path.extname(filename ?? "").toLowerCase();
  if (normalizedMime.startsWith("image/")) {
    return { kind: "image" as const, mimeType: normalizedMime };
  }
  if (normalizedMime.startsWith("video/")) {
    return { kind: "video" as const, mimeType: normalizedMime };
  }
  if (imageTypesByExt[ext]) {
    return { kind: "image" as const, mimeType: imageTypesByExt[ext]! };
  }
  if (videoTypesByExt[ext]) {
    return { kind: "video" as const, mimeType: videoTypesByExt[ext]! };
  }
  return null;
}

function safeUploadName(filename: string | undefined) {
  const name = path.basename(filename || "upload");
  const safe = name.replace(/[^a-zA-Z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim();
  return safe || "upload";
}

async function streamUpload(part: { file: Readable }, key: string, contentType: string) {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(null, chunk);
    }
  });
  const upload = putObject(key, counter, contentType);
  await pipeline(part.file, counter);
  await upload;
  return size;
}

function withSoftTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
  });
}

function preferredMapyLanguage(query: string) {
  return /[áčďéěíňóřšťúůýž]/i.test(query) ? "cs" : "en";
}

function mapyAddress(regionalStructure: MapyEntity["regionalStructure"], zip?: string) {
  const address: Record<string, string> = {};
  regionalStructure?.forEach((item) => {
    if (item.type === "regional.address") address.house_number ??= item.name;
    if (item.type === "regional.street") address.road ??= item.name;
    if (item.type === "regional.municipality_part") address.suburb ??= item.name;
    if (item.type === "regional.municipality") address.city ??= item.name;
    if (item.type === "regional.region") address.state ??= item.name;
    if (item.type === "regional.country") {
      address.country = item.name;
      if (item.isoCode) address.country_code = item.isoCode.toLowerCase();
    }
  });
  if (zip) address.postcode = zip;
  return address;
}

function mapyCategory(entity: MapyEntity) {
  const label = entity.label.toLowerCase();
  if (/\bhotel|accommodation|ubytov/.test(label)) return "hotel";
  if (/\brestaurant|restaurace|pohostinstv/.test(label)) return "restaurant";
  if (/\bcafe|kavár/.test(label)) return "cafe";
  if (/\bcastle|hrad\b/.test(label)) return "castle";
  if (/\bmuseum|muze/.test(label)) return "museum";
  if (/\bviewpoint|vyhlídk/.test(label)) return "viewpoint";
  if (/\bparking|parkovi/.test(label)) return "parking";
  if (entity.type === "poi") return "place";
  return entity.type.replace(/^regional\./, "");
}

function normalizeMapyPlace(entity: MapyEntity, index: number): SearchPlace | null {
  if (!Number.isFinite(entity.position.lat) || !Number.isFinite(entity.position.lon)) return null;
  const category = mapyCategory(entity);
  return {
    id: `mapy-${entity.type}-${entity.position.lat.toFixed(6)}-${entity.position.lon.toFixed(6)}-${index}`,
    name: entity.name,
    label: [entity.name, entity.label, entity.location].filter(Boolean).join(", "),
    category,
    type: category === "place" ? entity.label : category,
    lat: entity.position.lat,
    lng: entity.position.lon,
    address: mapyAddress(entity.regionalStructure, entity.zip),
    source: "mapy"
  };
}

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
  category: z.string().min(1).max(40).default("place"),
  arrivedAt: z.string().datetime().nullable().optional(),
  departedAt: z.string().datetime().nullable().optional(),
  branchOf: z.string().uuid().nullable().optional()
});

const stopUpdateSchema = stopSchema.partial();

const mediaUpdateSchema = z.object({
  stopId: z.string().uuid().nullable()
});

const placeSearchSchema = z.object({
  q: z.string().trim().min(3).max(1200),
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

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function viewbox(lat: number, lng: number) {
  const delta = 2.5;
  return `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radiusKm = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const nearbyCategoryQueries = new Map([
  ["hotel", "hotel"],
  ["hotels", "hotel"],
  ["stay", "hotel"],
  ["stays", "hotel"],
  ["lodging", "hotel"],
  ["accommodation", "hotel"],
  ["accommodations", "hotel"],
  ["place to stay", "hotel"],
  ["places to stay", "hotel"],
  ["where to stay", "hotel"],
  ["resort", "resort"],
  ["resorts", "resort"],
  ["hostel", "hostel"],
  ["hostels", "hostel"],
  ["motel", "motel"],
  ["motels", "motel"],
  ["guesthouse", "guest house"],
  ["guesthouses", "guest house"],
  ["guest house", "guest house"],
  ["guest houses", "guest house"],
  ["apartment", "apartment"],
  ["apartments", "apartment"],
  ["vacation rental", "apartment"],
  ["vacation rentals", "apartment"],
  ["holiday rental", "apartment"],
  ["holiday rentals", "apartment"],
  ["chalet", "chalet"],
  ["chalets", "chalet"],
  ["cabin", "cabin"],
  ["cabins", "cabin"],
  ["campsite", "camp site"],
  ["campsites", "camp site"],
  ["camping", "camp site"],
  ["campground", "camp site"],
  ["campgrounds", "camp site"],
  ["landmark", "tourist attraction"],
  ["landmarks", "tourist attraction"],
  ["tourist attraction", "tourist attraction"],
  ["tourist attractions", "tourist attraction"],
  ["things to do", "tourist attraction"],
  ["thing to see", "tourist attraction"],
  ["things to see", "tourist attraction"],
  ["places to see", "tourist attraction"],
  ["sights to see", "tourist attraction"],
  ["attraction", "tourist attraction"],
  ["attractions", "tourist attraction"],
  ["sight", "tourist attraction"],
  ["sights", "tourist attraction"],
  ["sightseeing", "tourist attraction"],
  ["monument", "monument"],
  ["monuments", "monument"],
  ["historic site", "historic site"],
  ["historic sites", "historic site"],
  ["history", "historic site"],
  ["archaeological site", "historic site"],
  ["archaeological sites", "historic site"],
  ["castle", "castle"],
  ["castles", "castle"],
  ["ruin", "ruins"],
  ["ruins", "ruins"],
  ["church", "place of worship"],
  ["churches", "place of worship"],
  ["cathedral", "place of worship"],
  ["cathedrals", "place of worship"],
  ["temple", "place of worship"],
  ["temples", "place of worship"],
  ["mosque", "place of worship"],
  ["mosques", "place of worship"],
  ["synagogue", "place of worship"],
  ["synagogues", "place of worship"],
  ["bridge", "bridge"],
  ["bridges", "bridge"],
  ["waterfall", "waterfall"],
  ["waterfalls", "waterfall"],
  ["theme park", "theme park"],
  ["theme parks", "theme park"],
  ["amusement park", "theme park"],
  ["amusement parks", "theme park"],
  ["zoo", "zoo"],
  ["zoos", "zoo"],
  ["aquarium", "aquarium"],
  ["aquariums", "aquarium"],
  ["trail", "trail"],
  ["trails", "trail"],
  ["hike", "trail"],
  ["hiking", "trail"],
  ["lake", "lake"],
  ["lakes", "lake"],
  ["mountain", "peak"],
  ["mountains", "peak"],
  ["peak", "peak"],
  ["peaks", "peak"],
  ["summit", "peak"],
  ["summits", "peak"],
  ["ski", "ski area"],
  ["skiing", "ski area"],
  ["ski area", "ski area"],
  ["ski areas", "ski area"],
  ["ski resort", "ski area"],
  ["ski resorts", "ski area"],
  ["slopes", "ski area"],
  ["restaurant", "restaurant"],
  ["restaurants", "restaurant"],
  ["food", "restaurant"],
  ["eat", "restaurant"],
  ["eats", "restaurant"],
  ["place to eat", "restaurant"],
  ["places to eat", "restaurant"],
  ["where to eat", "restaurant"],
  ["cafe", "cafe"],
  ["cafes", "cafe"],
  ["coffee", "cafe"],
  ["bakery", "bakery"],
  ["bakeries", "bakery"],
  ["pastry", "bakery"],
  ["pastries", "bakery"],
  ["ice cream", "ice cream"],
  ["icecream", "ice cream"],
  ["gelato", "ice cream"],
  ["bar", "bar"],
  ["bars", "bar"],
  ["winery", "winery"],
  ["wineries", "winery"],
  ["vineyard", "winery"],
  ["vineyards", "winery"],
  ["wine tasting", "winery"],
  ["market", "marketplace"],
  ["markets", "marketplace"],
  ["marketplace", "marketplace"],
  ["viewpoint", "viewpoint"],
  ["viewpoints", "viewpoint"],
  ["lookout", "viewpoint"],
  ["lookouts", "viewpoint"],
  ["photo spot", "viewpoint"],
  ["photo spots", "viewpoint"],
  ["scenic spot", "viewpoint"],
  ["scenic spots", "viewpoint"],
  ["park", "park"],
  ["parks", "park"],
  ["playground", "playground"],
  ["playgrounds", "playground"],
  ["kids", "playground"],
  ["kids play", "playground"],
  ["picnic", "picnic site"],
  ["picnic spot", "picnic site"],
  ["picnic spots", "picnic site"],
  ["picnic site", "picnic site"],
  ["picnic sites", "picnic site"],
  ["museum", "museum"],
  ["museums", "museum"],
  ["spa", "spa"],
  ["spas", "spa"],
  ["wellness", "spa"],
  ["thermal bath", "spa"],
  ["thermal baths", "spa"],
  ["pool", "swimming pool"],
  ["pools", "swimming pool"],
  ["swimming pool", "swimming pool"],
  ["swimming pools", "swimming pool"],
  ["marina", "marina"],
  ["marinas", "marina"],
  ["fuel", "fuel"],
  ["gas", "fuel"],
  ["gas station", "fuel"],
  ["gas stations", "fuel"],
  ["petrol", "fuel"],
  ["petrol station", "fuel"],
  ["petrol stations", "fuel"],
  ["charging", "charging station"],
  ["charger", "charging station"],
  ["chargers", "charging station"],
  ["charging station", "charging station"],
  ["charging stations", "charging station"],
  ["ev charger", "charging station"],
  ["ev chargers", "charging station"],
  ["ev charging", "charging station"],
  ["ev charging station", "charging station"],
  ["ev charging stations", "charging station"],
  ["rest area", "rest area"],
  ["rest areas", "rest area"],
  ["rest stop", "rest area"],
  ["rest stops", "rest area"],
  ["toilet", "toilets"],
  ["toilets", "toilets"],
  ["bathroom", "toilets"],
  ["bathrooms", "toilets"],
  ["parking", "parking"],
  ["car rental", "car rental"],
  ["car rentals", "car rental"],
  ["rental car", "car rental"],
  ["rental cars", "car rental"],
  ["rent a car", "car rental"],
  ["airport", "airport"],
  ["airports", "airport"],
  ["station", "train station"],
  ["stations", "train station"],
  ["train station", "train station"],
  ["train stations", "train station"],
  ["bus station", "bus station"],
  ["bus stations", "bus station"],
  ["bus stop", "bus station"],
  ["bus stops", "bus station"],
  ["metro", "subway station"],
  ["metro station", "subway station"],
  ["metro stations", "subway station"],
  ["subway", "subway station"],
  ["subway station", "subway station"],
  ["subway stations", "subway station"],
  ["ferry", "ferry terminal"],
  ["ferries", "ferry terminal"],
  ["ferry terminal", "ferry terminal"],
  ["ferry terminals", "ferry terminal"],
  ["ferry port", "ferry terminal"],
  ["ferry ports", "ferry terminal"],
  ["beach", "beach"],
  ["beaches", "beach"],
  ["shopping", "shopping mall"],
  ["shopping mall", "shopping mall"],
  ["shopping malls", "shopping mall"],
  ["mall", "shopping mall"],
  ["malls", "shopping mall"],
  ["grocery", "supermarket"],
  ["groceries", "supermarket"],
  ["supermarket", "supermarket"],
  ["supermarkets", "supermarket"],
  ["souvenir", "souvenir shop"],
  ["souvenirs", "souvenir shop"],
  ["souvenir shop", "souvenir shop"],
  ["souvenir shops", "souvenir shop"],
  ["gift shop", "souvenir shop"],
  ["gift shops", "souvenir shop"],
  ["pharmacy", "pharmacy"],
  ["pharmacies", "pharmacy"],
  ["hospital", "hospital"],
  ["hospitals", "hospital"],
  ["clinic", "clinic"],
  ["clinics", "clinic"],
  ["doctor", "clinic"],
  ["doctors", "clinic"],
  ["urgent care", "clinic"],
  ["tourist info", "tourist information"],
  ["tourist information", "tourist information"],
  ["information", "tourist information"],
  ["visitor center", "tourist information"],
  ["visitor centre", "tourist information"],
  ["atm", "atm"],
  ["atms", "atm"]
]);

const overpassCategoryTags = new Map<string, OverpassTagFilter[]>([
  ["hotel", [{ key: "tourism", values: ["hotel"] }]],
  ["resort", [{ key: "tourism", values: ["resort"] }]],
  ["hostel", [{ key: "tourism", values: ["hostel"] }]],
  ["motel", [{ key: "tourism", values: ["motel"] }]],
  ["guest house", [{ key: "tourism", values: ["guest_house"] }]],
  ["apartment", [{ key: "tourism", values: ["apartment"] }]],
  ["chalet", [{ key: "tourism", values: ["chalet"] }]],
  ["cabin", [{ key: "tourism", values: ["cabin", "wilderness_hut", "alpine_hut"] }]],
  ["camp site", [{ key: "tourism", values: ["camp_site", "camp_pitch"] }]],
  [
    "tourist attraction",
    [
      { key: "tourism", values: ["attraction", "theme_park", "zoo", "aquarium"] },
      { key: "historic" }
    ]
  ],
  ["monument", [{ key: "historic", values: ["monument", "memorial"] }]],
  ["historic site", [{ key: "historic" }, { key: "tourism", values: ["attraction"] }]],
  ["castle", [{ key: "historic", values: ["castle"] }]],
  ["ruins", [{ key: "historic", values: ["ruins", "archaeological_site"] }]],
  ["place of worship", [{ key: "amenity", values: ["place_of_worship"] }]],
  ["bridge", [{ key: "bridge" }, { key: "man_made", values: ["bridge"] }]],
  [
    "waterfall",
    [
      { key: "waterway", values: ["waterfall"] },
      { key: "natural", values: ["waterfall"] }
    ]
  ],
  ["theme park", [{ key: "tourism", values: ["theme_park"] }]],
  ["zoo", [{ key: "tourism", values: ["zoo"] }]],
  ["aquarium", [{ key: "tourism", values: ["aquarium"] }]],
  [
    "trail",
    [
      { key: "route", values: ["hiking"] },
      { key: "tourism", values: ["trail_riding_station"] }
    ]
  ],
  ["lake", [{ key: "water", values: ["lake", "reservoir", "pond"] }]],
  ["peak", [{ key: "natural", values: ["peak", "saddle", "volcano"] }]],
  [
    "ski area",
    [
      { key: "piste:type" },
      { key: "landuse", values: ["winter_sports"] },
      { key: "aerialway" }
    ]
  ],
  ["restaurant", [{ key: "amenity", values: ["restaurant"] }]],
  ["cafe", [{ key: "amenity", values: ["cafe"] }]],
  ["bakery", [{ key: "shop", values: ["bakery", "pastry"] }]],
  ["ice cream", [{ key: "amenity", values: ["ice_cream"] }, { key: "shop", values: ["ice_cream"] }]],
  ["bar", [{ key: "amenity", values: ["bar", "pub"] }]],
  ["winery", [{ key: "craft", values: ["winery"] }, { key: "shop", values: ["wine"] }]],
  ["marketplace", [{ key: "amenity", values: ["marketplace"] }]],
  ["viewpoint", [{ key: "tourism", values: ["viewpoint"] }]],
  ["park", [{ key: "leisure", values: ["park", "nature_reserve"] }]],
  ["playground", [{ key: "leisure", values: ["playground"] }]],
  ["picnic site", [{ key: "tourism", values: ["picnic_site"] }, { key: "leisure", values: ["picnic_table"] }]],
  ["museum", [{ key: "tourism", values: ["museum"] }]],
  ["spa", [{ key: "leisure", values: ["spa"] }, { key: "amenity", values: ["public_bath"] }]],
  ["swimming pool", [{ key: "leisure", values: ["swimming_pool", "water_park"] }]],
  ["marina", [{ key: "leisure", values: ["marina"] }]],
  ["fuel", [{ key: "amenity", values: ["fuel", "charging_station"] }]],
  ["charging station", [{ key: "amenity", values: ["charging_station"] }]],
  ["rest area", [{ key: "highway", values: ["rest_area", "services"] }]],
  ["toilets", [{ key: "amenity", values: ["toilets"] }]],
  ["parking", [{ key: "amenity", values: ["parking"] }]],
  ["car rental", [{ key: "amenity", values: ["car_rental"] }]],
  ["airport", [{ key: "aeroway", values: ["aerodrome", "terminal"] }]],
  ["train station", [{ key: "railway", values: ["station", "halt"] }]],
  ["bus station", [{ key: "amenity", values: ["bus_station"] }, { key: "highway", values: ["bus_stop"] }]],
  ["subway station", [{ key: "railway", values: ["subway_entrance", "station"] }, { key: "station", values: ["subway"] }]],
  ["ferry terminal", [{ key: "amenity", values: ["ferry_terminal"] }, { key: "route", values: ["ferry"] }]],
  ["beach", [{ key: "natural", values: ["beach"] }]],
  ["shopping mall", [{ key: "shop", values: ["mall", "department_store"] }, { key: "amenity", values: ["marketplace"] }]],
  ["supermarket", [{ key: "shop", values: ["supermarket", "convenience", "grocery"] }]],
  ["souvenir shop", [{ key: "shop", values: ["souvenir", "gift"] }]],
  ["pharmacy", [{ key: "amenity", values: ["pharmacy"] }]],
  ["hospital", [{ key: "amenity", values: ["hospital"] }]],
  ["clinic", [{ key: "amenity", values: ["clinic", "doctors"] }]],
  ["tourist information", [{ key: "tourism", values: ["information"] }, { key: "information" }]],
  ["atm", [{ key: "amenity", values: ["atm"] }]]
]);

const categoryIntentStopWords = new Set([
  "a",
  "an",
  "around",
  "best",
  "current",
  "find",
  "for",
  "good",
  "here",
  "ideas",
  "me",
  "my",
  "near",
  "nearby",
  "open",
  "place",
  "places",
  "search",
  "show",
  "the",
  "top"
]);

function queryTokens(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function nearbyCategoryIntent(query: string) {
  const directQuery = query.trim().toLowerCase();
  const directMatch = nearbyCategoryQueries.get(directQuery);
  if (directMatch) return directMatch;

  const meaningfulQuery = queryTokens(query)
    .filter((token) => !categoryIntentStopWords.has(token))
    .join(" ");
  if (!meaningfulQuery) return null;

  return nearbyCategoryQueries.get(meaningfulQuery) ?? null;
}

function canUseShorthandCategoryAlias(alias: string) {
  const category = nearbyCategoryQueries.get(alias);
  if (!category) return false;
  if (alias.endsWith("s")) return true;
  if (alias !== category) return true;
  return [
    "bakery",
    "food",
    "gas",
    "hiking",
    "ice cream",
    "lake",
    "lodging",
    "mountain",
    "peak",
    "picnic",
    "playground",
    "shopping",
    "ski",
    "sightseeing",
    "souvenir",
    "stay",
    "summit",
    "winery",
    "wellness"
  ].includes(alias);
}

const prefixShorthandCategoryAliases = new Set([
  "hotel",
  "resort",
  "hostel",
  "motel",
  "guesthouse",
  "guest house",
  "apartment",
  "cabin",
  "campsite",
  "landmark",
  "attraction",
  "sight",
  "monument",
  "historic site",
  "castle",
  "church",
  "bridge",
  "waterfall",
  "trail",
  "lake",
  "mountain",
  "peak",
  "ski",
  "ski area",
  "ski resort",
  "restaurant",
  "cafe",
  "bakery",
  "ice cream",
  "bar",
  "winery",
  "viewpoint",
  "park",
  "playground",
  "picnic",
  "picnic site",
  "museum",
  "spa",
  "pool",
  "marina",
  "fuel",
  "parking",
  "airport",
  "station",
  "beach",
  "shopping",
  "shopping mall",
  "grocery",
  "souvenir",
  "souvenir shop",
  "gift shop",
  "pharmacy",
  "hospital",
  "clinic",
  "tourist info",
  "tourist information",
  "atm"
]);

function canUsePrefixShorthandCategoryAlias(alias: string) {
  return canUseShorthandCategoryAlias(alias) || prefixShorthandCategoryAliases.has(alias);
}

function trimLeadingSearchWords(query: string) {
  const words = query.split(" ").filter(Boolean);
  while (words.length > 1 && categoryIntentStopWords.has(words[0]!.toLowerCase())) {
    words.shift();
  }
  return words.join(" ");
}

function parseNaturalNearbySearch(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const separators = [" close to ", " next to ", " nearby ", " around ", " near ", " in ", " at "];

  for (const separator of separators) {
    const index = lower.indexOf(separator);
    if (index <= 0) continue;
    const categoryText = normalized.slice(0, index).trim();
    const anchorQuery = normalized.slice(index + separator.length).trim();
    const category = nearbyCategoryIntent(categoryText);
    if (category && anchorQuery.length >= 3) return { category, anchorQuery };
  }

  const pairedParts = normalized
    .split(/\s*[,;:]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (pairedParts.length === 2) {
    const [first, second] = pairedParts;
    const firstCategory = nearbyCategoryIntent(first!);
    const secondCategory = nearbyCategoryIntent(second!);
    if (firstCategory && second!.length >= 3) return { category: firstCategory, anchorQuery: second! };
    if (secondCategory && first!.length >= 3) return { category: secondCategory, anchorQuery: first! };
  }

  const suffixAliases = [...nearbyCategoryQueries.keys()]
    .filter(canUseShorthandCategoryAlias)
    .sort((a, b) => b.length - a.length);
  const prefixAliases = [...nearbyCategoryQueries.keys()]
    .filter(canUsePrefixShorthandCategoryAlias)
    .sort((a, b) => b.length - a.length);
  const shorthandQuery = trimLeadingSearchWords(normalized);
  const shorthandLower = shorthandQuery.toLowerCase();
  for (const alias of suffixAliases) {
    const suffix = ` ${alias}`;
    if (!shorthandLower.endsWith(suffix)) continue;
    const anchorQuery = shorthandQuery.slice(0, shorthandQuery.length - alias.length).trim();
    if (anchorQuery.length >= 3) return { category: nearbyCategoryQueries.get(alias)!, anchorQuery };
  }

  for (const alias of prefixAliases) {
    const prefix = `${alias} `;
    if (!shorthandLower.startsWith(prefix)) continue;
    const anchorQuery = shorthandQuery.slice(alias.length).trim();
    if (anchorQuery.length >= 3) return { category: nearbyCategoryQueries.get(alias)!, anchorQuery };
  }

  return null;
}

function safeDecode(value: string) {
  const withSpaces = value.replace(/\+/g, " ");
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
}

function cleanedMapLinkText(value: string) {
  return safeDecode(value)
    .replace(/[@!].*$/, "")
    .replace(/[/?#&=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMapLinkPathNoise(value: string) {
  const lower = value.toLowerCase();
  return (
    ["maps", "place", "search", "dir", "data", "entry", "api"].includes(lower) ||
    /^@?-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?/.test(lower) ||
    /^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?/.test(lower)
  );
}

function isAllowedMapLinkHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host === "maps.google.com" ||
    host === "www.google.com" ||
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "maps.apple.com"
  );
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

async function resolveKnownMapLink(query: string) {
  const original = query.trim();
  let url = parseHttpUrl(original);
  if (!url || !isAllowedMapLinkHost(url.hostname)) return original;

  for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
        Referer: "https://trip.vvitovec.com"
      },
      signal: AbortSignal.timeout(3500)
    }).catch(() => null);
    if (!response) return url.toString();
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return url.toString();
    const next = parseHttpUrl(new URL(location, url).toString());
    if (!next || !isAllowedMapLinkHost(next.hostname)) return url.toString();
    url = next;
  }

  return url.toString();
}

function mapLinkSearchText(query: string) {
  const trimmed = query.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const paramNames = ["q", "query", "destination", "daddr", "saddr", "address"];
  for (const name of paramNames) {
    const value = url.searchParams.get(name);
    if (!value || parseCoordinateQuery(value)) continue;
    const cleaned = cleanedMapLinkText(value);
    if (cleaned.length >= 3) return cleaned;
  }

  const pathParts = url.pathname
    .split("/")
    .map(cleanedMapLinkText)
    .filter((part) => part.length >= 3 && !isMapLinkPathNoise(part));
  const isRouteLink = url.pathname.split("/").some((part) => part.toLowerCase() === "dir");
  return (isRouteLink ? pathParts.at(-1) : pathParts[0]) ?? null;
}

function parseCoordinateQuery(query: string) {
  const trimmed = query.trim();
  const decoded = safeDecode(trimmed);
  const coordinatePatterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&#](?:q|ll|center|destination|daddr|saddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[&#]|$)/i,
    /[?&#](?:query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[&#]|$)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/
  ];
  const match = coordinatePatterns
    .map((pattern) => decoded.match(pattern) ?? trimmed.match(pattern))
    .find((result): result is RegExpMatchArray => Boolean(result));
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const lat = Math.abs(first) <= 90 && Math.abs(second) <= 180 ? first : second;
  const lng = lat === first ? second : first;
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

function overpassFilter(filter: OverpassTagFilter) {
  if (!filter.values?.length) return `["${filter.key}"]`;
  return `["${filter.key}"~"^(${filter.values.join("|")})$"]`;
}

function nearbySearchRadiusMeters(query: string) {
  if (
    [
      "restaurant",
      "cafe",
      "bakery",
      "ice cream",
      "bar",
      "parking",
      "toilets",
      "atm",
      "pharmacy"
    ].includes(query)
  ) {
    return 5000;
  }
  if (
    [
      "hotel",
      "resort",
      "hostel",
      "motel",
      "guest house",
      "apartment",
      "fuel",
      "charging station",
      "supermarket"
    ].includes(query)
  ) {
    return 12_000;
  }
  return 25_000;
}

function overpassQuery(filters: OverpassTagFilter[], lat: number, lng: number, radiusMeters: number) {
  const clauses = filters
    .flatMap((filter) => {
      const tag = overpassFilter(filter);
      return [
        `node${tag}(around:${radiusMeters},${lat},${lng});`,
        `way${tag}(around:${radiusMeters},${lat},${lng});`,
        `relation${tag}(around:${radiusMeters},${lat},${lng});`
      ];
    })
    .join("");
  return `[out:json][timeout:10];(${clauses});out center tags 24;`;
}

function overpassAddress(tags: Record<string, string>) {
  const address: Record<string, string> = {};
  const keyMap: Record<string, string> = {
    "addr:housenumber": "house_number",
    "addr:street": "road",
    "addr:city": "city",
    "addr:town": "town",
    "addr:village": "village",
    "addr:suburb": "suburb",
    "addr:postcode": "postcode",
    "addr:country": "country"
  };
  Object.entries(keyMap).forEach(([tagKey, addressKey]) => {
    if (tags[tagKey]) address[addressKey] = tags[tagKey]!;
  });
  return address;
}

function overpassCategory(tags: Record<string, string>, filters: OverpassTagFilter[]) {
  for (const filter of filters) {
    const value = tags[filter.key];
    if (value && (!filter.values || filter.values.includes(value))) {
      return { category: filter.key, type: value };
    }
  }
  return { category: "place", type: "place" };
}

function overpassName(tags: Record<string, string>, type: string) {
  return tags.name || tags.brand || tags.operator || titleize(type || "Place");
}

function overpassLabel(name: string, tags: Record<string, string>, lat: number, lng: number) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];
  const parts = [name, street, city].filter(Boolean);
  return parts.length > 1 ? parts.join(", ") : `${name} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

function normalizeOverpassPlace(element: OverpassElement, filters: OverpassTagFilter[]): SearchPlace | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = element.tags ?? {};
  const { category, type } = overpassCategory(tags, filters);
  const name = overpassName(tags, type);
  return {
    id: `overpass-${element.type}-${element.id}`,
    name,
    label: overpassLabel(name, tags, lat!, lng!),
    category,
    type,
    lat: lat!,
    lng: lng!,
    address: overpassAddress(tags),
    source: "overpass" as const
  };
}

async function searchOverpassPlaces(query: string, lat: number, lng: number) {
  const filters = overpassCategoryTags.get(query);
  if (!filters?.length) return [];
  const radiusMeters = nearbySearchRadiusMeters(query);
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
      Referer: "https://trip.vvitovec.com"
    },
    body: new URLSearchParams({ data: overpassQuery(filters, lat, lng, radiusMeters) }),
    signal: AbortSignal.timeout(14_000)
  });
  if (!response.ok) {
    throw new Error(`Overpass search failed with status ${response.status}`);
  }
  const data = (await response.json()) as { elements?: OverpassElement[] };
  return (data.elements ?? [])
    .map((element) => normalizeOverpassPlace(element, filters))
    .filter((place): place is SearchPlace => Boolean(place));
}

function normalizePhotonPlace(feature: PhotonFeature, query: string): SearchPlace | null {
  const [rawLng, rawLat] = feature.geometry?.coordinates ?? [];
  const properties = feature.properties ?? {};
  const name = properties.name?.trim();
  if (!name || !Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;
  const lat = rawLat as number;
  const lng = rawLng as number;
  const address = {
    house_number: properties.housenumber,
    road: properties.street,
    city: properties.city,
    suburb: properties.district,
    state: properties.state,
    postcode: properties.postcode,
    country: properties.country
  };
  const label = [
    name,
    [properties.housenumber, properties.street].filter(Boolean).join(" "),
    properties.city,
    properties.state,
    properties.country
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: `photon-${properties.osm_type ?? "place"}-${properties.osm_id ?? `${lat.toFixed(5)}-${lng.toFixed(5)}`}`,
    name,
    label,
    category: properties.osm_key ?? query,
    type: properties.osm_value ?? query,
    lat,
    lng,
    address: Object.fromEntries(
      Object.entries(address).filter((entry): entry is [string, string] => Boolean(entry[1]))
    ),
    source: "photon" as const
  };
}

async function searchPhotonPlaces(query: string, lat: number, lng: number) {
  const params = new URLSearchParams({
    q: query,
    lat: String(lat),
    lon: String(lng),
    limit: "16",
    lang: "en"
  });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: {
      "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
      Referer: "https://trip.vvitovec.com"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    throw new Error(`Photon search failed with status ${response.status}`);
  }
  const data = (await response.json()) as { features?: PhotonFeature[] };
  return (data.features ?? [])
    .map((feature) => normalizePhotonPlace(feature, query))
    .filter((place): place is SearchPlace => Boolean(place));
}

async function searchMapyPlaces(query: string, anchor?: { lat: number; lng: number }) {
  if (!env.mapyApiKey) return [];

  async function requestMapy(endpoint: "suggest" | "geocode") {
    const params = new URLSearchParams({
      query,
      lang: preferredMapyLanguage(query),
      limit: "15"
    });
    params.append("type", "regional");
    params.append("type", "poi");
    if (anchor) {
      params.set("preferNear", `${anchor.lng},${anchor.lat}`);
      params.set("preferNearPrecision", "25000");
    }
    const response = await fetch(`https://api.mapy.com/v1/${endpoint}?${params}`, {
      headers: {
        "X-Mapy-Api-Key": env.mapyApiKey,
        "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)"
      },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      throw new Error(`Mapy ${endpoint} failed with status ${response.status}`);
    }
    return (await response.json()) as { items?: MapyEntity[] };
  }

  const suggestData = await requestMapy("suggest");
  const items = suggestData.items?.length ? suggestData.items : (await requestMapy("geocode")).items;
  return (items ?? [])
    .map((entity, index) => normalizeMapyPlace(entity, index))
    .filter((place): place is SearchPlace => Boolean(place));
}

function placeDedupeKey(place: SearchPlace) {
  const name = place.name.toLowerCase().replace(/\W+/g, "");
  return `${name}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
}

function mergePlaces(primary: SearchPlace[], secondary: SearchPlace[]) {
  const seen = new Set<string>();
  const merged: SearchPlace[] = [];
  [...primary, ...secondary].forEach((place) => {
    const key = placeDedupeKey(place);
    if (seen.has(place.id) || seen.has(key)) return;
    seen.add(place.id);
    seen.add(key);
    merged.push(place);
  });
  return merged;
}

async function geocodeSearchAnchor(query: string, reference?: { lat: number; lng: number }) {
  await waitForNominatimSlot();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    limit: "1",
    "accept-language": "en"
  });
  if (reference) {
    params.set("viewbox", viewbox(reference.lat, reference.lng));
    params.set("bounded", "0");
  }
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
      Referer: "https://trip.vvitovec.com"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`Anchor search failed with status ${response.status}`);
  }
  const data = (await response.json()) as PlaceResult[];
  const place = data
    .map((result) => normalizePlace(result))
    .find((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  return place ?? null;
}

async function searchPlaces(input: z.infer<typeof placeSearchSchema>) {
  const cacheKey = JSON.stringify(input).toLowerCase();
  const cached = placeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.places;

  const resolvedQuery = await resolveKnownMapLink(input.q);
  const linkSearchText = mapLinkSearchText(resolvedQuery);
  const coordinates = parseCoordinateQuery(resolvedQuery);
  if (coordinates && !linkSearchText) {
    const place = await reversePlace(coordinates);
    const places = [place];
    placeSearchCache.set(cacheKey, {
      expiresAt: Date.now() + 1000 * 60 * 30,
      places
    });
    return places;
  }

  const queryText = linkSearchText ?? resolvedQuery.trim();
  const inputAnchor =
    input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : undefined;
  const linkAnchor = linkSearchText && coordinates ? coordinates : undefined;
  if (env.mapyApiKey) {
    try {
      const places = await searchMapyPlaces(queryText, linkAnchor ?? inputAnchor);
      placeSearchCache.set(cacheKey, {
        expiresAt: Date.now() + 1000 * 60 * 30,
        places
      });
      return places;
    } catch {
      // Fall back to open providers when Mapy is temporarily unavailable.
    }
  }
  const naturalSearch = parseNaturalNearbySearch(queryText);
  const naturalAnchor = naturalSearch
    ? await geocodeSearchAnchor(naturalSearch.anchorQuery, linkAnchor ?? inputAnchor).catch(() => null)
    : null;
  const categoryIntent = naturalSearch && (naturalAnchor || linkAnchor || inputAnchor)
    ? naturalSearch.category
    : nearbyCategoryIntent(queryText);
  const normalizedQuery = categoryIntent ?? queryText;
  const searchAnchor = naturalAnchor ?? linkAnchor ?? inputAnchor;
  const hasAnchor = Boolean(searchAnchor);
  const isNearbyCategory = Boolean(categoryIntent);

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
    if (searchAnchor) {
      params.set("viewbox", viewbox(searchAnchor.lat, searchAnchor.lng));
      params.set("bounded", bounded ? "1" : "0");
    }
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)",
        Referer: "https://trip.vvitovec.com"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      throw new Error(`Place search failed with status ${response.status}`);
    }
    return (await response.json()) as PlaceResult[];
  }

  const normalizeNominatimPlaces = (data: PlaceResult[]): SearchPlace[] =>
    data
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

  async function searchNominatimPlaces() {
    let data = await fetchSearch(hasAnchor && isNearbyCategory);
    if (!data.length && hasAnchor && isNearbyCategory) {
      data = await fetchSearch(false);
    }
    return normalizeNominatimPlaces(data);
  }

  const [nominatimPlaces, overpassPlaces, photonPlaces] =
    searchAnchor && isNearbyCategory
      ? await Promise.all([
          withSoftTimeout(searchNominatimPlaces(), 11_000, [] as SearchPlace[]),
          withSoftTimeout(searchOverpassPlaces(normalizedQuery, searchAnchor.lat, searchAnchor.lng), 15_000, []),
          withSoftTimeout(searchPhotonPlaces(normalizedQuery, searchAnchor.lat, searchAnchor.lng), 12_000, [])
        ])
      : [await searchNominatimPlaces(), [], []];
  const mergedPlaces = mergePlaces(nominatimPlaces, [...overpassPlaces, ...photonPlaces]);
  const nearbyRadiusKm = nearbySearchRadiusMeters(normalizedQuery) / 1000;
  const places =
    searchAnchor && isNearbyCategory
      ? [...mergedPlaces]
          .filter((place) => distanceKm(searchAnchor, place) <= nearbyRadiusKm)
          .sort((a, b) => distanceKm(searchAnchor, a) - distanceKm(searchAnchor, b))
          .slice(0, 24)
      : mergedPlaces.slice(0, 24);

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

function normalizePlace(result: PlaceResult, source: PlaceSource = "nominatim") {
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

  if (env.mapyApiKey) {
    try {
      const params = new URLSearchParams({
        lon: String(input.lng),
        lat: String(input.lat),
        lang: "en"
      });
      const response = await fetch(`https://api.mapy.com/v1/rgeocode?${params}`, {
        headers: {
          "X-Mapy-Api-Key": env.mapyApiKey,
          "User-Agent": "TripMap/0.1 (https://trip.vvitovec.com; contact: vvitovec27@gmail.com)"
        },
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        const data = (await response.json()) as { items?: MapyEntity[] };
        const place = data.items?.[0] ? normalizeMapyPlace(data.items[0], 0) : null;
        if (place) {
          placeReverseCache.set(cacheKey, {
            expiresAt: Date.now() + 1000 * 60 * 30,
            place
          });
          return place;
        }
      }
    } catch {
      // Fall back to Nominatim reverse geocoding below.
    }
  }

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
    },
    signal: AbortSignal.timeout(8000)
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
        (SELECT m.id FROM media_items m
           WHERE m.trip_id = t.id AND m.kind = 'image' AND m.thumbnail_key IS NOT NULL
           ORDER BY m.captured_at ASC NULLS LAST, m.created_at ASC
           LIMIT 1) AS cover_media_id,
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

  app.delete("/trips/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const { rowCount } = await pool.query(
      "DELETE FROM trips WHERE id = $1 AND owner_id = $2",
      [id, user.id]
    );
    if (!rowCount) {
      reply.code(404).send({ error: "Trip not found" });
      return;
    }
    return { ok: true };
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
      `INSERT INTO stops (trip_id, title, note, lat, lng, sort_order, category, arrived_at, departed_at, branch_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        input.title,
        input.note,
        input.lat,
        input.lng,
        input.sortOrder,
        input.category,
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
           branch_of = CASE WHEN $17 THEN $18 ELSE branch_of END,
           category = CASE WHEN $19 THEN $20 ELSE category END
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
        input.branchOf ?? null,
        input.category !== undefined,
        input.category ?? null
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

  app.delete("/media/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { rows } = await pool.query("SELECT id, trip_id FROM media_items WHERE id = $1", [id]);
    const media = rows[0];
    if (!media) {
      reply.code(404).send({ error: "Media not found" });
      return;
    }
    if (!(await canEditTrip(media.trip_id, user.id))) {
      reply.code(403).send({ error: "No edit access" });
      return;
    }
    await pool.query("DELETE FROM media_items WHERE id = $1", [id]);
    return { ok: true };
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

      const upload = classifyUpload(part.filename, part.mimetype);
      if (!upload) {
        reply.code(415).send({ error: "Only image and video uploads are supported" });
        return;
      }
      const mediaId = randomUUID();
      const fileName = safeUploadName(part.filename);
      const key = `originals/${tripId}/${mediaId}-${fileName}`;
      const sizeBytes = await streamUpload(part, key, upload.mimeType);
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
          upload.kind,
          key,
          upload.mimeType,
          fileName,
          sizeBytes
        ]
      );
      await mediaQueue.add("process-media", { mediaId });
      created.push(rows[0]);
    }

    return { media: created };
  });
}
