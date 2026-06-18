import {
  Camera,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  FolderPlus,
  GitBranch,
  GripVertical,
  Image,
  ListFilter,
  Loader2,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Search,
  Route,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { TripMap } from "./TripMap";
import type { Collaborator, Folder, MediaItem, Note, PlaceSearchResult, Stop, Trip, TripDetail, User } from "./types";

type AuthMode = "login" | "register";
type DestinationScope = "main" | "branch";
type DestinationMode = "search" | "nearby" | "coordinates";
type MemoryScope = "active" | "all";
type SearchOrigin = "context" | "draft" | "route" | "map";
type ShareStatus = "idle" | "copied";
type DestinationPreset = {
  id: string;
  title: string;
  hint: string;
  steps: Array<{ label: string; query: string }>;
};
type PlaceChip = { label: string; query: string; hint: string };
type DestinationSearchSuggestion = { label: string; query: string; hint: string; mode: DestinationMode };
type DestinationListItem = { query: string; note: string };
type QueuedPlace = {
  place: PlaceSearchResult;
  title: string;
  note: string;
  arrivedAt: string;
  departedAt: string;
};
type LocatedMediaItem = MediaItem & { latitude: number; longitude: number };
type LocatedMediaGroup = {
  id: string;
  items: LocatedMediaItem[];
  lat: number;
  lng: number;
};

const recentPlacesKey = "tripmap.recentPlaces.v1";
const recentPlacesLimit = 12;
const destinationListLimit = 12;

const placeChipGroups = [
  {
    title: "Stay",
    chips: [
      { label: "Hotels", query: "hotel", hint: "Rooms" },
      { label: "Resorts", query: "resort", hint: "Getaways" },
      { label: "Hostels", query: "hostel", hint: "Budget" },
      { label: "Motels", query: "motel", hint: "Roadside" },
      { label: "Guesthouses", query: "guesthouse", hint: "Local stays" },
      { label: "Apartments", query: "apartment", hint: "Longer stays" },
      { label: "Cabins", query: "cabin", hint: "Remote" },
      { label: "Campsites", query: "campsite", hint: "Outdoors" }
    ]
  },
  {
    title: "See",
    chips: [
      { label: "Landmarks", query: "landmark", hint: "Sights" },
      { label: "Viewpoints", query: "viewpoint", hint: "Views" },
      { label: "Museums", query: "museum", hint: "Culture" },
      { label: "Parks", query: "park", hint: "Outdoors" },
      { label: "Beaches", query: "beach", hint: "Coast" },
      { label: "Playgrounds", query: "playground", hint: "Kids" },
      { label: "Picnic spots", query: "picnic site", hint: "Breaks" },
      { label: "Historic", query: "historic site", hint: "Heritage" },
      { label: "Monuments", query: "monument", hint: "Icons" },
      { label: "Castles", query: "castle", hint: "Historic" },
      { label: "Churches", query: "church", hint: "Sacred" },
      { label: "Bridges", query: "bridge", hint: "Crossings" },
      { label: "Ruins", query: "ruins", hint: "Old sites" },
      { label: "Trails", query: "trail", hint: "Walks" },
      { label: "Waterfalls", query: "waterfall", hint: "Nature" },
      { label: "Lakes", query: "lake", hint: "Water" },
      { label: "Peaks", query: "peak", hint: "Mountains" },
      { label: "Ski areas", query: "ski area", hint: "Winter" },
      { label: "Theme parks", query: "theme park", hint: "Fun" },
      { label: "Zoos", query: "zoo", hint: "Animals" },
      { label: "Aquariums", query: "aquarium", hint: "Marine" }
    ]
  },
  {
    title: "Food",
    chips: [
      { label: "Restaurants", query: "restaurant", hint: "Meals" },
      { label: "Cafes", query: "cafe", hint: "Breaks" },
      { label: "Bakeries", query: "bakery", hint: "Pastries" },
      { label: "Ice cream", query: "ice cream", hint: "Treats" },
      { label: "Bars", query: "bar", hint: "Evening" },
      { label: "Wineries", query: "winery", hint: "Tasting" }
    ]
  },
  {
    title: "Relax",
    chips: [
      { label: "Spas", query: "spa", hint: "Wellness" },
      { label: "Pools", query: "swimming pool", hint: "Swim" },
      { label: "Marinas", query: "marina", hint: "Waterfront" }
    ]
  },
  {
    title: "Move",
    chips: [
      { label: "Fuel", query: "fuel", hint: "Road trip" },
      { label: "EV chargers", query: "ev charging", hint: "Charge" },
      { label: "Rest areas", query: "rest area", hint: "Breaks" },
      { label: "Parking", query: "parking", hint: "Arrivals" },
      { label: "Car rentals", query: "car rental", hint: "Rentals" },
      { label: "Airports", query: "airport", hint: "Flights" },
      { label: "Stations", query: "train station", hint: "Rail" },
      { label: "Bus stops", query: "bus stop", hint: "Transit" },
      { label: "Metro", query: "metro station", hint: "City" },
      { label: "Ferries", query: "ferry terminal", hint: "Water" }
    ]
  },
  {
    title: "Essentials",
    chips: [
      { label: "Groceries", query: "grocery", hint: "Supplies" },
      { label: "Shopping", query: "shopping mall", hint: "Malls" },
      { label: "Souvenirs", query: "souvenir shop", hint: "Gifts" },
      { label: "Pharmacies", query: "pharmacy", hint: "Health" },
      { label: "Info", query: "tourist information", hint: "Visitor help" },
      { label: "Toilets", query: "toilets", hint: "Stops" },
      { label: "Hospitals", query: "hospital", hint: "Emergency" },
      { label: "Clinics", query: "clinic", hint: "Care" },
      { label: "ATMs", query: "atm", hint: "Cash" }
    ]
  }
];

const placeChips = placeChipGroups.flatMap((group) => group.chips);

function pickPlaceChips(queries: string[]) {
  const seen = new Set<string>();
  return queries
    .map((query) => placeChips.find((chip) => chip.query === query))
    .filter((chip): chip is PlaceChip => Boolean(chip))
    .filter((chip) => {
      if (seen.has(chip.query)) return false;
      seen.add(chip.query);
      return true;
    });
}

const destinationPresets: DestinationPreset[] = [
  {
    id: "weekend-base",
    title: "Weekend base",
    hint: "Stay, sights, food",
    steps: [
      { label: "Stay", query: "hotel" },
      { label: "Sights", query: "landmark" },
      { label: "Food", query: "restaurant" }
    ]
  },
  {
    id: "city-day",
    title: "City day",
    hint: "Culture, views, breaks",
    steps: [
      { label: "Museum", query: "museum" },
      { label: "View", query: "viewpoint" },
      { label: "Cafe", query: "cafe" }
    ]
  },
  {
    id: "road-leg",
    title: "Road leg",
    hint: "Fuel, rest, food",
    steps: [
      { label: "Fuel", query: "fuel" },
      { label: "Rest", query: "rest area" },
      { label: "Food", query: "restaurant" }
    ]
  },
  {
    id: "arrival-ready",
    title: "Arrival ready",
    hint: "Park, toilet, supplies",
    steps: [
      { label: "Parking", query: "parking" },
      { label: "Toilet", query: "toilets" },
      { label: "Supplies", query: "grocery" }
    ]
  },
  {
    id: "nature-loop",
    title: "Nature loop",
    hint: "Parks, trails, views",
    steps: [
      { label: "Park", query: "park" },
      { label: "Trail", query: "trail" },
      { label: "View", query: "viewpoint" }
    ]
  }
];

function mediaUrl(item: MediaItem) {
  return item.optimizedUrl ?? item.originalUrl ?? undefined;
}

function mediaThumbUrl(item: MediaItem) {
  return item.thumbnailUrl ?? item.optimizedUrl ?? item.originalUrl ?? undefined;
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

function formatDistance(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function mediaCaptureTime(item: MediaItem) {
  if (!item.captured_at) return null;
  const time = new Date(item.captured_at).getTime();
  return Number.isNaN(time) ? null : time;
}

function mediaDateLabel(item: MediaItem) {
  const time = mediaCaptureTime(item);
  return time !== null ? new Date(time).toLocaleDateString() : null;
}

function mediaFileTitle(item: MediaItem) {
  return item.file_name.replace(/\.[^.]+$/, "").trim();
}

function mediaDestinationTitle(group: LocatedMediaGroup) {
  const lead = group.items[0];
  if (!lead) return "Media destination";
  const date = mediaDateLabel(lead);
  if (group.items.length > 1) {
    return date ? `${group.items.length} memories from ${date}` : `${group.items.length} memories`;
  }
  const kind = lead.kind === "video" ? "Video" : "Photo";
  return date ? `${kind} from ${date}` : mediaFileTitle(lead) || "Media destination";
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstAddressPart(address: PlaceSearchResult["address"] | undefined, keys: string[]) {
  if (!address) return null;
  for (const key of keys) {
    const value = address[key];
    if (value) return value;
  }
  return null;
}

function placeKindLabel(place: PlaceSearchResult) {
  const type = place.type && place.type !== "yes" ? place.type : place.category;
  return titleize(type || "Place");
}

function placeSourceLabel(place: PlaceSearchResult) {
  if (place.source === "overpass") return "OSM POI";
  if (place.source === "map") return "Map pin";
  return null;
}

function defaultPlaceNote(place: PlaceSearchResult, query = "") {
  const text = [place.category, place.type, place.name, query].join(" ").toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(hotel|resort|hostel|motel|guest house|guesthouse|apartment|chalet|cabin|camp site|camping|lodging|stay)\b/.test(text)) {
    return "Stay";
  }
  if (/\b(restaurant|food|dinner|lunch|breakfast)\b/.test(text)) return "Meal";
  if (/\b(cafe|coffee)\b/.test(text)) return "Coffee";
  if (/\b(bakery|pastry|ice cream|gelato)\b/.test(text)) return "Treat";
  if (/\b(bar|pub)\b/.test(text)) return "Drinks";
  if (/\b(fuel|gas)\b/.test(text)) return "Fuel stop";
  if (/\b(charging station|charger|ev charging)\b/.test(text)) return "Charge";
  if (/\b(rest area|rest stop)\b/.test(text)) return "Rest stop";
  if (/\b(parking)\b/.test(text)) return "Parking";
  if (/\b(airport|station|bus stop|metro|ferry|transit|rail)\b/.test(text)) return "Transit";
  if (/\b(grocery|supermarket|convenience|marketplace|supplies)\b/.test(text)) return "Supplies";
  if (/\b(souvenir|gift shop)\b/.test(text)) return "Souvenirs";
  if (/\b(pharmacy|hospital|clinic|doctors)\b/.test(text)) return "Health stop";
  if (/\b(atm|cash)\b/.test(text)) return "Cash";
  if (/\b(spa|wellness|thermal bath)\b/.test(text)) return "Relax";
  if (/\b(swimming pool|pool|water park)\b/.test(text)) return "Swim";
  if (/\b(marina)\b/.test(text)) return "Waterfront";
  if (/\b(viewpoint|photo)\b/.test(text)) return "Photo stop";
  if (/\b(playground)\b/.test(text)) return "Play";
  if (/\b(picnic)\b/.test(text)) return "Picnic";
  if (/\b(lake|peak|mountain|ski area|ski resort|skiing)\b/.test(text)) return "Outdoor stop";
  if (/\b(shopping mall|mall|shopping)\b/.test(text)) return "Shopping";
  if (/\b(winery|vineyard|wine tasting)\b/.test(text)) return "Wine tasting";
  if (/\b(tourist information|visitor center|visitor centre)\b/.test(text)) return "Visitor info";
  if (/\b(landmark|tourist attraction|attraction|museum|park|beach|monument|castle|church|cathedral|temple|mosque|synagogue|bridge|trail|waterfall|historic|ruins|zoo|aquarium|theme park)\b/.test(text)) {
    return "Visit";
  }
  return "";
}

function normalizedPlaceName(value: string) {
  return value.toLowerCase().replace(/\W+/g, "");
}

function placeLocationKey(place: PlaceSearchResult) {
  return `${normalizedPlaceName(place.name)}-${place.lat.toFixed(3)}-${place.lng.toFixed(3)}`;
}

function isKnownMapShareUrl(value: string) {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    return (
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host === "maps.google.com" ||
      host === "www.google.com" ||
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "maps.apple.com"
    );
  } catch {
    return false;
  }
}

function hasKnownMapShareUrl(value: string) {
  const matches = value.match(/https?:\/\/\S+/gi) ?? [];
  return matches.some((match) => isKnownMapShareUrl(match.replace(/[),.]+$/, "")));
}

function isRichSingleDestinationPaste(value: string) {
  return /[\r\n]/.test(value) || hasKnownMapShareUrl(value);
}

function isMapShareContextLine(value: string) {
  const text = value.trim();
  return Boolean(text) && !isKnownMapShareUrl(text) && !/^(?:day\s*\d+|d\d+|route|trip|itinerary)$/i.test(text);
}

function looksLikeAddressLine(value: string) {
  return (
    value.includes(",") &&
    (/\d/.test(value) || /\b(?:street|st|road|rd|avenue|ave|square|plaza|lane|ln|drive|dr|boulevard|blvd|city|town|village|country)\b/i.test(value))
  );
}

function collapseMapShareBlocks(value: string) {
  const lines = value.split(/\r?\n/);
  const collapsed: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!isKnownMapShareUrl(trimmed)) {
      collapsed.push(line);
      continue;
    }

    const previous = collapsed.at(-1)?.trim() ?? "";
    const beforePrevious = collapsed.at(-2)?.trim() ?? "";
    if (!isMapShareContextLine(previous)) {
      collapsed.push(line);
      continue;
    }

    collapsed.pop();
    if (looksLikeAddressLine(previous) && isMapShareContextLine(beforePrevious)) {
      collapsed.pop();
      collapsed.push(`${beforePrevious}, ${previous}`);
    } else {
      collapsed.push(previous);
    }
  }
  return collapsed.join("\n");
}

function destinationTextSegments(value: string) {
  return collapseMapShareBlocks(value)
    .replace(/\s*(?:->|=>|-->|>>|\u2192|\u21d2)\s*/g, "\n")
    .replace(/[;|]+/g, "\n")
    .split(/\r?\n/)
    .flatMap((line) => {
      if (/https?:\/\//i.test(line)) return [line];
      const routeLine = line.replace(
        /^\s*(?:route|trip|itinerary|drive|road trip)\s*[:.)-]\s*/i,
        ""
      );
      if (/\s+(?:to|via)\s+/i.test(routeLine) && !routeLine.includes(",")) {
        return routeLine.split(/\s+(?:to|via)\s+/i);
      }
      return [line];
    });
}

function extractDestinationContext(line: string) {
  const notes: string[] = [];
  let text = line.trim();

  text = text.replace(/^\s*(day\s*\d+|d\d+)\s*[:.)-]\s*/i, (_match, label: string) => {
    notes.push(label.replace(/\s+/g, " ").replace(/^d(\d+)$/i, "Day $1"));
    return "";
  });
  text = text.replace(
    /^\s*(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\s*(?::|-|\s)\s*/i,
    (_match, time: string) => {
      notes.push(time.trim().toUpperCase().replace(/\s+/g, " "));
      return "";
    }
  );
  text = text.replace(/\s+\((overnight|stay|lunch|dinner|breakfast|coffee|photo stop|optional)\)\s*$/i, (_match, label: string) => {
    notes.push(label);
    return "";
  });

  return { line: text, note: notes.join(" · ") };
}

function destinationSectionNote(note: string) {
  return note.split(" · ").find((part) => /^Day \d+$/i.test(part)) ?? "";
}

function combineDestinationNotes(...notes: string[]) {
  const parts = notes.flatMap((note) => note.split(" · ")).map((part) => part.trim()).filter(Boolean);
  return parts.filter((part, index) => parts.indexOf(part) === index).join(" · ");
}

function destinationItemKey(query: string) {
  if (/https?:\/\//i.test(query)) return query.trim();
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function mergeDestinationItems(items: DestinationListItem[]) {
  const merged: DestinationListItem[] = [];
  for (const item of items) {
    const query = item.query.trim();
    if (query.length < 3) continue;
    const key = destinationItemKey(query);
    const existingItem = merged.find((candidate) => destinationItemKey(candidate.query) === key);
    if (existingItem) {
      existingItem.note = combineDestinationNotes(existingItem.note, item.note);
      continue;
    }
    merged.push({ query, note: item.note.trim() });
    if (merged.length >= destinationListLimit) break;
  }
  return merged;
}

function cleanDestinationListLine(line: string) {
  return line
    .replace(/^\s*(?:[-*+]|\u2022|\d+[.)])\s+/, "")
    .replace(/^\s*(?:stop|destination|leg)\s*\d*\s*[:.)-]\s*/i, "")
    .replace(/^\s*(?:start|end|finish|route|trip|itinerary|drive|road trip)\s*[:.)-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.: -]+|[,.: -]+$/g, "");
}

