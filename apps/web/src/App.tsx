import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  FileText,
  FolderPlus,
  GripVertical,
  Image,
  Loader2,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Search,
  Route,
  Share2,
  Trash2,
  X,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { TripMap } from "./TripMap";
import type { Folder, PlaceSearchResult, Stop, Trip, TripDetail, User } from "./types";

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
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [newTripType, setNewTripType] = useState<Trip["type"]>("one_destination");
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newTripDescription, setNewTripDescription] = useState("");
  const [newTripFolderId, setNewTripFolderId] = useState("");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingStop, setEditingStop] = useState(false);
  const [stopTitleDraft, setStopTitleDraft] = useState("");
  const [stopNoteDraft, setStopNoteDraft] = useState("");

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
    if (!detail?.stops.length) {
      setSelectedStopId(null);
      return;
    }
    if (!selectedStopId || !detail.stops.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(detail.stops[0]!.id);
    }
  }, [detail, selectedStopId]);

  const mediaCount = detail?.media.length ?? 0;
  const currentTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const activeStop = useMemo(
    () => detail?.stops.find((stop) => stop.id === selectedStopId) ?? null,
    [detail?.stops, selectedStopId]
  );
  const orderedStops = useMemo(
    () => [...(detail?.stops ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [detail?.stops]
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

  useEffect(() => {
    if (!activeStop || editingStop) return;
    setStopTitleDraft(activeStop.title);
    setStopNoteDraft(activeStop.note ?? "");
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

  function openCreateTrip(type: Trip["type"]) {
    setNewTripType(type);
    setNewTripTitle(type === "road_trip" ? "Summer road trip" : "Beach weekend");
    setNewTripDescription("");
    setNewTripFolderId("");
    setShowCreateTrip(true);
  }

  async function createTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { trip } = await api.createTrip({
        title: newTripTitle.trim(),
        description:
          newTripDescription.trim() ||
          "Add destinations, notes, photos, and short videos as the trip unfolds.",
        type: newTripType,
        folderId: newTripFolderId || null
      });
      setSelectedTripId(trip.id);
      setShowCreateTrip(false);
      setPlaceDraft(null);
      setPlaceQuery("");
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

  async function previewMapPin(lat: number, lng: number) {
    if (!selectedTripId) return;
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

  async function addStopFromDraft() {
    if (!selectedTripId || !placeDraft) return;
    setBusy(true);
    setError(null);
    const sortOrder = detail?.stops.length ?? currentTrip?.stops.length ?? 0;
    try {
      const { stop } = await api.addStop(selectedTripId, {
        title: draftTitle.trim() || placeDraft.name || `Stop ${sortOrder + 1}`,
        note: draftNote.trim(),
        lat: placeDraft.lat,
        lng: placeDraft.lng,
        sortOrder
      });
      setDetail(await api.trip(selectedTripId));
      setSelectedStopId(stop.id);
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
      await api.upload(selectedTripId, files, selectedStopId);
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
      await api.addNote(selectedTripId, noteDraft.trim(), selectedStopId);
      setNoteDraft("");
      setDetail(await api.trip(selectedTripId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveActiveStop() {
    if (!selectedTripId || !activeStop) return;
    setBusy(true);
    try {
      await api.updateStop(selectedTripId, activeStop.id, {
        title: stopTitleDraft.trim() || activeStop.title,
        note: stopNoteDraft.trim()
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
      setSelectedStopId(null);
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
    if (media) bits.push(`${media} media`);
    if (notes) bits.push(`${notes} notes`);
    return bits.join(" · ");
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
            <select value={newTripFolderId} onChange={(event) => setNewTripFolderId(event.target.value)}>
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
            <button className="wide-button" disabled={busy || !newTripTitle.trim()}>
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
          selectedStopId={selectedStopId}
          previewPlace={placeDraft}
          onSelectTrip={setSelectedTripId}
          onSelectStop={setSelectedStopId}
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
                    <div className="editor-actions">
                      <button className="wide-button" onClick={saveActiveStop} disabled={busy} type="button">
                        <Check size={16} /> Save
                      </button>
                      <button
                        className="wide-button subtle"
                        onClick={() => {
                          setEditingStop(false);
                          setStopTitleDraft(activeStop.title);
                          setStopNoteDraft(activeStop.note ?? "");
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
                    {activeStop.note ? <p>{activeStop.note}</p> : null}
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
                    onClick={() =>
                      setPlaceQuery(activeStop ? `${label} near ${activeStop.title}` : `${label} ${detail.trip.title}`)
                    }
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
              <span>{activeStop ? `Upload to ${activeStop.title}` : "Upload photos or videos"}</span>
              <input type="file" accept="image/*,video/*" multiple onChange={(event) => upload(event.target.files)} />
            </label>

            <section className="note-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Notes</p>
                  <h3>{activeStop ? activeStop.title : detail.trip.title}</h3>
                </div>
                <FileText size={18} />
              </div>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder={activeStop ? "Add a note for this stop" : "Add a trip note"}
                rows={3}
              />
              <button className="wide-button subtle" onClick={addNote} disabled={busy || !noteDraft.trim()}>
                <Plus size={16} /> Add note
              </button>
              <div className="note-list">
                {detail.notes
                  .filter((note) => (selectedStopId ? note.stop_id === selectedStopId : !note.stop_id))
                  .map((note) => (
                    <article key={note.id}>
                      <p>{note.body}</p>
                      <small>{new Date(note.created_at).toLocaleDateString()}</small>
                    </article>
                  ))}
              </div>
            </section>

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
              {orderedStops.map((stop, index) => (
                <article
                  key={stop.id}
                  className={stop.id === selectedStopId ? "stop-card active" : "stop-card"}
                >
                  <button className="stop-main" onClick={() => setSelectedStopId(stop.id)} type="button">
                    <strong>{stop.title}</strong>
                    <small>{stopSubtitle(stop)}</small>
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
