import {
  Camera,
  Check,
  Crosshair,
  FolderPlus,
  Image,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  Search,
  Route,
  Share2,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { TripMap } from "./TripMap";
import type { Folder, PlaceSearchResult, Trip, TripDetail, User } from "./types";

type AuthMode = "login" | "register";

export function App() {
  const shareToken = location.pathname.startsWith("/share/")
    ? location.pathname.split("/share/")[1]
    : null;
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
  const [placeDraft, setPlaceDraft] = useState<PlaceSearchResult | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [searchingPlaces, setSearchingPlaces] = useState(false);

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

  const mediaCount = detail?.media.length ?? 0;
  const currentTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const tripCenter = useMemo(() => {
    const stops = detail?.stops ?? currentTrip?.stops ?? [];
    if (!stops.length) return undefined;
    return {
      lat: stops.reduce((sum, stop) => sum + stop.lat, 0) / stops.length,
      lng: stops.reduce((sum, stop) => sum + stop.lng, 0) / stops.length
    };
  }, [currentTrip?.stops, detail?.stops]);

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
        .searchPlaces(query, tripCenter)
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
  }, [placeQuery, selectedTripId, tripCenter, user]);

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

  async function quickCreateTrip(type: Trip["type"]) {
    setBusy(true);
    try {
      const title = type === "road_trip" ? "New road trip" : "New destination";
      const { trip } = await api.createTrip({
        title,
        description: "Start adding stops, notes, photos, and short videos.",
        type
      });
      setSelectedTripId(trip.id);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectPlace(place: PlaceSearchResult) {
    setPlaceDraft(place);
    setDraftTitle(place.name);
    setDraftNote("");
  }

  function previewMapPin(lat: number, lng: number) {
    if (!selectedTripId) return;
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
  }

  async function addStopFromDraft() {
    if (!selectedTripId || !placeDraft) return;
    setBusy(true);
    setError(null);
    const sortOrder = detail?.stops.length ?? currentTrip?.stops.length ?? 0;
    try {
      await api.addStop(selectedTripId, {
        title: draftTitle.trim() || placeDraft.name || `Stop ${sortOrder + 1}`,
        note: draftNote.trim(),
        lat: placeDraft.lat,
        lng: placeDraft.lng,
        sortOrder
      });
      setDetail(await api.trip(selectedTripId));
      setPlaceDraft(null);
      setDraftTitle("");
      setDraftNote("");
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
      await api.upload(selectedTripId, files);
      setDetail(await api.trip(selectedTripId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
                <span><Image /> {detail.media.length} media</span>
              </div>
              <div className="presentation-media compact">
                {detail.media.map((item) =>
                  item.kind === "video" ? (
                    <video key={item.id} src={item.optimizedUrl ?? item.originalUrl ?? undefined} controls />
                  ) : (
                    <img key={item.id} src={item.optimizedUrl ?? item.originalUrl ?? undefined} alt={item.file_name} />
                  )
                )}
              </div>
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
          <button onClick={() => quickCreateTrip("one_destination")} disabled={busy}>
            <Plus size={16} /> Destination
          </button>
          <button onClick={() => quickCreateTrip("road_trip")} disabled={busy}>
            <Route size={16} /> Road trip
          </button>
        </div>

        <section className="folder-strip">
          <button
            className="folder-create"
            onClick={async () => {
              const title = window.prompt("Folder name");
              if (!title) return;
              await api.createFolder(title, "#16a34a");
              await load();
            }}
          >
            <FolderPlus size={16} /> Folder
          </button>
          {folders.map((folder) => (
            <span key={folder.id} className="folder-pill" style={{ borderColor: folder.color }}>
              {folder.title}
            </span>
          ))}
        </section>

        <section className="trip-list">
          {trips.map((trip) => (
            <button
              key={trip.id}
              className={trip.id === selectedTripId ? "trip-card active" : "trip-card"}
              onClick={() => setSelectedTripId(trip.id)}
            >
              <span>{trip.type === "road_trip" ? <Route size={16} /> : <MapPin size={16} />}</span>
              <strong>{trip.title}</strong>
              <small>{trip.stops.length} stops{trip.folder_title ? ` · ${trip.folder_title}` : ""}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="map-stage">
        <TripMap
          trips={trips}
          selectedTripId={selectedTripId}
          previewPlace={placeDraft}
          onSelectTrip={setSelectedTripId}
          onMapClick={previewMapPin}
        />
      </section>

      <aside className="detail-panel">
        {detail ? (
          <>
            <div>
              <p className="eyebrow">{detail.trip.type === "road_trip" ? "Road trip" : "One destination"}</p>
              <h2>{detail.trip.title}</h2>
              <p>{detail.trip.description}</p>
            </div>

            <div className="stats-grid">
              <span><MapPin /> {detail.stops.length} stops</span>
              <span><Image /> {mediaCount} media</span>
            </div>

            <section className="place-workflow">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Add destination</p>
                  <h3>Find a place</h3>
                </div>
                {searchingPlaces ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              </div>
              <div className="search-input">
                <Search size={17} />
                <input
                  value={placeQuery}
                  onChange={(event) => setPlaceQuery(event.target.value)}
                  placeholder="Address, hotel, resort, landmark"
                />
              </div>
              <div className="quick-chips">
                {["hotel", "resort", "landmark", "airport", "beach", "park"].map((label) => (
                  <button
                    key={label}
                    onClick={() => setPlaceQuery(`${label} ${detail.trip.title}`)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {placeResults.length ? (
                <div className="place-results">
                  {placeResults.map((place) => (
                    <button
                      key={place.id}
                      className={placeDraft?.id === place.id ? "place-result active" : "place-result"}
                      onClick={() => selectPlace(place)}
                      type="button"
                    >
                      <MapPin size={16} />
                      <span>
                        <strong>{place.name}</strong>
                        <small>{place.category} · {place.label}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : placeQuery.trim().length >= 3 && !searchingPlaces ? (
                <p className="muted">No places found.</p>
              ) : null}

              {placeDraft ? (
                <div className="draft-stop">
                  <div className="draft-map-row">
                    <Crosshair size={17} />
                    <span>{placeDraft.label}</span>
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
                  <button className="wide-button" onClick={addStopFromDraft} disabled={busy}>
                    <Check size={16} /> Add to trip
                  </button>
                </div>
              ) : null}
            </section>

            <label className="upload-box">
              <Upload />
              <span>Upload photos or videos</span>
              <input type="file" accept="image/*,video/*" multiple onChange={(event) => upload(event.target.files)} />
            </label>

            <button className="wide-button" onClick={() => setPresentation(true)}>
              <Camera size={16} /> Open presentation
            </button>
            <button
              className="wide-button subtle"
              onClick={async () => {
                const { share } = await api.share(detail.trip.id);
                await navigator.clipboard.writeText(`${location.origin}/share/${share.token}`);
              }}
            >
              <Share2 size={16} /> Copy share link
            </button>

            <div className="timeline">
              {detail.stops.map((stop) => (
                <article key={stop.id}>
                  <strong>{stop.title}</strong>
                  <small>{stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}</small>
                  {stop.note ? <p>{stop.note}</p> : null}
                </article>
              ))}
            </div>

            <div className="media-grid">
              {detail.media.map((item) => (
                <figure key={item.id}>
                  {item.kind === "video" ? (
                    <video src={item.optimizedUrl ?? item.originalUrl ?? undefined} controls />
                  ) : (
                    <img src={item.thumbnailUrl ?? item.optimizedUrl ?? item.originalUrl ?? undefined} alt={item.file_name} />
                  )}
                  <figcaption>{item.processing_status}</figcaption>
                </figure>
              ))}
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
            <div className="presentation-media">
              {detail.media.length ? (
                detail.media.map((item) =>
                  item.kind === "video" ? (
                    <video key={item.id} src={item.optimizedUrl ?? item.originalUrl ?? undefined} controls />
                  ) : (
                    <img key={item.id} src={item.optimizedUrl ?? item.originalUrl ?? undefined} alt={item.file_name} />
                  )
                )
              ) : (
                <p>Add photos or videos to turn this trip into a presentation.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="toast">{error}</div> : null}
    </main>
  );
}
