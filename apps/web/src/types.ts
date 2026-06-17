export type User = {
  id: string;
  email: string;
  name: string;
};

export type Folder = {
  id: string;
  title: string;
  color: string;
};

export type Stop = {
  id: string;
  trip_id: string;
  title: string;
  note: string;
  lat: number;
  lng: number;
  sort_order: number;
  arrived_at?: string | null;
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

export type Note = {
  id: string;
  body: string;
  stop_id?: string | null;
  created_at: string;
};

export type Trip = {
  id: string;
  title: string;
  description: string;
  type: "one_destination" | "road_trip";
  folder_id?: string | null;
  folder_title?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  stops: Stop[];
};

export type TripDetail = {
  trip: Trip;
  stops: Stop[];
  notes: Note[];
  media: MediaItem[];
};