function isDestinationNoiseLine(line: string) {
  const lower = line.toLowerCase();
  if (
    [
      "and",
      "then",
      "route",
      "trip",
      "itinerary",
      "drive",
      "road trip",
      "directions",
      "website",
      "call",
      "save",
      "share",
      "send to phone",
      "copy link",
      "reviews",
      "photos",
      "overview",
      "about",
      "menu",
      "reserve",
      "book",
      "open",
      "closed"
    ].includes(lower)
  ) {
    return true;
  }
  if (/^\+?\d[\d\s().-]{5,}$/.test(line)) return true;
  if (/^\d+(?:\.\d)?\s*(?:stars?|star rating)?$/i.test(line)) return true;
  if (/^\d+(?:\.\d)?\s*\(\s*[\d,.\s]+(?:reviews?)?\s*\)$/i.test(line)) return true;
  if (/^[\d,.\s]+reviews?$/i.test(line)) return true;
  if (/^(?:open|closed)(?:\s+now)?(?:\s*[.\u00b7-]\s*.*)?$/i.test(line)) return true;
  if (/^(?:opens|closes)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(line)) return true;
  return false;
}

function extractDestinationAction(line: string): DestinationListItem {
  if (/https?:\/\//i.test(line)) return { query: line, note: "" };
  const patterns: Array<{ pattern: RegExp; note: string }> = [
    { pattern: /^(?:hotel|stay|accommodation|lodging)\s*[:.)-]\s*(.{3,})$/i, note: "Stay" },
    { pattern: /^(?:resort|hostel|guest\s*house|apartment|cabin|camp(?:site|ground)?)\s*[:.)-]\s*(.{3,})$/i, note: "Stay" },
    { pattern: /^(lunch|dinner|breakfast|coffee)\s*[:.)-]\s*(.{3,})$/i, note: "" },
    { pattern: /^(?:meal|food|restaurant)\s*[:.)-]\s*(.{3,})$/i, note: "Meal" },
    { pattern: /^(?:cafe)\s*[:.)-]\s*(.{3,})$/i, note: "Coffee" },
    { pattern: /^(?:bar)\s*[:.)-]\s*(.{3,})$/i, note: "Drinks" },
    { pattern: /^(?:visit|sight|sights|landmark|museum|park|beach|viewpoint|attraction)\s*[:.)-]\s*(.{3,})$/i, note: "Visit" },
    { pattern: /^(?:playground|play)\s*[:.)-]\s*(.{3,})$/i, note: "Play" },
    { pattern: /^(?:picnic|picnic\s*spot)\s*[:.)-]\s*(.{3,})$/i, note: "Picnic" },
    { pattern: /^(?:photo|photo\s*stop|scenic|view|lookout)\s*[:.)-]\s*(.{3,})$/i, note: "Photo stop" },
    { pattern: /^(?:bakery|pastry|ice\s*cream|gelato)\s*[:.)-]\s*(.{3,})$/i, note: "Treat" },
    { pattern: /^(?:souvenir|souvenirs|gift\s*shop)\s*[:.)-]\s*(.{3,})$/i, note: "Souvenirs" },
    { pattern: /^(?:parking|garage)\s*[:.)-]\s*(.{3,})$/i, note: "Parking" },
    { pattern: /^(?:fuel|gas|petrol|ev\s*charge|ev\s*charging|charger)\s*[:.)-]\s*(.{3,})$/i, note: "Fuel stop" },
    { pattern: /^(?:airport|station|train|bus|metro|ferry|transit)\s*[:.)-]\s*(.{3,})$/i, note: "Transit" },
    { pattern: /^(?:stay|sleep|overnight)\s+(?:at|in)\s+(.{3,})$/i, note: "Stay" },
    { pattern: /^check[-\s]?in\s+(?:at|to)\s+(.{3,})$/i, note: "Check-in" },
    { pattern: /^(?:visit|see|explore|tour)\s+(.{3,})$/i, note: "Visit" },
    { pattern: /^(lunch|dinner|breakfast|coffee)\s+(?:at|in)\s+(.{3,})$/i, note: "" },
    { pattern: /^photo\s+stop\s+(?:at|in)\s+(.{3,})$/i, note: "Photo stop" },
    { pattern: /^stop\s+(?:at|in)\s+(.{3,})$/i, note: "Stop" },
    { pattern: /^(?:arrive|arrival)\s+(?:at|in|to)\s+(.{3,})$/i, note: "Arrive" },
    { pattern: /^(?:depart|departure)\s+from\s+(.{3,})$/i, note: "Depart" }
  ];

  for (const { pattern, note } of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const query = (match[2] ?? match[1] ?? "").trim();
    const actionNote = note || titleize(match[1] ?? "");
    if (query.length >= 3 && actionNote) return { query, note: actionNote };
  }
  return { query: line, note: "" };
}

function splitDestinationNote(line: string): DestinationListItem {
  if (/https?:\/\//i.test(line)) return { query: line, note: "" };
  const match = line.match(/^(.{3,}?)\s+(?:--|[-\u2013\u2014])\s+(.{3,})$/);
  if (!match) return { query: line, note: "" };

  const query = match[1]?.trim() ?? "";
  const note = match[2]?.trim() ?? "";
  const noteLooksIntentional =
    /^[a-z]/.test(note) ||
    /\b(?:arrive|arrival|book|booking|breakfast|check|coffee|depart|departure|dinner|flight|hotel|lunch|note|optional|overnight|photo|reservation|stay|stop|ticket|train|visit)\b/i.test(note);
  if (!query || !note || !noteLooksIntentional) return { query: line, note: "" };
  return { query, note };
}

function destinationItemsFromText(value: string) {
  const items: DestinationListItem[] = [];
  let activeSectionNote = "";
  for (const segment of destinationTextSegments(value)) {
    const context = extractDestinationContext(segment);
    const sectionNote = destinationSectionNote(context.note);
    if (sectionNote) activeSectionNote = sectionNote;
    const line = cleanDestinationListLine(context.line);
    if (!line && sectionNote) continue;
    if (line.length < 3 || isDestinationNoiseLine(line)) continue;
    const action = extractDestinationAction(line);
    const item = splitDestinationNote(action.query);
    item.note = combineDestinationNotes(activeSectionNote, context.note, action.note, item.note);
    items.push(item);
    if (mergeDestinationItems(items).length >= destinationListLimit) break;
  }
  return mergeDestinationItems(items);
}

function destinationListItemText(item: DestinationListItem) {
  return item.note ? `${item.query} - ${item.note}` : item.query;
}

function isPlaceSearchResult(value: unknown): value is PlaceSearchResult {
  if (!value || typeof value !== "object") return false;
  const place = value as PlaceSearchResult;
  return (
    typeof place.id === "string" &&
    typeof place.name === "string" &&
    typeof place.label === "string" &&
    typeof place.category === "string" &&
    typeof place.type === "string" &&
    typeof place.lat === "number" &&
    Number.isFinite(place.lat) &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lng) &&
    ["nominatim", "map", "overpass"].includes(place.source)
  );
}

function loadRecentPlaces() {
  try {
    const stored = window.localStorage.getItem(recentPlacesKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlaceSearchResult).slice(0, recentPlacesLimit);
  } catch {
    return [];
  }
}

function stopToPlace(stop: Stop): PlaceSearchResult {
  return {
    id: `stop-${stop.id}`,
    name: stop.title,
    label: `${stop.title} · ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`,
    category: stop.branch_of ? "side trip" : "saved stop",
    type: stop.branch_of ? "side trip" : "saved stop",
    lat: stop.lat,
    lng: stop.lng,
    source: "map"
  };
}

function toDateTimeInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInputValue(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timeRangeError(arrivedAt: string, departedAt: string) {
  if (!arrivedAt || !departedAt) return null;
  const arrived = new Date(arrivedAt).getTime();
  const departed = new Date(departedAt).getTime();
  if (Number.isNaN(arrived) || Number.isNaN(departed)) return null;
  return departed < arrived ? "Leave time must be after arrive time." : null;
}

export function App() {
  const shareToken = location.pathname.startsWith("/share/")
    ? location.pathname.split("/share/")[1]
    : null;
  const destinationPanelRef = useRef<HTMLElement | null>(null);
  const destinationDraftRef = useRef<HTMLDivElement | null>(null);
  const placeSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeResultFilter, setPlaceResultFilter] = useState("all");
  const [placeDraft, setPlaceDraft] = useState<PlaceSearchResult | null>(null);
  const [recentPlaces, setRecentPlaces] = useState<PlaceSearchResult[]>(() => loadRecentPlaces());
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftArrivedAt, setDraftArrivedAt] = useState("");
  const [draftDepartedAt, setDraftDepartedAt] = useState("");
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("search");
  const [destinationScope, setDestinationScope] = useState<DestinationScope>("main");
  const [destinationBranchParentId, setDestinationBranchParentId] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [routeQueue, setRouteQueue] = useState<QueuedPlace[]>([]);
  const [destinationListText, setDestinationListText] = useState("");
  const [destinationListStatus, setDestinationListStatus] = useState("");
  const [importingDestinationList, setImportingDestinationList] = useState(false);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin>("context");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [activePresetStep, setActivePresetStep] = useState(0);
  const [planningPresetId, setPlanningPresetId] = useState<string | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<"all" | "unfiled" | string>("all");
  const [newTripType, setNewTripType] = useState<Trip["type"]>("one_destination");
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newTripDescription, setNewTripDescription] = useState("");
  const [newTripFolderId, setNewTripFolderId] = useState("");
  const [newTripStartsAt, setNewTripStartsAt] = useState("");
  const [newTripEndsAt, setNewTripEndsAt] = useState("");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("active");
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [collaboratorRole, setCollaboratorRole] = useState<Collaborator["role"]>("viewer");
  const [editingTrip, setEditingTrip] = useState(false);
  const [tripTitleDraft, setTripTitleDraft] = useState("");
  const [tripDescriptionDraft, setTripDescriptionDraft] = useState("");
  const [tripFolderDraft, setTripFolderDraft] = useState("");
  const [tripStartsAtDraft, setTripStartsAtDraft] = useState("");
  const [tripEndsAtDraft, setTripEndsAtDraft] = useState("");
  const [editingStop, setEditingStop] = useState(false);
  const [stopTitleDraft, setStopTitleDraft] = useState("");
  const [stopNoteDraft, setStopNoteDraft] = useState("");
  const [stopArrivedAtDraft, setStopArrivedAtDraft] = useState("");
  const [stopDepartedAtDraft, setStopDepartedAtDraft] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const [folderData, tripData] = await Promise.all([api.folders(), api.trips()]);
    setFolders(folderData.folders);
    setTrips(tripData.trips);
    if (!selectedTripId && tripData.trips[0]) setSelectedTripId(tripData.trips[0].id);
  }, [selectedTripId, user]);

  useEffect(() => {
    if (shareToken) {
      api.sharedTrip(shareToken)
        .then(setDetail)
        .catch((error) => setError(error.message));
      return;
    }
    api.me().then(({ user }) => setUser(user)).catch(() => undefined);
  }, [shareToken]);

  useEffect(() => {
    load().catch((error) => setError(error.message));
  }, [load]);

  useEffect(() => {
    if (!selectedTripId || !user) {
      setDetail(null);
      return;
    }
    api.trip(selectedTripId).then(setDetail).catch((error) => setError(error.message));
  }, [selectedTripId, user]);

  useEffect(() => {
    if (!selectedTripId || !user) {
      setCollaborators([]);
      return;
    }
    api
      .collaborators(selectedTripId)
      .then(({ collaborators }) => setCollaborators(collaborators))
      .catch((error) => setError(error.message));
  }, [selectedTripId, user]);

  useEffect(() => {
    if (!detail?.stops.length) {
      setSelectedStopId(null);
      return;
    }
    if (!selectedStopId || !detail.stops.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(detail.stops[0]!.id);
    }
  }, [detail, selectedStopId]);

  const mediaCount = detail?.media.length ?? 0;
  const tripTiming = detail ? tripTimingLabel(detail.trip) : null;
  const currentTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const filteredTrips = useMemo(() => {
    if (selectedFolderId === "all") return trips;
    if (selectedFolderId === "unfiled") return trips.filter((trip) => !trip.folder_id);
    return trips.filter((trip) => trip.folder_id === selectedFolderId);
  }, [selectedFolderId, trips]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let unfiled = 0;
    trips.forEach((trip) => {
      if (trip.folder_id) counts.set(trip.folder_id, (counts.get(trip.folder_id) ?? 0) + 1);
      else unfiled += 1;
    });
    return { counts, unfiled };
  }, [trips]);
  const activeStop = useMemo(
    () => detail?.stops.find((stop) => stop.id === selectedStopId) ?? null,
    [detail?.stops, selectedStopId]
  );
  const orderedStops = useMemo(
    () => [...(detail?.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [detail?.stops]
  );
  const mainStops = useMemo(() => orderedStops.filter((stop) => !stop.branch_of), [orderedStops]);
  const branchStops = useMemo(() => orderedStops.filter((stop) => stop.branch_of), [orderedStops]);
  const stopById = useMemo(() => {
    const stops = new Map<string, Stop>();
    detail?.stops.forEach((stop) => stops.set(stop.id, stop));
    return stops;
  }, [detail?.stops]);
  const sideTripsByParent = useMemo(() => {
    const groups = new Map<string, Stop[]>();
    branchStops.forEach((stop) => {
      if (!stop.branch_of) return;
      groups.set(stop.branch_of, [...(groups.get(stop.branch_of) ?? []), stop]);
    });
    return groups;
  }, [branchStops]);
  const orphanBranchStops = useMemo(
    () =>
      branchStops.filter((stop) => {
        const parent = stop.branch_of ? stopById.get(stop.branch_of) : null;
        return !parent || Boolean(parent.branch_of);
      }),
    [branchStops, stopById]
  );
  const mainRouteKm = useMemo(
    () =>
      mainStops.reduce((sum, stop, index) => {
        const previous = mainStops[index - 1];
        return previous ? sum + distanceKm(previous, stop) : sum;
      }, 0),
    [mainStops]
  );
  const branchDistanceKm = useMemo(
    () =>
      branchStops.reduce((sum, stop) => {
        const parent = stop.branch_of ? stopById.get(stop.branch_of) : null;
        return parent ? sum + distanceKm(parent, stop) : sum;
      }, 0),
    [branchStops, stopById]
  );
  const stopMediaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    detail?.media.forEach((item) => {
      if (item.stop_id) counts.set(item.stop_id, (counts.get(item.stop_id) ?? 0) + 1);
    });
    return counts;
  }, [detail?.media]);
  const stopNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    detail?.notes.forEach((note) => {
      if (note.stop_id) counts.set(note.stop_id, (counts.get(note.stop_id) ?? 0) + 1);
    });
    return counts;
  }, [detail?.notes]);
  const tripCenter = useMemo(() => {
    const stops = detail?.stops ?? currentTrip?.stops ?? [];
    if (!stops.length) return undefined;
    return {
      lat: stops.reduce((sum, stop) => sum + stop.lat, 0) / stops.length,
      lng: stops.reduce((sum, stop) => sum + stop.lng, 0) / stops.length
    };
  }, [currentTrip?.stops, detail?.stops]);
  const contextSearchAnchor = useMemo(
    () => (activeStop ? { lat: activeStop.lat, lng: activeStop.lng } : tripCenter ?? mapFocus ?? undefined),
    [activeStop, mapFocus, tripCenter]
  );
  const contextSearchAnchorLabel = activeStop
    ? activeStop.title
    : detail?.stops.length
      ? detail.trip.title
      : mapFocus
        ? "map center"
        : "the map";
  const lastQueuedItem = routeQueue[routeQueue.length - 1] ?? null;
  const routeSearchAnchor = lastQueuedItem?.place;
  const searchAnchor =
    searchOrigin === "draft" && placeDraft
      ? placeDraft
      : searchOrigin === "route" && routeSearchAnchor
      ? routeSearchAnchor
      : searchOrigin === "map" && mapFocus
        ? mapFocus
        : contextSearchAnchor;
  const searchAnchorLabel =
    searchOrigin === "draft" && placeDraft
      ? "draft place"
      : searchOrigin === "route" && routeSearchAnchor
      ? "route end"
      : searchOrigin === "map" && mapFocus
        ? "map center"
        : contextSearchAnchorLabel;
  const namedSearchAnchor =
    searchOrigin === "draft" && placeDraft
      ? placeDraft.name
      : searchOrigin === "route" && routeSearchAnchor
      ? routeSearchAnchor.name
      : searchOrigin === "context" && activeStop
        ? activeStop.title
        : "";
  const contextSearchOriginTitle = activeStop ? "Selected stop" : detail?.stops.length ? "Trip area" : "Default area";
  const draftSearchOriginLabel = placeDraft?.name ?? "Select a result first";
  const routeSearchOriginLabel = routeSearchAnchor?.name ?? "Queue a stop first";
  const mapSearchOriginLabel = mapFocus
    ? `${mapFocus.lat.toFixed(3)}, ${mapFocus.lng.toFixed(3)}`
    : "Move map first";
  const rankedPlaceResults = useMemo(() => {
    if (!searchAnchor) return placeResults;
    return [...placeResults].sort((a, b) => distanceKm(searchAnchor, a) - distanceKm(searchAnchor, b));
  }, [placeResults, searchAnchor]);
  const placeResultFilters = useMemo(() => {
    const counts = new Map<string, number>();
    rankedPlaceResults.forEach((place) => {
      const label = placeKindLabel(place);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));
  }, [rankedPlaceResults]);
  const visiblePlaceResults = useMemo(
    () =>
      placeResultFilter === "all"
        ? rankedPlaceResults
        : rankedPlaceResults.filter((place) => placeKindLabel(place) === placeResultFilter),
    [placeResultFilter, rankedPlaceResults]
  );
  const recentDestinationPlaces = useMemo(() => {
    const places = new Map<string, PlaceSearchResult>();
    const addRecent = (place: PlaceSearchResult | null | undefined) => {
      if (!place) return;
      const locationKey = placeLocationKey(place);
      const hasPlace = [...places.values()].some(
        (item) => item.id === place.id || placeLocationKey(item) === locationKey
      );
      if (hasPlace) {
        return;
      }
      places.set(place.id, place);
    };

    addRecent(placeDraft);
    [...routeQueue].reverse().forEach((item) => addRecent(item.place));
    recentPlaces.forEach(addRecent);
    [...orderedStops].reverse().forEach((stop) => addRecent(stopToPlace(stop)));
    return [...places.values()].slice(0, 6);
  }, [orderedStops, placeDraft, recentPlaces, routeQueue]);
  const destinationListItems = useMemo(
    () => destinationItemsFromText(destinationListText),
    [destinationListText]
  );
  const destinationListQueries = useMemo(
    () => destinationListItems.map((item) => item.query),
    [destinationListItems]
  );
  const topVisiblePlace = visiblePlaceResults[0] ?? null;
  const newTripTimeError = timeRangeError(newTripStartsAt, newTripEndsAt);
  const tripTimeError = timeRangeError(tripStartsAtDraft, tripEndsAtDraft);
  const draftTimeError = timeRangeError(draftArrivedAt, draftDepartedAt);
  const stopTimeError = timeRangeError(stopArrivedAtDraft, stopDepartedAtDraft);
  const queuedTimeErrors = useMemo(() => {
    const errors = new Map<string, string>();
    routeQueue.forEach((item) => {
      const error = timeRangeError(item.arrivedAt, item.departedAt);
      if (error) errors.set(item.place.id, error);
    });
    return errors;
  }, [routeQueue]);
  const queuedPlaceIds = useMemo(() => new Set(routeQueue.map((item) => item.place.id)), [routeQueue]);
  const topQueueablePlaces = useMemo(
    () => visiblePlaceResults.filter((place) => !queuedPlaceIds.has(place.id) && !savedStopForPlace(place)).slice(0, 3),
    [detail?.stops, queuedPlaceIds, visiblePlaceResults]
  );
  const topVisibleSavedStop = topVisiblePlace ? savedStopForPlace(topVisiblePlace) : null;
  const topVisibleRecommendation = topVisiblePlace ? topPlaceRecommendation(topVisiblePlace, topVisibleSavedStop) : null;
  const activePreset = useMemo(
    () => destinationPresets.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId]
  );
  const activePresetQuery = activePreset?.steps[activePresetStep]?.query ?? null;
  const canAdvancePreset = Boolean(activePreset && activePresetStep < activePreset.steps.length - 1);
  const canQueueTopForPreset = Boolean(topVisiblePlace && !queuedPlaceIds.has(topVisiblePlace.id) && !topVisibleSavedStop);
  const planningActivePreset = Boolean(activePreset && planningPresetId === activePreset.id);
  const routeStarterPresets = useMemo(() => {
    const preferredIds =
      currentTrip?.type === "road_trip"
        ? ["road-leg", "arrival-ready", "nature-loop"]
        : ["weekend-base", "arrival-ready", "city-day"];
    return preferredIds
      .map((id) => destinationPresets.find((preset) => preset.id === id))
      .filter((preset): preset is DestinationPreset => Boolean(preset));
  }, [currentTrip?.type]);
  const contextualSearchChips = useMemo(() => {
    const queries =
      currentTrip?.type === "road_trip"
        ? routeQueue.length
          ? ["fuel", "ev charging", "rest area", "restaurant", "bakery", "parking"]
          : ["hotel", "fuel", "ev charging", "rest area", "parking", "restaurant"]
        : mainStops.length
          ? ["landmark", "restaurant", "cafe", "ice cream", "shopping mall", "toilets"]
          : ["hotel", "resort", "landmark", "restaurant", "viewpoint", "lake"];
    return pickPlaceChips(queries);
  }, [currentTrip?.type, mainStops.length, routeQueue.length]);
  const destinationSearchSuggestions = useMemo<DestinationSearchSuggestion[]>(() => {
    const anchor = namedSearchAnchor.trim();
    const hint = anchor ? `Near ${anchor}` : `Around ${searchAnchorLabel}`;
    const mode: DestinationMode = anchor ? "search" : "nearby";
    const query = (category: string) => (anchor ? `${category} near ${anchor}` : category);
    const seeds =
      currentTrip?.type === "road_trip"
        ? routeQueue.length
          ? [
              { label: "Fuel next", category: "fuel" },
              { label: "EV charge", category: "ev charging" },
              { label: "Rest stop", category: "rest area" },
              { label: "Food next", category: "restaurant" },
              { label: "Bakery", category: "bakery" },
              { label: "Parking", category: "parking" }
            ]
          : [
              { label: "Hotels", category: "hotel" },
              { label: "Resorts", category: "resort" },
              { label: "Fuel", category: "fuel" },
              { label: "EV charge", category: "ev charging" },
              { label: "Landmarks", category: "landmark" },
              { label: "Food", category: "restaurant" }
            ]
        : [
            { label: "Hotels", category: "hotel" },
            { label: "Resorts", category: "resort" },
            { label: "Landmarks", category: "landmark" },
            { label: "Viewpoints", category: "viewpoint" },
            { label: "Food nearby", category: "restaurant" },
            { label: "Lakes", category: "lake" },
            { label: "Shopping", category: "shopping mall" }
          ];

    return seeds.map((seed) => ({
      label: seed.label,
      query: query(seed.category),
      hint,
      mode
    }));
  }, [currentTrip?.type, namedSearchAnchor, routeQueue.length, searchAnchorLabel]);
  const draftExploreChips = useMemo(() => {
    const queries =
      currentTrip?.type === "road_trip"
        ? ["fuel", "ev charging", "rest area"]
        : destinationScope === "branch"
          ? ["landmark", "cafe", "lake"]
          : ["landmark", "restaurant", "hotel"];
    return pickPlaceChips(queries);
  }, [currentTrip?.type, destinationScope]);
  const mapSearchPreviewPlaces = useMemo(() => {
    if (destinationMode === "coordinates" || placeQuery.trim().length < 3) return [];
    return visiblePlaceResults.filter((place) => !savedStopForPlace(place)).slice(0, 12);
  }, [destinationMode, detail?.stops, placeQuery, visiblePlaceResults]);
  const mapPreviewPlaces = useMemo(() => {
    const previews = new Map<string, PlaceSearchResult>();
    routeQueue.forEach((item) => previews.set(item.place.id, item.place));
    if (placeDraft) previews.set(placeDraft.id, placeDraft);
    mapSearchPreviewPlaces.forEach((place) => {
      if (!previews.has(place.id)) previews.set(place.id, place);
    });
    return [...previews.values()];
  }, [mapSearchPreviewPlaces, placeDraft, routeQueue]);
  const routeInsertionAnchor = useMemo(() => {
    if (!activeStop) return null;
    if (!activeStop.branch_of) return activeStop;
    return stopById.get(activeStop.branch_of) ?? activeStop;
  }, [activeStop, stopById]);
  const destinationBranchParent = useMemo(
    () =>
      mainStops.find((stop) => stop.id === destinationBranchParentId) ??
      routeInsertionAnchor ??
      mainStops[0] ??
      null,
    [destinationBranchParentId, mainStops, routeInsertionAnchor]
  );
  const queueAnchor = useMemo(() => {
    const lastMainStop = mainStops[mainStops.length - 1] ?? null;
    return destinationScope === "branch" ? destinationBranchParent : routeInsertionAnchor ?? lastMainStop;
  }, [destinationBranchParent, destinationScope, mainStops, routeInsertionAnchor]);
  const mapPreviewRoute = useMemo(() => {
    if (!mapPreviewPlaces.length) return [];
    const previewPoints = mapPreviewPlaces.map((place) => ({ lat: place.lat, lng: place.lng }));
    return queueAnchor ? [{ lat: queueAnchor.lat, lng: queueAnchor.lng }, ...previewPoints] : previewPoints;
  }, [mapPreviewPlaces, queueAnchor]);
  const queuedRouteKm = useMemo(() => {
    let cursor: { lat: number; lng: number } | null = queueAnchor;
    return routeQueue.reduce((sum, item) => {
      const legKm = cursor ? distanceKm(cursor, item.place) : 0;
      cursor = item.place;
      return sum + legKm;
    }, 0);
  }, [queueAnchor, routeQueue]);
  const routeIndexByStopId = useMemo(() => {
    const indexes = new Map<string, number>();
    orderedStops.forEach((stop, index) => indexes.set(stop.id, index));
    return indexes;
  }, [orderedStops]);
  const activeMemoryScope = activeStop && memoryScope === "active" ? "active" : "all";
  const visibleMedia = useMemo(() => {
    if (!detail) return [];
    if (activeMemoryScope === "active" && activeStop) {
      return detail.media.filter((item) => item.stop_id === activeStop.id);
    }
    return detail.media;
  }, [activeMemoryScope, activeStop, detail]);
  const visibleNotes = useMemo(() => {
    if (!detail) return [];
    if (activeMemoryScope === "active" && activeStop) {
      return detail.notes.filter((note) => note.stop_id === activeStop.id);
    }
    return detail.notes;
  }, [activeMemoryScope, activeStop, detail]);
  const locatedUnassignedMedia = useMemo(
    () =>
      (detail?.media ?? []).filter(
        (item): item is LocatedMediaItem =>
          !item.stop_id &&
          typeof item.latitude === "number" &&
          Number.isFinite(item.latitude) &&
          typeof item.longitude === "number" &&
          Number.isFinite(item.longitude)
      ),
    [detail?.media]
  );
  const locatedMediaGroups = useMemo(() => {
    const groups: LocatedMediaGroup[] = [];
    const sorted = [...locatedUnassignedMedia].sort((a, b) => {
      const aTime = mediaCaptureTime(a);
      const bTime = mediaCaptureTime(b);
      if (aTime !== null && bTime !== null) return aTime - bTime;
      if (aTime !== null) return -1;
      if (bTime !== null) return 1;
      return a.file_name.localeCompare(b.file_name);
    });

    sorted.forEach((item) => {
      const match = groups.find((group) => distanceKm({ lat: group.lat, lng: group.lng }, { lat: item.latitude, lng: item.longitude }) <= 0.08);
      if (match) {
        match.items.push(item);
        match.lat = match.items.reduce((sum, media) => sum + media.latitude, 0) / match.items.length;
        match.lng = match.items.reduce((sum, media) => sum + media.longitude, 0) / match.items.length;
        return;
      }
      groups.push({
        id: item.id,
        items: [item],
        lat: item.latitude,
        lng: item.longitude
      });
    });

    return groups;
  }, [locatedUnassignedMedia]);
  const memoryTitle = activeMemoryScope === "active" && activeStop ? activeStop.title : detail?.trip.title ?? "Trip";
  const presentationGroups = useMemo(() => {
    if (!detail) return [];
    const groups: Array<{ id: string; title: string; subtitle: string; media: MediaItem[]; notes: Note[] }> = [];
    const tripMedia = detail.media.filter((item) => !item.stop_id);
    const tripNotes = detail.notes.filter((note) => !note.stop_id);
    if (tripMedia.length || tripNotes.length || !orderedStops.length) {
      groups.push({
        id: "trip",
        title: detail.trip.title,
        subtitle: "Trip notes and media",
        media: tripMedia,
        notes: tripNotes
      });
    }
    orderedStops.forEach((stop) => {
      const stopMedia = detail.media.filter((item) => item.stop_id === stop.id);
      const stopNotes = detail.notes.filter((note) => note.stop_id === stop.id);
      if (!stopMedia.length && !stopNotes.length && !stop.note) return;
      groups.push({
        id: stop.id,
        title: stop.title,
        subtitle: branchParentTitle(stop) ? `Side trip from ${branchParentTitle(stop)}` : stopSubtitle(stop),
        media: stopMedia,
        notes: stop.note
          ? [{ id: `${stop.id}-summary`, body: stop.note, stop_id: stop.id, created_at: stop.arrived_at ?? "" }, ...stopNotes]
          : stopNotes
      });
    });
    return groups;
  }, [detail, orderedStops, stopMediaCounts, stopNoteCounts]);

  useEffect(() => {
    if (!user || !trips.length) return;
    if (filteredTrips.length && (!selectedTripId || !filteredTrips.some((trip) => trip.id === selectedTripId))) {
      setSelectedTripId(filteredTrips[0]!.id);
      return;
    }
    if (!filteredTrips.length && selectedFolderId !== "all") {
      setSelectedTripId(null);
    }
  }, [filteredTrips, selectedFolderId, selectedTripId, trips.length, user]);

  useEffect(() => {
    if (!detail) return;
    setTripTitleDraft(detail.trip.title);
    setTripDescriptionDraft(detail.trip.description);
    setTripFolderDraft(detail.trip.folder_id ?? "");
    setTripStartsAtDraft(toDateTimeInputValue(detail.trip.starts_at));
    setTripEndsAtDraft(toDateTimeInputValue(detail.trip.ends_at));
  }, [detail]);

  useEffect(() => {
    if (destinationScope === "branch" && !destinationBranchParent) {
      setDestinationScope("main");
    }
  }, [destinationBranchParent, destinationScope]);

  useEffect(() => {
    if (!activeStop && memoryScope === "active") {
      setMemoryScope("all");
    }
  }, [activeStop, memoryScope]);

  useEffect(() => {
    if (searchOrigin === "route" && !routeQueue.length) {
      setSearchOrigin("context");
    }
  }, [routeQueue.length, searchOrigin]);

  useEffect(() => {
    if (searchOrigin === "draft" && !placeDraft) {
      setSearchOrigin("context");
    }
  }, [placeDraft, searchOrigin]);

  useEffect(() => {
    setPlaceResultFilter("all");
  }, [placeQuery, searchOrigin]);

  useEffect(() => {
    if (
      placeResultFilter !== "all" &&
      !placeResultFilters.some((filter) => filter.label === placeResultFilter)
    ) {
      setPlaceResultFilter("all");
    }
  }, [placeResultFilter, placeResultFilters]);

  useEffect(() => {
    if (!activeStop || editingStop) return;
    setStopTitleDraft(activeStop.title);
    setStopNoteDraft(activeStop.note ?? "");
    setStopArrivedAtDraft(toDateTimeInputValue(activeStop.arrived_at));
    setStopDepartedAtDraft(toDateTimeInputValue(activeStop.departed_at));
  }, [activeStop, editingStop]);

  useEffect(() => {
    const query = placeQuery.trim();
    if (!user || !selectedTripId || query.length < 3) {
      setPlaceResults([]);
      setSearchingPlaces(false);
      return;
    }
    let cancelled = false;
    setSearchingPlaces(true);
    const timer = window.setTimeout(() => {
      api
        .searchPlaces(query, searchAnchor)
        .then(({ places }) => {
          if (!cancelled) setPlaceResults(places);
        })
        .catch((error) => {
          if (!cancelled) setError(error.message);
        })
        .finally(() => {
          if (!cancelled) setSearchingPlaces(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placeQuery, searchAnchor, selectedTripId, user]);

  useEffect(() => {
    try {
      window.localStorage.setItem(recentPlacesKey, JSON.stringify(recentPlaces.slice(0, recentPlacesLimit)));
    } catch {
      // Local storage can be unavailable in private browsing; recents remain session-only.
    }
  }, [recentPlaces]);

  function rememberRecentPlace(place: PlaceSearchResult) {
    setRecentPlaces((items) => {
      const next = [
        place,
        ...items.filter((item) => {
          if (item.id === place.id) return false;
          if (distanceKm(item, place) <= 0.03) return false;
          return !(normalizedPlaceName(item.name) === normalizedPlaceName(place.name) && distanceKm(item, place) <= 0.5);
        })
      ];
      return next.slice(0, recentPlacesLimit);
    });
  }

  function resetDestinationDraft() {
    setPlaceDraft(null);
    setDraftTitle("");
    setDraftNote("");
    setDraftArrivedAt("");
    setDraftDepartedAt("");
    setDestinationScope("main");
    setDestinationBranchParentId("");
    setManualLat("");
    setManualLng("");
    setManualLabel("");
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
  }

  function scrollToDestinationPanel() {
    window.requestAnimationFrame(() => {
      destinationPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function scrollToDestinationDraft() {
    window.requestAnimationFrame(() => {
      destinationDraftRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function openDestinationMode(mode: DestinationMode) {
    resetDestinationDraft();
    setPlaceQuery("");
    setDestinationMode(mode);
    setError(null);
    scrollToDestinationPanel();
  }

  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      const result =
        authMode === "register"
          ? await api.register(String(form.get("name")), email, password)
          : await api.login(email, password);
      setUser(result.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openCreateTrip(type: Trip["type"]) {
    setNewTripType(type);
    setNewTripTitle(type === "road_trip" ? "Summer road trip" : "Beach weekend");
    setNewTripDescription("");
    setNewTripFolderId("");
    setNewTripStartsAt("");
    setNewTripEndsAt("");
    setShowCreateTrip(true);
  }

  function selectTripId(id: string) {
    setSelectedTripId(id);
    setPlaceQuery("");
    setRouteQueue([]);
    setDestinationListText("");
    setDestinationListStatus("");
    resetDestinationDraft();
  }

  function selectStopId(id: string | null) {
    setSelectedStopId(id);
    if (id) setMemoryScope("active");
  }

  async function createTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTripTimeError) {
      setError(newTripTimeError);
      return;
    }
    setBusy(true);
    try {
      const { trip } = await api.createTrip({
        title: newTripTitle.trim(),
        description:
          newTripDescription.trim() ||
          "Add destinations, notes, photos, and short videos as the trip unfolds.",
        type: newTripType,
        folderId: newTripFolderId || null,
        startsAt: fromDateTimeInputValue(newTripStartsAt),
        endsAt: fromDateTimeInputValue(newTripEndsAt)
      });
      setSelectedTripId(trip.id);
      setShowCreateTrip(false);
      resetDestinationDraft();
      setPlaceQuery("");
      setRouteQueue([]);
      if (newTripFolderId) setSelectedFolderId(newTripFolderId);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectPlace(place: PlaceSearchResult, options: { revealDraft?: boolean } = { revealDraft: true }) {
    rememberRecentPlace(place);
    setPlaceDraft(place);
    setDraftTitle(place.name);
    setDraftNote(defaultPlaceNote(place, placeQuery));
    setManualLat(String(Number(place.lat.toFixed(6))));
    setManualLng(String(Number(place.lng.toFixed(6))));
    setManualLabel(place.name);
    if (activeStop && currentTrip?.type === "one_destination") {
      setDestinationScope("branch");
      setDestinationBranchParentId(routeInsertionAnchor?.id ?? activeStop.id);
    }
    if (options.revealDraft !== false) scrollToDestinationDraft();
  }

  function handlePlaceSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || searchingPlaces || !topVisiblePlace) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (!busy) void addPlaceToRoute(topVisiblePlace, topVisiblePlace.name, "");
      return;
    }
    selectPlace(topVisiblePlace);
  }

  function handlePlaceSearchPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const pastedItems = destinationItemsFromText(pasted);
    const shouldSearchSingleDestination = pastedItems.length === 1 && isRichSingleDestinationPaste(pasted);
    if (pastedItems.length < 2 && !shouldSearchSingleDestination) return;

    event.preventDefault();
    if (shouldSearchSingleDestination) {
      setPlaceQuery(pastedItems[0]!.query);
      setDestinationListStatus("");
    } else {
      const existingItems = destinationItemsFromText(destinationListText);
      const merged = mergeDestinationItems([...existingItems, ...pastedItems]);
      setDestinationListText(merged.map(destinationListItemText).join("\n"));
      setDestinationListStatus(`${merged.length} ready in the destination list.`);
      setPlaceQuery("");
    }
    setPlaceResults([]);
    setPlaceResultFilter("all");
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setDestinationMode("search");
    setError(null);
  }

  function searchNearbyCategory(query: string) {
    setDestinationMode("nearby");
    setPlaceQuery(query);
    setPlaceDraft(null);
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
  }

  function applyDestinationSearchSuggestion(suggestion: DestinationSearchSuggestion) {
    setDestinationMode(suggestion.mode);
    setPlaceQuery(suggestion.query);
    setPlaceDraft(null);
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setError(null);
    window.setTimeout(() => placeSearchInputRef.current?.focus(), 0);
  }

  function searchAroundDraft(query: string) {
    if (!placeDraft) return;
    setSearchOrigin("draft");
    setDestinationMode("nearby");
    setPlaceQuery(query);
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setError(null);
  }

  function exploreAroundPlace(place: PlaceSearchResult, savedStop?: Stop | null) {
    if (savedStop) {
      selectStopId(savedStop.id);
      setSearchOrigin("context");
    } else {
      selectPlace(place, { revealDraft: false });
      setSearchOrigin("draft");
    }
    setDestinationMode("nearby");
    setPlaceQuery("landmark");
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setError(null);
  }

  function startDestinationPreset(preset: DestinationPreset) {
    setActivePresetId(preset.id);
    setActivePresetStep(0);
    setDestinationMode("nearby");
    setPlaceDraft(null);
    setPlaceQuery(preset.steps[0]?.query ?? "");
    setError(null);
  }

  function goToPresetStep(index: number) {
    if (!activePreset) return;
    const step = activePreset.steps[index];
    if (!step) return;
    setActivePresetStep(index);
    setDestinationMode("nearby");
    setPlaceDraft(null);
    setPlaceQuery(step.query);
    setError(null);
  }

  async function buildPresetQueue(preset: DestinationPreset | null = activePreset) {
    if (!preset || !selectedTripId) return;
    setActivePresetId(preset.id);
    setPlanningPresetId(preset.id);
    setDestinationMode("nearby");
    setError(null);

    const additions: QueuedPlace[] = [];
    const seenPlaceIds = new Set(routeQueue.map((item) => item.place.id));
    let cursor: { lat: number; lng: number } | undefined = queueAnchor ?? searchAnchor ?? undefined;
    let lastPlaces: PlaceSearchResult[] = [];
    let lastStepIndex = activePresetStep;
    let lastQuery = preset.steps[activePresetStep]?.query ?? preset.steps[0]?.query ?? "";

    try {
      for (const [index, step] of preset.steps.entries()) {
        const { places } = await api.searchPlaces(step.query, cursor);
        lastPlaces = places;
        lastStepIndex = index;
        lastQuery = step.query;
        const nextPlace = places.find(
          (place) =>
            !seenPlaceIds.has(place.id) &&
            !savedStopForPlace(place) &&
            !additions.some((item) => distanceKm(item.place, place) <= 0.05)
        );
        if (!nextPlace) continue;
        additions.push({
          place: nextPlace,
          title: nextPlace.name,
          note: defaultPlaceNote(nextPlace, step.query),
          arrivedAt: "",
          departedAt: ""
        });
        seenPlaceIds.add(nextPlace.id);
        cursor = nextPlace;
      }

      setPlaceQuery(lastQuery);
      setPlaceResults(lastPlaces);
      setPlaceResultFilter("all");
      setActivePresetStep(lastStepIndex);

      if (!additions.length) {
        setError("No new places found for this plan near the current search area.");
        return;
      }

      setRouteQueue((items) => {
        const existingIds = new Set(items.map((item) => item.place.id));
        return [...items, ...additions.filter((item) => !existingIds.has(item.place.id))];
      });
      additions.forEach((item) => rememberRecentPlace(item.place));
      setSearchOrigin("route");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPlanningPresetId(null);
    }
  }

  async function queueDestinationList() {
    if (!selectedTripId) return;
    const items = destinationListItems;
    if (!items.length) {
      setError("Add at least one destination line.");
      return;
    }

    setImportingDestinationList(true);
    setDestinationListStatus("");
    setDestinationMode("search");
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setError(null);

    const additions: QueuedPlace[] = [];
    const misses: DestinationListItem[] = [];
    const seenPlaceIds = new Set(routeQueue.map((item) => item.place.id));
    let cursor: { lat: number; lng: number } | undefined = queueAnchor ?? searchAnchor ?? undefined;
    let lastPlaces: PlaceSearchResult[] = [];
    let lastQuery = items[items.length - 1]?.query ?? "";

    try {
      for (const item of items) {
        const query = item.query;
        const { places } = await api.searchPlaces(query, cursor);
        lastPlaces = places;
        lastQuery = query;
        const nextPlace = places.find(
          (place) =>
            !seenPlaceIds.has(place.id) &&
            !savedStopForPlace(place) &&
            !additions.some((item) => distanceKm(item.place, place) <= 0.05)
        );

        if (!nextPlace) {
          misses.push(item);
          continue;
        }

        additions.push({
          place: nextPlace,
          title: nextPlace.name,
          note: item.note || defaultPlaceNote(nextPlace, query),
          arrivedAt: "",
          departedAt: ""
        });
        seenPlaceIds.add(nextPlace.id);
        cursor = nextPlace;
      }

      setPlaceQuery(lastQuery);
      setPlaceResults(lastPlaces);
      setPlaceResultFilter("all");

      if (!additions.length) {
        setDestinationListStatus(
          misses.length
            ? `No new matches for ${misses
                .slice(0, 3)
                .map((item) => item.query)
                .join(", ")}${misses.length > 3 ? "..." : ""}`
            : "No new places found."
        );
        return;
      }

      setRouteQueue((items) => {
        const existingIds = new Set(items.map((item) => item.place.id));
        return [...items, ...additions.filter((item) => !existingIds.has(item.place.id))];
      });
      additions.forEach((item) => rememberRecentPlace(item.place));
      setDestinationListText(misses.length ? misses.map(destinationListItemText).join("\n") : "");
      setDestinationListStatus(
        misses.length ? `${additions.length} queued · ${misses.length} left to edit` : `${additions.length} queued`
      );
      setSearchOrigin("route");
      setPlaceDraft(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingDestinationList(false);
    }
  }

  function queueTopAndAdvancePreset() {
    if (!topVisiblePlace) return;
    queuePlace(topVisiblePlace);
    if (canAdvancePreset) goToPresetStep(activePresetStep + 1);
  }

  function searchFromMapCenter() {
    if (!mapFocus) {
      setError("Move the map first, then search around the map center.");
      return;
    }
    setSearchOrigin("map");
    setError(null);
  }

  function prepareDestinationFromStop(stop: Stop, scope: DestinationScope, mode: DestinationMode = "nearby", query = "") {
    selectStopId(stop.id);
    resetDestinationDraft();
    if (scope === "branch") setDestinationBranchParentId(stop.branch_of ? stop.branch_of : stop.id);
    setDestinationScope(scope);
    setDestinationMode(mode);
    setSearchOrigin("context");
    setPlaceQuery(query);
    setError(null);
    scrollToDestinationPanel();
  }

  function useManualCoordinates() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Enter valid latitude and longitude.");
      return;
    }
    const label = manualLabel.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setError(null);
    selectPlace({
      id: `manual-${lat}-${lng}`,
      name: manualLabel.trim() || "Custom place",
      label,
      category: "coordinates",
      type: "manual",
      lat,
      lng,
      source: "map"
    });
  }

  function useMapCenterPin() {
    if (!mapFocus) {
      setError("Move the map first, then use the map center as a pin.");
      return;
    }
    setDestinationMode("coordinates");
    scrollToDestinationPanel();
    previewMapPin(mapFocus.lat, mapFocus.lng).catch((error) =>
      setError(error instanceof Error ? error.message : String(error))
    );
  }

  function destinationInsertionPlan() {
    const maxSortOrder = orderedStops.reduce((max, stop) => Math.max(max, stop.sort_order), -1);
    let sortOrder = maxSortOrder + 1;
    const branchParent = destinationScope === "branch" ? destinationBranchParent : null;
    if (destinationScope === "main" && routeInsertionAnchor) {
      sortOrder = routeInsertionAnchor.sort_order + 1;
    }
    if (destinationScope === "branch" && branchParent) {
      const siblings = sideTripsByParent.get(branchParent.id) ?? [];
      const lastRelatedStop = [branchParent, ...siblings].sort((a, b) => b.sort_order - a.sort_order)[0];
      sortOrder = (lastRelatedStop?.sort_order ?? branchParent.sort_order) + 1;
    }
    return { sortOrder, branchParent };
  }

  async function makeRoomForSortOrder(sortOrder: number, amount = 1) {
    if (!selectedTripId) return;
    const stopsToShift = orderedStops
      .filter((stop) => stop.sort_order >= sortOrder)
      .sort((a, b) => b.sort_order - a.sort_order);
    await Promise.all(
      stopsToShift.map((stop) =>
        api.updateStop(selectedTripId, stop.id, { sortOrder: stop.sort_order + amount })
      )
    );
  }

  async function previewMapPin(lat: number, lng: number) {
    if (!selectedTripId) return;
    setDestinationMode("coordinates");
    setBusy(true);
    try {
      const { place } = await api.reversePlace(lat, lng);
      selectPlace(place);
    } catch {
      const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      selectPlace({
        id: `map-${lat}-${lng}`,
        name: "Dropped pin",
        label,
        category: "map pin",
        type: "pin",
        lat,
        lng,
        source: "map"
      });
    } finally {
      setBusy(false);
    }
  }

  async function addPlaceToRoute(
    place: PlaceSearchResult,
    title: string,
    note: string,
    arrivedAt = "",
    departedAt = "",
    options: { inferNote?: boolean } = {}
  ) {
    if (!selectedTripId) return;
    const savedStop = savedStopForPlace(place);
    if (savedStop) {
      selectStopId(savedStop.id);
      resetDestinationDraft();
      setError(null);
      return;
    }
    const timingError = timeRangeError(arrivedAt, departedAt);
    if (timingError) {
      setError(timingError);
      return;
    }
    setBusy(true);
    setError(null);
    rememberRecentPlace(place);
    const { sortOrder, branchParent } = destinationInsertionPlan();
    try {
      await makeRoomForSortOrder(sortOrder);
      const { stop } = await api.addStop(selectedTripId, {
        title: title.trim() || place.name || `Stop ${sortOrder + 1}`,
        note: note.trim() || (options.inferNote === false ? "" : defaultPlaceNote(place, placeQuery)),
        lat: place.lat,
        lng: place.lng,
        sortOrder,
        arrivedAt: fromDateTimeInputValue(arrivedAt),
        departedAt: fromDateTimeInputValue(departedAt),
        branchOf: branchParent ? branchParent.id : null
      });
      setDetail(await api.trip(selectedTripId));
      selectStopId(stop.id);
      resetDestinationDraft();
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addStopFromDraft() {
    if (!placeDraft) return;
    await addPlaceToRoute(placeDraft, draftTitle, draftNote, draftArrivedAt, draftDepartedAt, { inferNote: false });
  }

  function queuePlace(place: PlaceSearchResult, title = place.name, note = "", arrivedAt = "", departedAt = "", inferNote = true) {
    const savedStop = savedStopForPlace(place);
    if (savedStop) {
      selectStopId(savedStop.id);
      setError(null);
      return;
    }
    const queuedNote = note.trim() || (inferNote ? defaultPlaceNote(place, placeQuery) : "");
    setRouteQueue((items) =>
      items.some((item) => item.place.id === place.id)
        ? items.map((item) =>
            item.place.id === place.id
              ? { ...item, title: title.trim() || place.name, note: queuedNote, arrivedAt, departedAt }
              : item
          )
        : [...items, { place, title: title.trim() || place.name, note: queuedNote, arrivedAt, departedAt }]
    );
    rememberRecentPlace(place);
    setSearchOrigin("route");
  }

  function exploreQueuedPlace(item: QueuedPlace) {
    setPlaceDraft(item.place);
    setDraftTitle(item.title || item.place.name);
    setDraftNote(item.note);
    setDraftArrivedAt(item.arrivedAt);
    setDraftDepartedAt(item.departedAt);
    setManualLat(String(Number(item.place.lat.toFixed(6))));
    setManualLng(String(Number(item.place.lng.toFixed(6))));
    setManualLabel(item.title || item.place.name);
    setSearchOrigin("draft");
    setDestinationMode("nearby");
    setPlaceQuery("landmark");
    setActivePresetId(null);
    setActivePresetStep(0);
    setPlanningPresetId(null);
    setError(null);
    scrollToDestinationPanel();
  }

  function selectPreviewPlaceFromMap(placeId: string) {
    const queued = routeQueue.find((item) => item.place.id === placeId);
    if (queued) {
      exploreQueuedPlace(queued);
      return;
    }
    const place =
      placeDraft?.id === placeId
        ? placeDraft
        : mapSearchPreviewPlaces.find((item) => item.id === placeId) ??
          mapPreviewPlaces.find((item) => item.id === placeId);
    if (!place) return;
    selectPlace(place);
    setError(null);
  }

  function queueTopVisiblePlaces() {
    topQueueablePlaces.forEach((place) => queuePlace(place));
  }

  function queueDraftPlace() {
    if (!placeDraft) return;
    if (draftTimeError) {
      setError(draftTimeError);
      return;
    }
    queuePlace(placeDraft, draftTitle, draftNote, draftArrivedAt, draftDepartedAt, false);
    resetDestinationDraft();
  }

  function removeQueuedPlace(placeId: string) {
    setRouteQueue((items) => items.filter((item) => item.place.id !== placeId));
  }

  function moveQueuedPlace(placeId: string, direction: -1 | 1) {
    setRouteQueue((items) => {
      const index = items.findIndex((item) => item.place.id === placeId);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= items.length) return items;
      const next = [...items];
      const current = next[index]!;
      next[index] = next[swapIndex]!;
      next[swapIndex] = current;
      return next;
    });
  }

  function updateQueuedPlace(placeId: string, input: Partial<Omit<QueuedPlace, "place">>) {
    setRouteQueue((items) =>
      items.map((item) => (item.place.id === placeId ? { ...item, ...input } : item))
    );
  }

  function optimizeQueuedPlaces() {
    setRouteQueue((items) => {
      if (items.length < 3) return items;
      const remaining = [...items];
      const ordered: QueuedPlace[] = [];
      let cursor: { lat: number; lng: number } | null = queueAnchor;
      while (remaining.length) {
        const origin = cursor;
        const nextIndex = origin
          ? remaining.reduce((bestIndex, item, index) => {
              const best = remaining[bestIndex]!;
              return distanceKm(origin, item.place) < distanceKm(origin, best.place) ? index : bestIndex;
            }, 0)
          : 0;
        const [next] = remaining.splice(nextIndex, 1);
        if (!next) break;
        ordered.push(next);
        cursor = next.place;
      }
      return ordered;
    });
  }

  async function addQueuedPlaces() {
    if (!selectedTripId || !routeQueue.length) return;
    if (queuedTimeErrors.size) {
      setError("Fix queued destination times before adding them to the route.");
      return;
    }
    setBusy(true);
    setError(null);
    const { sortOrder, branchParent } = destinationInsertionPlan();
    try {
      await makeRoomForSortOrder(sortOrder, routeQueue.length);
      const created: Stop[] = [];
      for (const [index, item] of routeQueue.entries()) {
        const place = item.place;
        const { stop } = await api.addStop(selectedTripId, {
          title: item.title.trim() || place.name || `Stop ${sortOrder + index + 1}`,
          note: item.note.trim(),
          lat: place.lat,
          lng: place.lng,
          sortOrder: sortOrder + index,
          arrivedAt: fromDateTimeInputValue(item.arrivedAt),
          departedAt: fromDateTimeInputValue(item.departedAt),
          branchOf: branchParent ? branchParent.id : null
        });
        created.push(stop);
      }
      setDetail(await api.trip(selectedTripId));
      const lastCreated = created[created.length - 1];
      if (lastCreated) selectStopId(lastCreated.id);
      setRouteQueue([]);
      resetDestinationDraft();
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createMediaGroupStop(group: LocatedMediaGroup, sortOrder: number) {
    if (!selectedTripId || !group.items.length) return null;
    const { stop } = await api.addStop(selectedTripId, {
      title: mediaDestinationTitle(group),
      note:
        group.items.length === 1
          ? "Created from media location metadata."
          : `Created from ${group.items.length} media files with location metadata.`,
      lat: group.lat,
      lng: group.lng,
      sortOrder
    });
    await Promise.all(group.items.map((item) => api.updateMedia(item.id, stop.id)));
    return stop;
  }

  async function createStopFromMediaGroup(group: LocatedMediaGroup) {
    if (!selectedTripId || !group.items.length) return;
    setBusy(true);
    setError(null);
    const maxSortOrder = orderedStops.reduce((max, stop) => Math.max(max, stop.sort_order), -1);
    try {
      const stop = await createMediaGroupStop(group, maxSortOrder + 1);
      setDetail(await api.trip(selectedTripId));
      if (stop) {
        selectStopId(stop.id);
        setMemoryScope("active");
      }
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createAllStopsFromMedia() {
    if (!selectedTripId || !locatedMediaGroups.length) return;
    setBusy(true);
    setError(null);
    const maxSortOrder = orderedStops.reduce((max, stop) => Math.max(max, stop.sort_order), -1);
    try {
      const created: Stop[] = [];
      for (const [index, group] of locatedMediaGroups.entries()) {
        const stop = await createMediaGroupStop(group, maxSortOrder + index + 1);
        if (stop) created.push(stop);
      }
      setDetail(await api.trip(selectedTripId));
      const lastCreated = created[created.length - 1];
      if (lastCreated) {
        selectStopId(lastCreated.id);
        setMemoryScope("active");
      }
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || !selectedTripId) return;
    setBusy(true);
    try {
      await api.upload(selectedTripId, files, activeMemoryScope === "active" ? selectedStopId : null);
      setDetail(await api.trip(selectedTripId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!selectedTripId || !noteDraft.trim()) return;
    setBusy(true);
    try {
      await api.addNote(selectedTripId, noteDraft.trim(), activeMemoryScope === "active" ? selectedStopId : null);
      setNoteDraft("");
      setDetail(await api.trip(selectedTripId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const { share } = await api.share(detail.trip.id);
      const url = `${location.origin}/share/${share.token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 2400);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addCollaborator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTripId || !collaboratorEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { collaborator } = await api.addCollaborator(
        selectedTripId,
        collaboratorEmail.trim(),
        collaboratorRole
      );
      setCollaborators((items) => [
        ...items.filter((item) => item.user_id !== collaborator.user_id),
        collaborator
      ]);
      setCollaboratorEmail("");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeCollaborator(userId: string) {
    if (!selectedTripId) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeCollaborator(selectedTripId, userId);
      setCollaborators((items) => items.filter((item) => item.user_id !== userId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveTripEdits() {
    if (!selectedTripId || !detail) return;
    if (tripTimeError) {
      setError(tripTimeError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateTrip(selectedTripId, {
        title: tripTitleDraft.trim() || detail.trip.title,
        description: tripDescriptionDraft.trim(),
        folderId: tripFolderDraft || null,
        startsAt: fromDateTimeInputValue(tripStartsAtDraft),
        endsAt: fromDateTimeInputValue(tripEndsAtDraft)
      });
      setEditingTrip(false);
      setDetail(await api.trip(selectedTripId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveActiveStop() {
    if (!selectedTripId || !activeStop) return;
    if (stopTimeError) {
      setError(stopTimeError);
      return;
    }
    setBusy(true);
    try {
      await api.updateStop(selectedTripId, activeStop.id, {
        title: stopTitleDraft.trim() || activeStop.title,
        note: stopNoteDraft.trim(),
        arrivedAt: fromDateTimeInputValue(stopArrivedAtDraft),
        departedAt: fromDateTimeInputValue(stopDepartedAtDraft)
      });
      setEditingStop(false);
      setDetail(await api.trip(selectedTripId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteActiveStop() {
    if (!selectedTripId || !activeStop) return;
    if (!window.confirm(`Delete ${activeStop.title}?`)) return;
    setBusy(true);
    try {
      await api.deleteStop(selectedTripId, activeStop.id);
      selectStopId(null);
      setMemoryScope("all");
      setEditingStop(false);
      setDetail(await api.trip(selectedTripId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function moveStop(stop: Stop, direction: -1 | 1) {
    if (!selectedTripId || !detail) return;
    const ordered = [...detail.stops].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === stop.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    setBusy(true);
    try {
      await Promise.all([
        api.updateStop(selectedTripId, stop.id, { sortOrder: swap.sort_order }),
        api.updateStop(selectedTripId, swap.id, { sortOrder: stop.sort_order })
      ]);
      setDetail(await api.trip(selectedTripId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function stopSubtitle(stop: Stop) {
    const media = stopMediaCounts.get(stop.id) ?? 0;
    const notes = stopNoteCounts.get(stop.id) ?? 0;
    const bits = [`${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`];
    const timing = stopTimingLabel(stop);
    if (timing) bits.unshift(timing);
    if (media) bits.push(`${media} media`);
    if (notes) bits.push(`${notes} notes`);
    return bits.join(" · ");
  }

  function formatStopDateTime(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function stopTimingLabel(stop: Stop) {
    const arrived = formatStopDateTime(stop.arrived_at);
    const departed = formatStopDateTime(stop.departed_at);
    if (arrived && departed) return `${arrived} to ${departed}`;
    if (arrived) return `Arrive ${arrived}`;
    if (departed) return `Leave ${departed}`;
    return null;
  }

  function tripTimingLabel(trip: Trip) {
    const starts = formatStopDateTime(trip.starts_at);
    const ends = formatStopDateTime(trip.ends_at);
    if (starts && ends) return `${starts} to ${ends}`;
    if (starts) return `Starts ${starts}`;
    if (ends) return `Ends ${ends}`;
    return null;
  }

  function branchParentTitle(stop: Stop) {
    if (!stop.branch_of) return null;
    return stopById.get(stop.branch_of)?.title ?? "another stop";
  }

  function placeDistanceLabel(place: PlaceSearchResult) {
    if (!searchAnchor) return null;
    return `${formatDistance(distanceKm(searchAnchor, place))} away`;
  }

  function savedStopForPlace(place: PlaceSearchResult) {
    const placeName = normalizedPlaceName(place.name);
    return (
      detail?.stops.find((stop) => {
        const stopDistanceKm = distanceKm(stop, place);
        if (stopDistanceKm <= 0.05) return true;
        return placeName.length > 2 && normalizedPlaceName(stop.title) === placeName && stopDistanceKm <= 0.5;
      }) ?? null
    );
  }

  function placeAreaLabel(place: PlaceSearchResult) {
    const city = firstAddressPart(place.address, ["city", "town", "village", "municipality", "hamlet"]);
    const area = firstAddressPart(place.address, ["suburb", "neighbourhood", "quarter", "borough"]);
    const region = firstAddressPart(place.address, ["state", "county", "region"]);
    const country = firstAddressPart(place.address, ["country"]);
    const parts = [area, city, region, country].filter((part, index, list): part is string =>
      Boolean(part && list.indexOf(part) === index)
    );
    return parts.slice(0, 2).join(", ");
  }

  function placeAddressLabel(place: PlaceSearchResult) {
    const road = firstAddressPart(place.address, ["road", "pedestrian", "footway", "neighbourhood"]);
    const houseNumber = firstAddressPart(place.address, ["house_number"]);
    const city = firstAddressPart(place.address, ["city", "town", "village", "municipality"]);
    const localAddress = [houseNumber, road].filter(Boolean).join(" ");
    const parts = [localAddress, city].filter(Boolean);
    return parts.length ? parts.join(", ") : place.label;
  }

  function destinationPlacementLabel() {
    if (destinationScope === "branch" && destinationBranchParent) return `Side trip from ${destinationBranchParent.title}`;
    if (destinationScope === "main" && routeInsertionAnchor) return `Main route after ${routeInsertionAnchor.title}`;
    return "Main route at the end";
  }

  function destinationPlacementHint() {
    if (destinationScope === "branch" && destinationBranchParent) {
      return `Grouped below ${destinationBranchParent.title}`;
    }
    if (destinationScope === "main" && routeInsertionAnchor) {
      return "Later stops shift down";
    }
    const lastMainStop = mainStops[mainStops.length - 1];
    if (lastMainStop) return `After ${lastMainStop.title}`;
    return "First stop in this trip";
  }

  function queuedAddLabel() {
    const count = routeQueue.length;
    if (destinationScope === "branch" && destinationBranchParent) {
      return `Add ${count} side trip${count === 1 ? "" : "s"}`;
    }
    if (destinationScope === "main" && routeInsertionAnchor) {
      return `Insert ${count} stop${count === 1 ? "" : "s"}`;
    }
    return `Add ${count} to route`;
  }

  function queuedCommitHint() {
    if (destinationScope === "branch" && destinationBranchParent) {
      return `Creates side trips under ${destinationBranchParent.title} in the order shown.`;
    }
    if (destinationScope === "main" && routeInsertionAnchor) {
      return `Inserts after ${routeInsertionAnchor.title} and shifts later stops down.`;
    }
    return "Adds these destinations to the end of the main route in the order shown.";
  }

  function destinationAddLabel(savedStop?: Stop | null) {
    if (savedStop) return "Open saved";
    if (destinationScope === "branch" && destinationBranchParent) return "Add side trip";
    if (destinationScope === "main" && routeInsertionAnchor) return "Insert next";
    if (mainStops.length) return "Add to route";
    return "Add first stop";
  }

  function destinationQueueLabel(place?: PlaceSearchResult | null, savedStop?: Stop | null) {
    if (savedStop) return "Saved";
    if (place && queuedPlaceIds.has(place.id)) return "Queued";
    if (destinationScope === "branch" && destinationBranchParent) return "Queue side trip";
    return "Queue";
  }

  function destinationResultActionLabel(place: PlaceSearchResult, savedStop?: Stop | null) {
    if (savedStop) return "Saved";
    if (queuedPlaceIds.has(place.id)) return "Queued";
    if (destinationScope === "branch" && destinationBranchParent) return "Side trip";
    if (destinationScope === "main" && routeInsertionAnchor) return "Insert";
    if (mainStops.length) return "Append";
    return "Start";
  }

  function destinationResultActionHint(place: PlaceSearchResult, savedStop?: Stop | null) {
    if (savedStop) return savedStop.title;
    if (queuedPlaceIds.has(place.id)) return destinationPlacementLabel();
    if (destinationScope === "branch" && destinationBranchParent) return destinationBranchParent.title;
    if (destinationScope === "main" && routeInsertionAnchor) return routeInsertionAnchor.title;
    const lastMainStop = mainStops[mainStops.length - 1];
    if (lastMainStop) return lastMainStop.title;
    return detail?.trip.title ?? "Trip";
  }

  function topPlaceRecommendation(place: PlaceSearchResult, savedStop?: Stop | null) {
    const context = [placeKindLabel(place), placeDistanceLabel(place), placeAreaLabel(place)]
      .filter(Boolean)
      .join(" · ");
    if (savedStop) {
      return {
        title: `Already saved as ${savedStop.title}`,
        hint: context || "Open the saved stop or explore nearby places from it."
      };
    }
    if (destinationScope === "branch" && destinationBranchParent) {
      return {
        title: `Best match becomes a side trip from ${destinationBranchParent.title}`,
        hint: context || "Queued places will stay grouped under the same parent stop."
      };
    }
    if (destinationScope === "main" && routeInsertionAnchor) {
      return {
        title: `Best match inserts after ${routeInsertionAnchor.title}`,
        hint: context || "Later stops will move down to keep the route order."
      };
    }
    if (mainStops.length) {
      return {
        title: "Best match adds to the end of this route",
        hint: context || "Queue more results first if you want to commit several stops together."
      };
    }
    return {
      title: "Best match can start this trip",
      hint: context || "Add it now or queue nearby ideas first."
    };
  }

  function mediaGroupLocationLabel(group: LocatedMediaGroup) {
    const coordinates = `${group.lat.toFixed(4)}, ${group.lng.toFixed(4)}`;
    const dates = group.items
      .map(mediaDateLabel)
      .filter((date, index, list): date is string => Boolean(date && list.indexOf(date) === index));
    if (!dates.length) return coordinates;
    if (dates.length === 1) return `${coordinates} · ${dates[0]}`;
    return `${coordinates} · ${dates[0]} to ${dates[dates.length - 1]}`;
  }

  function queuedLegLabel(item: QueuedPlace, index: number) {
    const previous = index === 0 ? queueAnchor : routeQueue[index - 1]?.place;
    const place = item.place;
    return previous ? `${formatDistance(distanceKm(previous, place))} leg` : place.category;
  }

  function renderStopCard(stop: Stop, variant: "main" | "branch" = "main") {
    const index = routeIndexByStopId.get(stop.id) ?? 0;
    return (
      <article
        key={stop.id}
        className={[
          stop.id === selectedStopId ? "stop-card active" : "stop-card",
          variant === "branch" ? "branch-stop-card" : ""
        ].filter(Boolean).join(" ")}
      >
        <button className="stop-main" onClick={() => selectStopId(stop.id)} type="button">
          <strong>{stop.title}</strong>
          <small>{stopSubtitle(stop)}</small>
          {branchParentTitle(stop) ? (
            <span className="branch-label">
              <GitBranch size={13} /> From {branchParentTitle(stop)}
            </span>
          ) : null}
          {stop.note ? <p>{stop.note}</p> : null}
        </button>
        <div className="stop-actions">
          <GripVertical size={16} />
          <button
            className="icon-button mini-button"
            onClick={() => moveStop(stop, -1)}
            disabled={busy || index === 0}
            title="Move stop up"
            type="button"
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="icon-button mini-button"
            onClick={() => moveStop(stop, 1)}
            disabled={busy || index === orderedStops.length - 1}
            title="Move stop down"
            type="button"
          >
            <ChevronDown size={15} />
          </button>
        </div>
        {variant === "main" ? (
          <div className="stop-quick-actions">
            <button onClick={() => prepareDestinationFromStop(stop, "main", "search")} disabled={busy} type="button">
              <Plus size={14} /> Add after
            </button>
            <button onClick={() => prepareDestinationFromStop(stop, "branch")} disabled={busy} type="button">
              <GitBranch size={14} /> Side trip
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  if (shareToken) {
    return (
      <main className="share-screen">
        {detail ? (
          <section className="share-shell">
            <TripMap
              trips={[{ ...detail.trip, stops: detail.stops }]}
              selectedTripId={detail.trip.id}
              onSelectTrip={() => undefined}
              onMapClick={() => undefined}
            />
            <aside className="share-panel">
              <p className="eyebrow">Shared TripMap</p>
              <h1>{detail.trip.title}</h1>
              <p>{detail.trip.description}</p>
              <div className="stats-grid">
                <span><MapPin /> {detail.stops.length} stops</span>
                {tripTiming ? <span><CalendarDays /> {tripTiming}</span> : null}
                <span><Image /> {detail.media.length} media</span>
                <span><Route /> {mainRouteKm ? formatDistance(mainRouteKm) : "0 m"} route</span>
                <span>
                  <GitBranch /> {branchStops.length} side trips
                  {branchDistanceKm ? ` · ${formatDistance(branchDistanceKm)}` : ""}
                </span>
              </div>
              {presentationGroups.length ? (
                <div className="share-story">
                  {presentationGroups.map((group) => (
                    <section className="share-stop" key={group.id}>
                      <div>
                        <p className="eyebrow">{group.subtitle}</p>
                        <h3>{group.title}</h3>
                      </div>
                      {group.notes.length ? (
                        <div className="note-list">
                          {group.notes.map((note) => (
                            <article key={note.id}>
                              <p>{note.body}</p>
                            </article>
                          ))}
                        </div>
                      ) : null}
                      {group.media.length ? (
                        <div className="presentation-media compact">
                          {group.media.map((item) =>
                            item.kind === "video" ? (
                              <video key={item.id} src={mediaUrl(item)} controls />
                            ) : (
                              <img key={item.id} src={mediaUrl(item)} alt={item.file_name} />
                            )
                          )}
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              ) : (
                <p className="muted">No notes, photos, or videos have been added yet.</p>
              )}
            </aside>
          </section>
        ) : (
          <section className="auth-panel">
            <div className="brand-row"><MapPin /><strong>TripMap</strong></div>
            <p>{error ?? "Loading shared trip..."}</p>
          </section>
        )}
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand-row">
            <MapPin />
            <strong>TripMap</strong>
          </div>
          <h1>Save the places that made the trip.</h1>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === "register" ? (
              <input name="name" placeholder="Name" required />
            ) : null}
            <input name="email" placeholder="Email" type="email" required />
            <input name="password" placeholder="Password" type="password" minLength={8} required />
            {error ? <p className="error">{error}</p> : null}
            <button disabled={busy}>{authMode === "register" ? "Create account" : "Sign in"}</button>
          </form>
          <button className="text-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
            {authMode === "login" ? "Create an account" : "I already have an account"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <MapPin />
          <strong>TripMap</strong>
          <button className="icon-button push" title="Sign out" onClick={() => api.logout().then(() => setUser(null))}>
            <LogOut size={18} />
          </button>
        </div>

        <div className="action-row">
          <button onClick={() => openCreateTrip("one_destination")} disabled={busy}>
            <Plus size={16} /> Destination
          </button>
          <button onClick={() => openCreateTrip("road_trip")} disabled={busy}>
            <Route size={16} /> Road trip
          </button>
        </div>

        {showCreateTrip ? (
          <form className="create-trip-panel" onSubmit={createTrip}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New trip</p>
                <h3>{newTripType === "road_trip" ? "Road trip" : "One destination"}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowCreateTrip(false)} title="Close">
                <X size={17} />
              </button>
            </div>
            <input
              value={newTripTitle}
              onChange={(event) => setNewTripTitle(event.target.value)}
              placeholder="Trip name"
              required
            />
            <textarea
              value={newTripDescription}
              onChange={(event) => setNewTripDescription(event.target.value)}
              placeholder="Short description"
              rows={3}
            />
            <div className="time-row">
              <label>
                <span>Starts</span>
                <input
                  type="datetime-local"
                  value={newTripStartsAt}
                  onChange={(event) => setNewTripStartsAt(event.target.value)}
                />
              </label>
              <label>
                <span>Ends</span>
                <input
                  type="datetime-local"
                  value={newTripEndsAt}
                  onChange={(event) => setNewTripEndsAt(event.target.value)}
                />
              </label>
            </div>
            {newTripTimeError ? <small className="field-error">{newTripTimeError}</small> : null}
            <select value={newTripFolderId} onChange={(event) => setNewTripFolderId(event.target.value)}>
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
            <button className="wide-button" disabled={busy || !newTripTitle.trim() || Boolean(newTripTimeError)}>
              <Check size={16} /> Create trip
            </button>
          </form>
        ) : null}

        <section className="folder-strip">
          <button
            className="folder-create"
            onClick={async () => {
              const title = window.prompt("Folder name");
              if (!title) return;
              const { folder } = await api.createFolder(title, "#16a34a");
              setSelectedFolderId(folder.id);
              await load();
            }}
          >
            <FolderPlus size={16} /> Folder
          </button>
          <button
            className={selectedFolderId === "all" ? "folder-pill active" : "folder-pill"}
            onClick={() => setSelectedFolderId("all")}
            type="button"
          >
            <ListFilter size={14} /> All <small>{trips.length}</small>
          </button>
          <button
            className={selectedFolderId === "unfiled" ? "folder-pill active" : "folder-pill"}
            onClick={() => setSelectedFolderId("unfiled")}
            type="button"
          >
            Unfiled <small>{folderCounts.unfiled}</small>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={selectedFolderId === folder.id ? "folder-pill active" : "folder-pill"}
              style={{ borderColor: folder.color }}
              onClick={() => setSelectedFolderId(folder.id)}
              type="button"
            >
              {folder.title} <small>{folderCounts.counts.get(folder.id) ?? 0}</small>
            </button>
          ))}
        </section>

        <section className="trip-list">
          {filteredTrips.map((trip) => (
            <button
              key={trip.id}
              className={trip.id === selectedTripId ? "trip-card active" : "trip-card"}
              onClick={() => selectTripId(trip.id)}
            >
              <span>{trip.type === "road_trip" ? <Route size={16} /> : <MapPin size={16} />}</span>
              <strong>{trip.title}</strong>
              <small>{trip.stops.length} stops{trip.folder_title ? ` · ${trip.folder_title}` : ""}</small>
            </button>
          ))}
          {!filteredTrips.length ? <p className="muted sidebar-empty">No trips in this folder.</p> : null}
        </section>
      </aside>

      <section className="map-stage">
        <TripMap
          trips={filteredTrips}
          selectedTripId={selectedTripId}
          selectedStopId={selectedStopId}
          previewPlace={placeDraft}
          previewPlaces={mapPreviewPlaces}
          previewRoute={mapPreviewRoute}
          onSelectTrip={selectTripId}
          onSelectStop={selectStopId}
          onSelectPreviewPlace={selectPreviewPlaceFromMap}
          onMapClick={previewMapPin}
          onViewChange={setMapFocus}
        />
      </section>

      <aside className="detail-panel">
        {detail ? (
          <>
            <section className="trip-summary">
              <div className="context-top">
                <div>
                  <p className="eyebrow">{detail.trip.type === "road_trip" ? "Road trip" : "One destination"}</p>
                  <h2>{detail.trip.title}</h2>
                </div>
                <button
                  className="icon-button mini-button"
                  onClick={() => setEditingTrip(true)}
                  title="Edit trip"
                  type="button"
                >
                  <Pencil size={15} />
                </button>
              </div>
              {editingTrip ? (
                <div className="stop-editor">
                  <input
                    value={tripTitleDraft}
                    onChange={(event) => setTripTitleDraft(event.target.value)}
                    placeholder="Trip name"
                  />
                  <textarea
                    value={tripDescriptionDraft}
                    onChange={(event) => setTripDescriptionDraft(event.target.value)}
                    placeholder="Short description"
                    rows={3}
                  />
                  <div className="time-row">
                    <label>
                      <span>Starts</span>
                      <input
                        type="datetime-local"
                        value={tripStartsAtDraft}
                        onChange={(event) => setTripStartsAtDraft(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Ends</span>
                      <input
                        type="datetime-local"
                        value={tripEndsAtDraft}
                        onChange={(event) => setTripEndsAtDraft(event.target.value)}
                      />
                    </label>
                  </div>
                  {tripTimeError ? <small className="field-error">{tripTimeError}</small> : null}
                  <select value={tripFolderDraft} onChange={(event) => setTripFolderDraft(event.target.value)}>
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.title}
                      </option>
                    ))}
                  </select>
                  <div className="editor-actions">
                    <button className="wide-button" onClick={saveTripEdits} disabled={busy || Boolean(tripTimeError)} type="button">
                      <Check size={16} /> Save
                    </button>
                    <button
                      className="wide-button subtle"
                      onClick={() => {
                        setEditingTrip(false);
                        setTripTitleDraft(detail.trip.title);
                        setTripDescriptionDraft(detail.trip.description);
                        setTripFolderDraft(detail.trip.folder_id ?? "");
                        setTripStartsAtDraft(toDateTimeInputValue(detail.trip.starts_at));
                        setTripEndsAtDraft(toDateTimeInputValue(detail.trip.ends_at));
                      }}
                      type="button"
                    >
                      <X size={16} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p>{detail.trip.description}</p>
              )}
            </section>

            <div className="stats-grid">
              <span><MapPin /> {detail.stops.length} stops</span>
              {tripTiming ? <span><CalendarDays /> {tripTiming}</span> : null}
              <span><Image /> {mediaCount} media</span>
              <span><Route /> {mainRouteKm ? formatDistance(mainRouteKm) : "0 m"} route</span>
              <span>
                <GitBranch /> {branchStops.length} side trips
                {branchDistanceKm ? ` · ${formatDistance(branchDistanceKm)}` : ""}
              </span>
            </div>

            {activeStop ? (
              <section className="active-context">
                <div className="context-top">
                  <div>
                    <p className="eyebrow">Active stop</p>
                    <strong>{activeStop.title}</strong>
                  </div>
                  <div className="context-actions">
                    <button
                      className="icon-button mini-button"
                      onClick={() => {
                        setStopTitleDraft(activeStop.title);
                        setStopNoteDraft(activeStop.note ?? "");
                        setStopArrivedAtDraft(toDateTimeInputValue(activeStop.arrived_at));
                        setStopDepartedAtDraft(toDateTimeInputValue(activeStop.departed_at));
                        setEditingStop(true);
                      }}
                      title="Edit stop"
                      type="button"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button mini-button danger-button"
                      onClick={deleteActiveStop}
                      title="Delete stop"
                      type="button"
                      disabled={busy}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {editingStop ? (
                  <div className="stop-editor">
                    <input
                      value={stopTitleDraft}
                      onChange={(event) => setStopTitleDraft(event.target.value)}
                      placeholder="Stop title"
                    />
                    <textarea
                      value={stopNoteDraft}
                      onChange={(event) => setStopNoteDraft(event.target.value)}
                      placeholder="Private stop note"
                      rows={3}
                    />
                    <div className="time-row">
                      <label>
                        <span>Arrive</span>
                        <input
                          type="datetime-local"
                          value={stopArrivedAtDraft}
                          onChange={(event) => setStopArrivedAtDraft(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Leave</span>
                        <input
                          type="datetime-local"
                          value={stopDepartedAtDraft}
                          onChange={(event) => setStopDepartedAtDraft(event.target.value)}
                        />
                      </label>
                    </div>
                    {stopTimeError ? <small className="field-error">{stopTimeError}</small> : null}
                    <div className="editor-actions">
                      <button className="wide-button" onClick={saveActiveStop} disabled={busy || Boolean(stopTimeError)} type="button">
                        <Check size={16} /> Save
                      </button>
                      <button
                        className="wide-button subtle"
                        onClick={() => {
                          setEditingStop(false);
                          setStopTitleDraft(activeStop.title);
                          setStopNoteDraft(activeStop.note ?? "");
                          setStopArrivedAtDraft(toDateTimeInputValue(activeStop.arrived_at));
                          setStopDepartedAtDraft(toDateTimeInputValue(activeStop.departed_at));
                        }}
                        type="button"
                      >
                        <X size={16} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <small>{stopSubtitle(activeStop)}</small>
                    {branchParentTitle(activeStop) ? (
                      <small className="branch-label">
                        <GitBranch size={13} /> Side trip from {branchParentTitle(activeStop)}
                      </small>
                    ) : null}
                    {activeStop.note ? <p>{activeStop.note}</p> : null}
                    <div className="active-stop-actions">
                      <button
                        onClick={() => prepareDestinationFromStop(activeStop, "main", "search")}
                        disabled={busy}
                        type="button"
                      >
                        <Route size={14} /> Next stop
                      </button>
                      <button
                        onClick={() => prepareDestinationFromStop(activeStop, "branch", "nearby", "landmark")}
                        disabled={busy}
                        type="button"
                      >
                        <Compass size={14} /> Nearby ideas
                      </button>
                      <button
                        onClick={() => prepareDestinationFromStop(activeStop, "branch", "nearby")}
                        disabled={busy}
                        type="button"
                      >
                        <GitBranch size={14} /> Side trip
                      </button>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <section className="active-context muted-context">
                <p className="eyebrow">Active stop</p>
                <strong>Trip-level</strong>
                <small>Add or select a destination to attach notes and media to a stop.</small>
              </section>
            )}

            <section className="place-workflow" ref={destinationPanelRef}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Add destination</p>
                  <h3>{destinationMode === "nearby" ? "Nearby places" : destinationMode === "coordinates" ? "Exact pin" : "Find a place"}</h3>
                  <small className="anchor-label">Near {searchAnchorLabel}</small>
                </div>
                {searchingPlaces ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              </div>

              <div className="destination-mode-tabs">
                <button
                  className={destinationMode === "search" ? "destination-mode active" : "destination-mode"}
                  onClick={() => setDestinationMode("search")}
                  type="button"
                >
                  <Search size={15} /> Search
                </button>
                <button
                  className={destinationMode === "nearby" ? "destination-mode active" : "destination-mode"}
                  onClick={() => setDestinationMode("nearby")}
                  type="button"
                >
                  <Compass size={15} /> Nearby
                </button>
                <button
                  className={destinationMode === "coordinates" ? "destination-mode active" : "destination-mode"}
                  onClick={() => setDestinationMode("coordinates")}
                  type="button"
                >
                  <Crosshair size={15} /> Pin
                </button>
              </div>

              <div className="destination-target">
                <span>
                  {destinationScope === "branch" ? <GitBranch size={15} /> : <Route size={15} />}
                  <strong>Add target</strong>
                  <small>{destinationPlacementLabel()}</small>
                </span>
                <span>
                  <Compass size={15} />
                  <strong>Search area</strong>
                  <small>{destinationPlacementHint()} · Near {searchAnchorLabel}</small>
                </span>
              </div>

              {destinationMode !== "coordinates" ? (
                <>
                  <div className="search-origin-toggle">
                    <button
                      className={searchOrigin === "context" ? "search-origin-option active" : "search-origin-option"}
                      onClick={() => setSearchOrigin("context")}
                      type="button"
                    >
                      <Route size={15} />
                      <span>
                        <strong>{contextSearchOriginTitle}</strong>
                        <small>{contextSearchAnchorLabel}</small>
                      </span>
                    </button>
                    <button
                      className={searchOrigin === "draft" ? "search-origin-option active" : "search-origin-option"}
                      onClick={() => setSearchOrigin("draft")}
                      disabled={!placeDraft}
                      type="button"
                    >
                      <MapPin size={15} />
                      <span>
                        <strong>Draft place</strong>
                        <small>{draftSearchOriginLabel}</small>
                      </span>
                    </button>
                    <button
                      className={searchOrigin === "route" ? "search-origin-option active" : "search-origin-option"}
                      onClick={() => setSearchOrigin("route")}
                      disabled={!routeSearchAnchor}
                      type="button"
                    >
                      <ListFilter size={15} />
                      <span>
                        <strong>Route end</strong>
                        <small>{routeSearchOriginLabel}</small>
                      </span>
                    </button>
                    <button
                      className={searchOrigin === "map" ? "search-origin-option active" : "search-origin-option"}
                      onClick={() => setSearchOrigin("map")}
                      disabled={!mapFocus}
                      type="button"
                    >
                      <Crosshair size={15} />
                      <span>
                        <strong>Map center</strong>
                        <small>{mapSearchOriginLabel}</small>
                      </span>
                    </button>
                  </div>
                  <div className="search-input">
                    <Search size={17} />
                    <input
                      ref={placeSearchInputRef}
                      value={placeQuery}
                      onChange={(event) => {
                        setActivePresetId(null);
                        setActivePresetStep(0);
                        setDestinationMode("search");
                        setPlaceQuery(event.target.value);
                      }}
                      onKeyDown={handlePlaceSearchKeyDown}
                      onPaste={handlePlaceSearchPaste}
                      placeholder="Address, hotel, landmark, map link"
                    />
                    {placeQuery ? (
                      <button
                        onClick={() => {
                          setPlaceQuery("");
                          setPlaceResults([]);
                          setPlaceResultFilter("all");
                          setActivePresetId(null);
                          setActivePresetStep(0);
                          setPlanningPresetId(null);
                        }}
                        type="button"
                        title="Clear search"
                      >
                        <X size={15} />
                      </button>
                    ) : null}
                  </div>
                  <div className="search-suggestions">
                    <small>Fast search</small>
                    <div className="search-suggestion-list">
                      {destinationSearchSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.label}
                          className={placeQuery === suggestion.query ? "active" : ""}
                          onClick={() => applyDestinationSearchSuggestion(suggestion)}
                          type="button"
                        >
                          <span>{suggestion.label}</span>
                          <small>{suggestion.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="destination-presets">
                    {destinationPresets.map((preset) => (
                      <button
                        key={preset.id}
                        className={activePresetId === preset.id ? "destination-preset active" : "destination-preset"}
                        onClick={() => startDestinationPreset(preset)}
                        type="button"
                      >
                        <strong>{preset.title}</strong>
                        <small>{preset.hint}</small>
                      </button>
                    ))}
                  </div>
                  {activePreset ? (
                    <div className="destination-plan">
                      <div>
                        <small>Plan steps</small>
                        <div className="destination-plan-steps">
                          {activePreset.steps.map((step, index) => (
                            <button
                              key={`${activePreset.id}-${step.query}`}
                              className={activePresetStep === index ? "active" : ""}
                              onClick={() => goToPresetStep(index)}
                              type="button"
                            >
                              <span>{index + 1}</span>
                              {step.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="destination-plan-actions">
                        <button
                          onClick={() => buildPresetQueue()}
                          disabled={busy || planningActivePreset}
                          type="button"
                        >
                          {planningActivePreset ? <Loader2 className="spin" size={13} /> : <Route size={13} />}
                          {planningActivePreset ? "Building" : "Build plan"}
                        </button>
                        <button
                          onClick={queueTopAndAdvancePreset}
                          disabled={busy || planningActivePreset || !topVisiblePlace || !canQueueTopForPreset}
                          type="button"
                        >
                          <ListFilter size={13} />
                          {canAdvancePreset ? "Queue top + next" : "Queue top"}
                        </button>
                        <button
                          onClick={() => goToPresetStep(activePresetStep + 1)}
                          disabled={busy || planningActivePreset || !canAdvancePreset}
                          type="button"
                        >
                          <ChevronDown size={13} /> Next
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {destinationMode === "nearby" ? (
                    <div className="nearby-groups">
                      {placeChipGroups.map((group) => (
                        <section className="nearby-section" key={group.title}>
                          <small>{group.title}</small>
                          <div className="nearby-grid">
                            {group.chips.map((chip) => (
                              <button
                                key={chip.label}
                                className={placeQuery === chip.query || activePresetQuery === chip.query ? "nearby-card active" : "nearby-card"}
                                onClick={() => searchNearbyCategory(chip.query)}
                                type="button"
                              >
                                <span>{chip.label}</span>
                                <small>{chip.hint}</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="quick-search-panel">
                      <small>
                        {currentTrip?.type === "road_trip"
                          ? routeQueue.length
                            ? "Good next stops"
                            : "Road trip starters"
                          : mainStops.length
                            ? "Ideas near this trip"
                            : "Start with"}
                      </small>
                      <div className="quick-chips">
                        {contextualSearchChips.map((chip) => (
                          <button
                            key={chip.label}
                            onClick={() => searchNearbyCategory(chip.query)}
                            type="button"
                          >
                            <span>{chip.label}</span>
                            <small>{chip.hint}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="destination-list-import">
                    <div className="destination-list-heading">
                      <span><Route size={14} /> Paste list</span>
                      <small>
                        {destinationListQueries.length
                          ? `${destinationListQueries.length} ready`
                          : destinationPlacementLabel()}
                      </small>
                    </div>
                    <textarea
                      value={destinationListText}
                      onChange={(event) => {
                        setDestinationListText(event.target.value);
                        setDestinationListStatus("");
                      }}
                      placeholder={`Grand Hotel -> Old Town Square\nDay 2: Prague to Vienna\nhttps://maps.app.goo.gl/...`}
                      rows={3}
                    />
                    {destinationListQueries.length ? (
                      <div className="destination-list-preview" aria-label="Parsed destinations">
                        {destinationListItems.slice(0, 6).map((item, index) => (
                          <span key={`${item.query}-${index}`}>
                            <small>{index + 1}</small>
                            <strong>{item.query}</strong>
                            {item.note ? <em>{item.note}</em> : null}
                          </span>
                        ))}
                        {destinationListQueries.length > 6 ? (
                          <span>
                            <small>+</small>
                            {destinationListQueries.length - 6} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="destination-list-actions">
                      <button
                        onClick={queueDestinationList}
                        disabled={busy || importingDestinationList || !destinationListQueries.length}
                        type="button"
                      >
                        {importingDestinationList ? <Loader2 className="spin" size={14} /> : <ListFilter size={14} />}
                        {importingDestinationList
                          ? "Finding"
                          : destinationListQueries.length
                            ? `Find + queue ${destinationListQueries.length}`
                            : "Find + queue"}
                      </button>
                      <button
                        onClick={() => {
                          setDestinationListText("");
                          setDestinationListStatus("");
                        }}
                        disabled={busy || importingDestinationList || !destinationListText.trim()}
                        type="button"
                      >
                        <X size={14} /> Clear
                      </button>
                    </div>
                    {destinationListStatus ? <small className="destination-list-status">{destinationListStatus}</small> : null}
                  </div>
                </>
              ) : (
                <div className="coordinate-entry">
                  <button
                    className="wide-button subtle map-center-button"
                    onClick={useMapCenterPin}
                    disabled={!mapFocus || busy}
                    type="button"
                  >
                    <Crosshair size={16} /> Use map center as pin
                  </button>
                  <input
                    value={manualLabel}
                    onChange={(event) => setManualLabel(event.target.value)}
                    placeholder="Place name"
                  />
                  <div className="coordinate-row">
                    <input
                      value={manualLat}
                      onChange={(event) => setManualLat(event.target.value)}
                      inputMode="decimal"
                      placeholder="Latitude"
                    />
                    <input
                      value={manualLng}
                      onChange={(event) => setManualLng(event.target.value)}
                      inputMode="decimal"
                      placeholder="Longitude"
                    />
                  </div>
                  <button className="wide-button subtle" onClick={useManualCoordinates} type="button">
                    <Crosshair size={16} /> Use coordinates
                  </button>
                </div>
              )}

              {destinationMode !== "coordinates" && recentDestinationPlaces.length ? (
                <div className="recent-destinations">
                  <div className="recent-destinations-heading">
                    <span>Recent & saved</span>
                    {recentPlaces.length ? (
                      <button onClick={() => setRecentPlaces([])} type="button">
                        <X size={13} /> Clear recents
                      </button>
                    ) : null}
                  </div>
                  <div className="recent-destination-list">
                    {recentDestinationPlaces.map((place) => {
                      const savedStop = savedStopForPlace(place);
                      const areaLabel = placeAreaLabel(place);
                      const distanceLabel = placeDistanceLabel(place);
                      return (
                        <article
                          className={savedStop ? "recent-destination saved" : "recent-destination"}
                          key={place.id}
                        >
                          <button
                            className="recent-destination-main"
                            onClick={() => (savedStop ? selectStopId(savedStop.id) : selectPlace(place))}
                            type="button"
                          >
                            <MapPin size={15} />
                            <span>
                              <strong>{savedStop?.title ?? place.name}</strong>
                              <small>
                                {[savedStop ? "Saved stop" : placeKindLabel(place), distanceLabel, areaLabel]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </span>
                          </button>
                          <div className="recent-destination-actions">
                            <button
                              onClick={() =>
                                savedStop ? selectStopId(savedStop.id) : addPlaceToRoute(place, place.name, "")
                              }
                              disabled={busy}
                              type="button"
                            >
                              {savedStop ? <Check size={13} /> : <Plus size={13} />}
                              {destinationAddLabel(savedStop)}
                            </button>
                            <button
                              onClick={() => exploreAroundPlace(place, savedStop)}
                              disabled={busy}
                              type="button"
                            >
                              <Compass size={13} /> Explore
                            </button>
                            <button
                              onClick={() => queuePlace(place)}
                              disabled={busy || queuedPlaceIds.has(place.id) || Boolean(savedStop)}
                              type="button"
                            >
                              {queuedPlaceIds.has(place.id) || savedStop ? <Check size={13} /> : <ListFilter size={13} />}
                              {destinationQueueLabel(place, savedStop)}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {rankedPlaceResults.length > 0 && destinationMode !== "coordinates" ? (
                <div className="place-results">
                  <div className="place-results-summary">
                    <div>
                      <strong>
                        {visiblePlaceResults.length} of {rankedPlaceResults.length} result{rankedPlaceResults.length === 1 ? "" : "s"}
                      </strong>
                      <small>
                        Nearest first near {searchAnchorLabel}
                        {mapSearchPreviewPlaces.length ? ` · ${mapSearchPreviewPlaces.length} on map` : ""}
                      </small>
                    </div>
                    {topVisiblePlace ? (
                      <div className="place-summary-actions">
                        <button
                          onClick={() =>
                            topVisibleSavedStop
                              ? selectStopId(topVisibleSavedStop.id)
                              : addPlaceToRoute(topVisiblePlace, topVisiblePlace.name, "")
                          }
                          disabled={busy}
                          type="button"
                        >
                          {topVisibleSavedStop ? <Check size={13} /> : <Plus size={13} />}
                          {destinationAddLabel(topVisibleSavedStop)}
                        </button>
                        <button
                          onClick={() => queuePlace(topVisiblePlace)}
                          disabled={busy || queuedPlaceIds.has(topVisiblePlace.id) || Boolean(topVisibleSavedStop)}
                          type="button"
                        >
                          {queuedPlaceIds.has(topVisiblePlace.id) || topVisibleSavedStop ? <Check size={13} /> : <ListFilter size={13} />}
                          {destinationQueueLabel(topVisiblePlace, topVisibleSavedStop)}
                        </button>
                        <button
                          onClick={queueTopVisiblePlaces}
                          disabled={busy || !topQueueablePlaces.length}
                          type="button"
                        >
                          <ListFilter size={13} /> {topQueueablePlaces.length ? `Queue ${topQueueablePlaces.length}` : "Queued"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {topVisiblePlace && topVisibleRecommendation ? (
                    <div className="place-recommendation">
                      <MapPin size={15} />
                      <span>
                        <strong>{topVisibleRecommendation.title}</strong>
                        <small>{topVisiblePlace.name} · {topVisibleRecommendation.hint}</small>
                      </span>
                    </div>
                  ) : null}
                  {placeResultFilters.length > 1 ? (
                    <div className="place-result-filters">
                      <button
                        className={placeResultFilter === "all" ? "active" : ""}
                        onClick={() => setPlaceResultFilter("all")}
                        type="button"
                      >
                        All <span>{rankedPlaceResults.length}</span>
                      </button>
                      {placeResultFilters.map((filter) => (
                        <button
                          key={filter.label}
                          className={placeResultFilter === filter.label ? "active" : ""}
                          onClick={() => setPlaceResultFilter(filter.label)}
                          type="button"
                        >
                          {filter.label} <span>{filter.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {visiblePlaceResults.map((place) => {
                    const areaLabel = placeAreaLabel(place);
                    const distanceLabel = placeDistanceLabel(place);
                    const sourceLabel = placeSourceLabel(place);
                    const savedStop = savedStopForPlace(place);
                    const actionLabel = destinationResultActionLabel(place, savedStop);
                    const actionHint = destinationResultActionHint(place, savedStop);
                    return (
                      <article
                        key={place.id}
                        className={[
                          "place-result",
                          placeDraft?.id === place.id ? "active" : "",
                          savedStop ? "saved" : ""
                        ].filter(Boolean).join(" ")}
                      >
                        <button
                          className="place-result-main"
                          onClick={() => (savedStop ? selectStopId(savedStop.id) : selectPlace(place))}
                          type="button"
                        >
                          <MapPin size={16} />
                          <span>
                            <strong>{place.name}</strong>
                            <span className="place-meta-row">
                              <span>{placeKindLabel(place)}</span>
                              {savedStop ? <span>Saved as {savedStop.title}</span> : null}
                              {sourceLabel ? <span>{sourceLabel}</span> : null}
                              {distanceLabel ? <span>{distanceLabel}</span> : null}
                              {areaLabel ? <span>{areaLabel}</span> : null}
                              <span className="action-meta">{actionLabel} · {actionHint}</span>
                            </span>
                            <small>{placeAddressLabel(place)}</small>
                          </span>
                        </button>
                        <button
                          className="place-result-add"
                          onClick={() => (savedStop ? selectStopId(savedStop.id) : addPlaceToRoute(place, place.name, ""))}
                          disabled={busy}
                          type="button"
                        >
                          {savedStop ? <Check size={14} /> : <Plus size={14} />}
                          {destinationAddLabel(savedStop)}
                        </button>
                        <button
                          className="place-result-nearby"
                          onClick={() => exploreAroundPlace(place, savedStop)}
                          disabled={busy}
                          type="button"
                        >
                          <Compass size={14} /> Explore
                        </button>
                        <button
                          className={queuedPlaceIds.has(place.id) || savedStop ? "place-result-queue active" : "place-result-queue"}
                          onClick={() => queuePlace(place)}
                          disabled={busy || queuedPlaceIds.has(place.id) || Boolean(savedStop)}
                          type="button"
                        >
                          {queuedPlaceIds.has(place.id) || savedStop ? <Check size={14} /> : <ListFilter size={14} />}
                          {destinationQueueLabel(place, savedStop)}
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : destinationMode !== "coordinates" && placeQuery.trim().length >= 3 && !searchingPlaces ? (
                <div className="search-empty-state">
                  <div>
                    <strong>No places found</strong>
                    <small>Try a nearby category, search around the map center, or drop an exact pin.</small>
                  </div>
                  <div className="search-empty-suggestions">
                    <span>Try instead</span>
                    <div className="quick-chips compact-chips">
                      {contextualSearchChips.slice(0, 4).map((chip) => (
                        <button key={chip.label} onClick={() => searchNearbyCategory(chip.query)} type="button">
                          <span>{chip.label}</span>
                          <small>{chip.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="search-empty-actions">
                    <button onClick={searchFromMapCenter} disabled={!mapFocus} type="button">
                      <Crosshair size={14} />
                      <span>Map center</span>
                    </button>
                    <button onClick={() => openDestinationMode("coordinates")} type="button">
                      <MapPin size={14} />
                      <span>Exact pin</span>
                    </button>
                    <button onClick={() => setPlaceQuery("")} type="button">
                      <X size={14} />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {routeQueue.length ? (
                <div className="route-queue">
                  <div className="panel-heading compact-heading">
                    <div>
                      <p className="eyebrow">Route queue</p>
                      <h3>{routeQueue.length} destination{routeQueue.length === 1 ? "" : "s"} ready</h3>
                      <small className="anchor-label">{destinationPlacementLabel()}</small>
                    </div>
                    <ListFilter size={17} />
                  </div>
                  <div className="route-queue-summary">
                    <span><Route size={14} /> {queuedRouteKm ? formatDistance(queuedRouteKm) : "Distance starts at first queued stop"}</span>
                    <span><MapPin size={14} /> {destinationPlacementLabel()}</span>
                    <span><ListFilter size={14} /> {routeQueue.length} queued</span>
                  </div>
                  <div className="route-queue-next">
                    <span>
                      <strong>Keep planning from {routeSearchAnchor?.name ?? "the route end"}</strong>
                      <small>Searches will use the last queued destination as the next anchor.</small>
                    </span>
                    <button
                      onClick={() => {
                        setSearchOrigin("route");
                        setDestinationMode("search");
                        setPlaceDraft(null);
                        setPlaceQuery("");
                      }}
                      type="button"
                    >
                      <Search size={14} /> Search there
                    </button>
                    <button onClick={() => lastQueuedItem && exploreQueuedPlace(lastQueuedItem)} type="button">
                      <Compass size={14} /> Explore
                    </button>
                  </div>
                  <div className="route-queue-list">
                    {routeQueue.map((item, index) => (
                      <article key={item.place.id}>
                        <span>{index + 1}</span>
                        <div className="queue-stop-fields">
                          <strong>{item.place.name}</strong>
                          <small>{queuedLegLabel(item, index)}</small>
                          <input
                            value={item.title}
                            onChange={(event) => updateQueuedPlace(item.place.id, { title: event.target.value })}
                            placeholder="Stop title"
                          />
                          <textarea
                            value={item.note}
                            onChange={(event) => updateQueuedPlace(item.place.id, { note: event.target.value })}
                            placeholder="Short note"
                            rows={2}
                          />
                          <div className="time-row">
                            <label>
                              <span>Arrive</span>
                              <input
                                type="datetime-local"
                                value={item.arrivedAt}
                                onChange={(event) => updateQueuedPlace(item.place.id, { arrivedAt: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>Leave</span>
                              <input
                                type="datetime-local"
                                value={item.departedAt}
                                onChange={(event) => updateQueuedPlace(item.place.id, { departedAt: event.target.value })}
                              />
                            </label>
                          </div>
                          {queuedTimeErrors.get(item.place.id) ? (
                            <small className="field-error">{queuedTimeErrors.get(item.place.id)}</small>
                          ) : null}
                        </div>
                        <div className="queue-row-actions">
                          <button
                            onClick={() => exploreQueuedPlace(item)}
                            type="button"
                            title="Explore nearby"
                          >
                            <Compass size={14} />
                          </button>
                          <button
                            onClick={() => moveQueuedPlace(item.place.id, -1)}
                            disabled={index === 0}
                            type="button"
                            title="Move up"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => moveQueuedPlace(item.place.id, 1)}
                            disabled={index === routeQueue.length - 1}
                            type="button"
                            title="Move down"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button onClick={() => removeQueuedPlace(item.place.id)} type="button" title="Remove from queue">
                            <X size={14} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="route-queue-actions">
                    <button className="wide-button" onClick={addQueuedPlaces} disabled={busy || Boolean(queuedTimeErrors.size)}>
                      <Plus size={16} /> {queuedAddLabel()}
                    </button>
                    <button
                      className="wide-button subtle"
                      onClick={optimizeQueuedPlaces}
                      disabled={busy || routeQueue.length < 3}
                      type="button"
                    >
                      <Route size={16} /> Optimize order
                    </button>
                    <button className="wide-button subtle" onClick={() => setRouteQueue([])} disabled={busy} type="button">
                      <X size={16} /> Clear queue
                    </button>
                  </div>
                  <small className="route-queue-hint">{queuedCommitHint()}</small>
                </div>
              ) : null}

              {placeDraft ? (
                <div className="draft-stop" ref={destinationDraftRef}>
                  <div className="draft-map-row">
                    <Crosshair size={17} />
                    <span>
                      {placeDraft.label}
                      {placeDistanceLabel(placeDraft) ? <small>{placeDistanceLabel(placeDraft)} from {searchAnchorLabel}</small> : null}
                    </span>
                  </div>
                  <div className="draft-nearby-actions">
                    {draftExploreChips.map((chip, index) => (
                      <button key={chip.query} onClick={() => searchAroundDraft(chip.query)} type="button">
                        {index === 0 ? <Compass size={14} /> : index === 1 ? <MapPin size={14} /> : <Search size={14} />}
                        <span>{chip.label}</span>
                      </button>
                    ))}
                  </div>
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder="Stop title"
                  />
                  <textarea
                    value={draftNote}
                    onChange={(event) => setDraftNote(event.target.value)}
                    placeholder="Short note"
                    rows={3}
                  />
                  <div className="time-row">
                    <label>
                      <span>Arrive</span>
                      <input
                        type="datetime-local"
                        value={draftArrivedAt}
                        onChange={(event) => setDraftArrivedAt(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Leave</span>
                      <input
                        type="datetime-local"
                        value={draftDepartedAt}
                        onChange={(event) => setDraftDepartedAt(event.target.value)}
                      />
                    </label>
                  </div>
                  {draftTimeError ? <small className="field-error">{draftTimeError}</small> : null}
                  <div className="scope-toggle">
                    <button
                      className={destinationScope === "main" ? "scope-option active" : "scope-option"}
                      onClick={() => setDestinationScope("main")}
                      type="button"
                    >
                      <Route size={15} /> Main stop
                    </button>
                    <button
                      className={destinationScope === "branch" ? "scope-option active" : "scope-option"}
                      onClick={() => {
                        setDestinationBranchParentId(destinationBranchParent?.id ?? mainStops[0]?.id ?? "");
                        setDestinationScope("branch");
                      }}
                      disabled={!mainStops.length}
                      type="button"
                    >
                      <GitBranch size={15} /> Side trip
                    </button>
                  </div>
                  {destinationScope === "branch" && mainStops.length ? (
                    <label className="branch-parent-select">
                      <span>Side trip from</span>
                      <select
                        value={destinationBranchParent?.id ?? ""}
                        onChange={(event) => setDestinationBranchParentId(event.target.value)}
                      >
                        {mainStops.map((stop) => (
                          <option key={stop.id} value={stop.id}>
                            {stop.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <small className="draft-hint">{destinationPlacementLabel()}</small>
                  <div className="draft-actions">
                    <button className="wide-button" onClick={addStopFromDraft} disabled={busy || Boolean(draftTimeError)}>
                      <Check size={16} /> {destinationScope === "branch" ? "Add side trip" : "Add stop"}
                    </button>
                    <button className="wide-button subtle" onClick={queueDraftPlace} disabled={busy || Boolean(draftTimeError)} type="button">
                      <ListFilter size={16} /> Queue
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => {
                        resetDestinationDraft();
                      }}
                      title="Clear draft"
                      type="button"
                    >
                      <X size={17} />
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="memory-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Memories</p>
                  <h3>{memoryTitle}</h3>
                </div>
                <Image size={18} />
              </div>
              <div className="memory-tabs">
                <button
                  className={activeMemoryScope === "active" ? "memory-tab active" : "memory-tab"}
                  onClick={() => setMemoryScope("active")}
                  disabled={!activeStop}
                  type="button"
                >
                  <MapPin size={15} /> Selected stop
                </button>
                <button
                  className={activeMemoryScope === "all" ? "memory-tab active" : "memory-tab"}
                  onClick={() => setMemoryScope("all")}
                  type="button"
                >
                  <Image size={15} /> Whole trip
                </button>
              </div>
              <label className="upload-box">
                <Upload />
                <span>
                  {activeMemoryScope === "active" && activeStop
                    ? `Upload to ${activeStop.title}`
                    : "Upload to trip"}
                </span>
                <input type="file" accept="image/*,video/*" multiple onChange={(event) => upload(event.target.files)} />
              </label>
              {activeMemoryScope === "all" && locatedMediaGroups.length ? (
                <div className="located-media-panel">
                  <div className="panel-heading compact-heading">
                    <div>
                      <p className="eyebrow">Found in metadata</p>
                      <h3>Make destinations from media</h3>
                      <small className="anchor-label">
                        {locatedUnassignedMedia.length} located file{locatedUnassignedMedia.length === 1 ? "" : "s"} grouped into{" "}
                        {locatedMediaGroups.length} destination{locatedMediaGroups.length === 1 ? "" : "s"}.
                      </small>
                    </div>
                    <MapPin size={17} />
                  </div>
                  <button
                    className="wide-button subtle"
                    onClick={createAllStopsFromMedia}
                    disabled={busy || !locatedMediaGroups.length}
                    type="button"
                  >
                    <Plus size={15} /> Create all {locatedMediaGroups.length}
                  </button>
                  <div className="located-media-list">
                    {locatedMediaGroups.map((group) => {
                      const lead = group.items[0]!;
                      return (
                        <article key={group.id}>
                          {lead.kind === "video" ? (
                            <video src={mediaThumbUrl(lead) ?? mediaUrl(lead)} />
                          ) : (
                            <img src={mediaThumbUrl(lead)} alt={lead.file_name} />
                          )}
                          <div>
                            <strong>{mediaDestinationTitle(group)}</strong>
                            <small>{mediaGroupLocationLabel(group)}</small>
                            <small>
                              {group.items.length} file{group.items.length === 1 ? "" : "s"}
                              {group.items.length > 1 ? ` near ${lead.file_name}` : ` · ${lead.file_name}`}
                            </small>
                          </div>
                          <button onClick={() => createStopFromMediaGroup(group)} disabled={busy} type="button">
                            <Plus size={14} /> Create stop
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : activeMemoryScope === "all" && locatedUnassignedMedia.length ? (
                <div className="located-media-panel">
                  <div className="panel-heading compact-heading">
                    <div>
                      <p className="eyebrow">Found in metadata</p>
                      <h3>Reading locations</h3>
                    </div>
                    <Loader2 className="spin" size={17} />
                  </div>
                </div>
              ) : null}
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder={activeMemoryScope === "active" ? "Add a note for this stop" : "Add a trip note"}
                rows={3}
              />
              <button className="wide-button subtle" onClick={addNote} disabled={busy || !noteDraft.trim()}>
                <Plus size={16} /> Add note
              </button>
              {visibleNotes.length ? (
                <div className="note-list">
                  {visibleNotes.map((note) => (
                      <article key={note.id}>
                        <p>{note.body}</p>
                        <small>
                          {note.stop_id && activeMemoryScope === "all" ? `${stopById.get(note.stop_id)?.title ?? "Stop"} · ` : ""}
                          {new Date(note.created_at).toLocaleDateString()}
                        </small>
                      </article>
                    ))}
                </div>
              ) : (
                <p className="muted">No notes yet for this view.</p>
              )}
              {visibleMedia.length ? (
                <div className="media-grid">
                  {visibleMedia.map((item) => (
                    <figure key={item.id}>
                      {item.kind === "video" ? (
                        <video src={mediaUrl(item)} controls />
                      ) : (
                        <img src={mediaThumbUrl(item)} alt={item.file_name} />
                      )}
                      <figcaption>
                        {item.stop_id && activeMemoryScope === "all"
                          ? stopById.get(item.stop_id)?.title ?? item.processing_status
                          : item.processing_status}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="muted">No photos or videos yet for this view.</p>
              )}
            </section>

            <button className="wide-button" onClick={() => setPresentation(true)}>
              <Camera size={16} /> Open presentation
            </button>
            <button
              className="wide-button subtle"
              onClick={copyShareLink}
              disabled={busy}
            >
              {shareStatus === "copied" ? <Check size={16} /> : <Share2 size={16} />}
              {shareStatus === "copied" ? "Copied share link" : "Copy share link"}
            </button>

            <section className="collab-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Collaborate</p>
                  <h3>Trip access</h3>
                </div>
                <Users size={18} />
              </div>
              <form className="collab-form" onSubmit={addCollaborator}>
                <input
                  value={collaboratorEmail}
                  onChange={(event) => setCollaboratorEmail(event.target.value)}
                  type="email"
                  placeholder="Email of an existing TripMap user"
                />
                <select
                  value={collaboratorRole}
                  onChange={(event) => setCollaboratorRole(event.target.value as Collaborator["role"])}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button className="wide-button subtle" disabled={busy || !collaboratorEmail.trim()}>
                  <UserPlus size={16} /> Add collaborator
                </button>
              </form>
              {collaborators.length ? (
                <div className="collab-list">
                  {collaborators.map((collaborator) => (
                    <article key={collaborator.user_id}>
                      <span>
                        <strong>{collaborator.name}</strong>
                        <small>{collaborator.email} · {collaborator.role}</small>
                      </span>
                      <button
                        className="icon-button mini-button danger-button"
                        onClick={() => removeCollaborator(collaborator.user_id)}
                        title="Remove collaborator"
                        type="button"
                        disabled={busy}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No collaborators yet. Share a link for viewing, or add an existing user here.</p>
              )}
            </section>

            <div className="timeline">
              {mainStops.length ? (
                mainStops.map((stop, index) => {
                  const children = sideTripsByParent.get(stop.id) ?? [];
                  const previous = mainStops[index - 1];
                  return (
                    <section className="route-stop-group" key={stop.id}>
                      <div className="route-step-label">
                        <span>{index + 1}</span>
                        <small>{previous ? formatDistance(distanceKm(previous, stop)) : "Start"}</small>
                      </div>
                      {renderStopCard(stop)}
                      {children.length ? (
                        <div className="branch-stop-list">
                          {children.map((child) => renderStopCard(child, "branch"))}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              ) : (
                <section className="route-empty-state">
                  <MapPin size={20} />
                  <div>
                    <strong>Start the route with a destination</strong>
                    <small>Search an address or place, browse nearby ideas, or drop an exact pin on the satellite map.</small>
                  </div>
                  <div className="route-empty-actions">
                    <button onClick={() => openDestinationMode("search")} type="button">
                      <Search size={14} /> Search
                    </button>
                    <button onClick={() => openDestinationMode("nearby")} type="button">
                      <Compass size={14} /> Nearby
                    </button>
                    <button onClick={() => openDestinationMode("coordinates")} type="button">
                      <Crosshair size={14} /> Pin
                    </button>
                  </div>
                  <div className="route-empty-plans">
                    <span>Starter plans</span>
                    <div>
                      {routeStarterPresets.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => buildPresetQueue(preset)}
                          disabled={busy || planningPresetId === preset.id}
                          type="button"
                        >
                          {planningPresetId === preset.id ? <Loader2 className="spin" size={13} /> : <Route size={13} />}
                          <strong>{preset.title}</strong>
                          <small>{preset.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}
              {orphanBranchStops.length ? (
                <section className="route-stop-group">
                  <div className="route-step-label">
                    <GitBranch size={15} />
                    <small>Side trips</small>
                  </div>
                  <div className="branch-stop-list">
                    {orphanBranchStops.map((stop) => renderStopCard(stop, "branch"))}
                  </div>
                </section>
              ) : null}
            </div>

          </>
        ) : (
          <div className="empty-panel">
            <MapPin />
            <p>Create a trip, then click the satellite map to add stops.</p>
          </div>
        )}
      </aside>

      {presentation && detail ? (
        <div className="presentation" onClick={() => setPresentation(false)}>
          <div className="presentation-inner" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button close" onClick={() => setPresentation(false)}>×</button>
            <h2>{detail.trip.title}</h2>
            {presentationGroups.length ? (
              <div className="presentation-story">
                {presentationGroups.map((group) => (
                  <section className="presentation-stop" key={group.id}>
                    <div>
                      <p className="eyebrow">{group.subtitle}</p>
                      <h3>{group.title}</h3>
                    </div>
                    {group.notes.length ? (
                      <div className="presentation-notes">
                        {group.notes.map((note) => (
                          <p key={note.id}>{note.body}</p>
                        ))}
                      </div>
                    ) : null}
                    {group.media.length ? (
                      <div className="presentation-media">
                        {group.media.map((item) =>
                          item.kind === "video" ? (
                            <video key={item.id} src={mediaUrl(item)} controls />
                          ) : (
                            <img key={item.id} src={mediaUrl(item)} alt={item.file_name} />
                          )
                        )}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : (
              <p>Add notes, photos, or videos to turn this trip into a presentation.</p>
            )}
          </div>
        </div>
      ) : null}

      {error ? <div className="toast">{error}</div> : null}
    </main>
  );
}
