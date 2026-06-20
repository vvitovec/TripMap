import { Compass, MapPin, Plus } from "lucide-react";
import { formatTripTimelineDates, pluralize } from "./format";
import type { Trip } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";

function coverUrl(mediaId?: string | null) {
  return mediaId ? `${apiBase}/media/${mediaId}/thumbnail` : null;
}

// fade covers in once decoded so they don't pop against the placeholder
const markLoaded = (event: { currentTarget: HTMLImageElement }) =>
  event.currentTarget.classList.add("is-loaded");
const settleCached = (el: HTMLImageElement | null) => {
  if (el?.complete && el.naturalWidth > 0) el.classList.add("is-loaded");
};

type Props = {
  trips: Trip[];
  userName: string;
  loading?: boolean;
  onOpenTrip: (id: string) => void;
  onNewTrip: () => void;
};

export function TripGallery({ trips, userName, loading = false, onOpenTrip, onNewTrip }: Props) {
  if (loading && trips.length === 0) {
    return <GallerySkeleton />;
  }

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
  const dates = formatTripTimelineDates(trip.stops, trip.starts_at, trip.ends_at);
  const placeCount = trip.stops?.filter((stop) => !stop.branch_of).length ?? 0;

  return (
    <button
      className={feature ? "trip-card feature" : "trip-card"}
      style={{ animationDelay: `${delay}s` }}
      onClick={() => onOpen(trip.id)}
    >
      <div className={cover ? "trip-card-cover" : "trip-card-cover empty"}>
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            ref={settleCached}
            onLoad={markLoaded}
            onError={markLoaded}
          />
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
          {placeCount > 0 && <span>{pluralize(placeCount, "destination")}</span>}
          {!dates && placeCount === 0 && <span>Empty journal</span>}
        </div>
      </div>
    </button>
  );
}

function GallerySkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading your trips">
      <div className="gallery-head">
        <div>
          <div className="sk sk-eyebrow" />
          <div className="sk sk-title" />
          <div className="sk sk-line" />
        </div>
      </div>
      <div className="trip-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="trip-card skeleton" key={i}>
            <div className="trip-card-cover sk" />
            <div className="trip-card-body">
              <div className="sk sk-h" />
              <div className="sk sk-sub" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
