import {
  Building2,
  Camera,
  Castle,
  Coffee,
  Hotel,
  Landmark,
  type LucideIcon,
  MapPin,
  Mountain,
  Palmtree,
  Plane,
  ShoppingBag,
  Tent,
  Trees,
  Utensils,
  Waves,
  Wine,
  Droplets
} from "lucide-react";
import type { PlaceSearchResult } from "./types";

export type PinCategory =
  | "place"
  | "city"
  | "hotel"
  | "beach"
  | "mountain"
  | "nature"
  | "water"
  | "waterfall"
  | "viewpoint"
  | "landmark"
  | "museum"
  | "food"
  | "cafe"
  | "nightlife"
  | "shopping"
  | "camp"
  | "transport";

export type CategoryMeta = {
  id: PinCategory;
  label: string;
  color: string;
  Icon: LucideIcon;
};

// Order here is the order shown in the picker.
export const CATEGORIES: CategoryMeta[] = [
  { id: "place", label: "Place", color: "#c4582b", Icon: MapPin },
  { id: "city", label: "City", color: "#b5742e", Icon: Building2 },
  { id: "hotel", label: "Stay", color: "#7b66c0", Icon: Hotel },
  { id: "beach", label: "Beach", color: "#1f9bbf", Icon: Palmtree },
  { id: "mountain", label: "Mountain", color: "#5e7e54", Icon: Mountain },
  { id: "nature", label: "Nature", color: "#4f8c45", Icon: Trees },
  { id: "water", label: "Water", color: "#2f86b3", Icon: Waves },
  { id: "waterfall", label: "Waterfall", color: "#3a9ec4", Icon: Droplets },
  { id: "viewpoint", label: "Viewpoint", color: "#c06a2e", Icon: Camera },
  { id: "landmark", label: "Landmark", color: "#b58a2c", Icon: Castle },
  { id: "museum", label: "Museum", color: "#9c7b3f", Icon: Landmark },
  { id: "food", label: "Food", color: "#c4452b", Icon: Utensils },
  { id: "cafe", label: "Café", color: "#936037", Icon: Coffee },
  { id: "nightlife", label: "Nightlife", color: "#8a4f9e", Icon: Wine },
  { id: "shopping", label: "Shopping", color: "#bd5a86", Icon: ShoppingBag },
  { id: "camp", label: "Camp", color: "#5f7d54", Icon: Tent },
  { id: "transport", label: "Transport", color: "#4f7596", Icon: Plane }
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function categoryMeta(id?: string | null): CategoryMeta {
  return (id && BY_ID.get(id as PinCategory)) || BY_ID.get("place")!;
}

const MATCHERS: [RegExp, PinCategory][] = [
  [/hotel|hostel|motel|guest_?house|apartment|resort|chalet|cabin|accommodation|lodging|caravan/, "hotel"],
  [/beach|seaside|lido/, "beach"],
  [/waterfall/, "waterfall"],
  [/lake|reservoir|\bbay\b|river|pond|marina|spring|harbour|harbor|water_park|swimming/, "water"],
  [/peak|mountain|volcano|saddle|cliff|ridge|glacier|fell|summit/, "mountain"],
  [/camp|tent|wilderness_hut|alpine_hut|caravan_site/, "camp"],
  [/forest|\bwood|tree|park|nature_reserve|garden|meadow|valley|moor/, "nature"],
  [/viewpoint|view_point|lookout|scenic|panorama/, "viewpoint"],
  [/museum|gallery|theatre|theater|\barts?\b|exhibition/, "museum"],
  [/castle|fort|palace|ruins|archaeolog|monument|memorial|historic|tower|heritage|attraction|landmark|chapel|church|cathedral|temple|mosque|shrine|worship/, "landmark"],
  [/restaurant|fast_food|\bfood\b|bbq|pizza|diner|bistro|steak/, "food"],
  [/cafe|coffee|bakery|pastry|ice_?cream|tea|patisserie/, "cafe"],
  [/\bbar\b|pub|nightclub|wine|winery|brewery|beer|biergarten|cocktail|club/, "nightlife"],
  [/mall|shop|supermarket|market|store|boutique|department|grocery/, "shopping"],
  [/airport|aerodrome|terminal|\bstation\b|railway|subway|metro|\bbus\b|ferry|tram|transport|fuel|charging|parking|aeroway/, "transport"],
  [/\bcity\b|\btown\b|village|hamlet|suburb|municipality|locality|borough|district|quarter|neighbourhood/, "city"]
];

// Best-effort guess of a sensible icon for a freshly added place.
export function inferCategory(place: Pick<PlaceSearchResult, "category" | "type">): PinCategory {
  const haystack = `${place.category ?? ""} ${place.type ?? ""}`.toLowerCase();
  for (const [pattern, category] of MATCHERS) {
    if (pattern.test(haystack)) return category;
  }
  return "place";
}
