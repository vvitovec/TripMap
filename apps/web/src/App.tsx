import {
  Camera,
  FolderPlus,
  Image,
  LogOut,
  MapPin,
  Plus,
  Route,
  Share2,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { TripMap } from "./TripMap";
import type { Folder, Trip, TripDetail, User } from "./types";

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

  async function addStopFromMap(lat: number, lng: number) {
    if (!selectedTripId) return;
    const sortOrder = detail?.stops.length ?? currentTrip?.stops.length ?? 0;
    await api.addStop(selectedTripId, {
      title: sortOrder === 0 ? "Main stop" : `Stop ${sortOrder + 1}`,
      note: "",
      lat,
      lng,
      sortOrder
    });
    setDetail(await api.trip(selectedTripId));
    await load();
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
              onAddStop={() => undefined}
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
        <TripMap trips={trips} selectedTripId={selectedTripId} onSelectTrip={setSelectedTripId} onAddStop={addStopFromMap} />
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
