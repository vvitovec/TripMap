import { Compass, MapPin, Plus } from "lucide-react";
import { formatTripDates, pluralize } from "./format";
import type { Trip } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";

function coverUrl(mediaId?: string | null) {
  return mediaId ? `${apiBase}/media/${mediaId}/thumbnail` : null;
}

type Props = {
  trips: Trip[];
  userName: string;
  onOpenTrip: (id: string) => void;
  onNewTrip: () => void;
};

export function TripGallery({ trips, userName, onOpenTrip, onNewTrip }: Props) {
  if (trips.length === 0) {
    return (
      <div className="page">
        <div className="empty-hero">
          <div className="glyph">
            <Compass size={42} strokeWidth={1.5} />
          </div>
          <h1>
            Every trip deserves <em>a place to live.</em>
          </h1>
          <p>
            Start your first travel journal. Pin the spots you loved, drop in your photos, and watch
            the journey come back to life on the map.
          </p>
          <button className="btn btn-primary btn-lg" onClick={onNewTrip}>
            <Plus size={18} /> Start a journal
          </button>
        </div>
      </div>
    );
  }

  const [feature, ...rest] = trips;
  const useFeature = trips.length >= 3;
  const firstName = userName.trim().split(/\s+/)[0] || "traveller";

  return (
    <div className="page">
      <div className="gallery-head">
        <div>
          <p className="eyebrow">Welcome back, {firstName}</p>
          <h1>
            Your travels, <em>remembered.</em>
          </h1>
          <p>{pluralize(trips.length, "journal")} kept so far. Open one, or begin another.</p>
        </div>
        <button className="btn btn-primary" onClick={onNewTrip}>
          <Plus size={18} /> New trip
        </button>
      </div>

      <div className="trip-grid">
        {useFeature && feature && (
          <TripCard trip={feature} feature onOpen={onOpenTrip} delay={0} />
        )}
        {(useFeature ? rest : trips).map((trip, i) => (
          <TripCard key={trip.id} trip={trip} onOpen={onOpenTrip} delay={(i + 1) * 0.05} />
        ))}
        <button className="trip-card new-tile" onClick={onNewTrip}>
          <span className="plus">
            <Plus size={24} />
          </span>
          <span>New trip</span>
        </button>
      </div>
    </div>
  );
}

function TripCard({
  trip,
  feature = false,
  onOpen,
  delay = 0
}: {
  trip: Trip;
  feature?: boolean;
  onOpen: (id: string) => void;
  delay?: number;
}) {
  const cover = coverUrl(trip.cover_media_id);
  const dates = formatTripDates(trip.starts_at, trip.ends_at);
  const placeCount = trip.stops?.length ?? 0;

  return (
    <button
      className={feature ? "trip-card feature" : "trip-card"}
      style={{ animationDelay: `${delay}s` }}
      onClick={() => onOpen(trip.id)}
    >
      <div className={cover ? "trip-card-cover" : "trip-card-cover empty"}>
        {cover ? (
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <Compass size={36} strokeWidth={1.4} />
        )}
        {placeCount > 0 && (
          <span className="cover-count">
            <MapPin size={13} /> {placeCount}
          </span>
        )}
      </div>
      <div className="trip-card-body">
        <h3>{trip.title}</h3>
        {feature && trip.description && <p className="feature-desc">{trip.description}</p>}
        <div className="trip-card-meta">
          {dates && <span>{dates}</span>}
          {dates && placeCount > 0 && <span className="dot" />}
          {placeCount > 0 && <span>{pluralize(placeCount, "place")}</span>}
          {!dates && placeCount === 0 && <span>Empty journal</span>}
        </div>
      </div>
    </button>
  );
}
