export type User = {
  id: string;
  email: string;
  name: string;
};

export type Stop = {
  id: string;
  trip_id: string;
  title: string;
  note: string;
  lat: number;
  lng: number;
  sort_order: number;
  category?: string | null;
  arrived_at?: string | null;
  departed_at?: string | null;
  branch_of?: string | null;
};

export type MediaItem = {
  id: string;
  trip_id: string;
  stop_id?: string | null;
  kind: "image" | "video";
  file_name: string;
  processing_status: "queued" | "processing" | "ready" | "failed";
  optimizedUrl?: string | null;
  thumbnailUrl?: string | null;
  originalUrl?: string | null;
  captured_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type PlaceSearchResult = {
  id: string;
  name: string;
  label: string;
  category: string;
  type: string;
  lat: number;
  lng: number;
  importance?: number;
  address?: Record<string, string>;
  source: "nominatim" | "map" | "mapy" | "overpass" | "photon";
};

export type TripType = "one_destination" | "road_trip";

export type Trip = {
  id: string;
  title: string;
  description: string;
  type: TripType;
  starts_at?: string | null;
  ends_at?: string | null;
  cover_media_id?: string | null;
  stops: Stop[];
};

export type TripDetail = {
  trip: Trip;
  stops: Stop[];
  media: MediaItem[];
};
