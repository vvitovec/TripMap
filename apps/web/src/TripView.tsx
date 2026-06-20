import {
  Calendar,
  Check,
  ChevronLeft,
  Crosshair,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { CATEGORIES, categoryMeta, inferCategory } from "./categories";
import {
  formatTripDates,
  formatTripTimelineDates,
  fromDateInput,
  mediaThumbUrl,
  placeKindLabel,
  placeShortLabel,
  pluralize,
  toDateInput
} from "./format";
import { Lightbox } from "./Lightbox";
import { TripMap } from "./TripMap";
import type { MediaItem, PlaceSearchResult, Stop, TripDetail } from "./types";

type Props = {
  detail: TripDetail;
  readOnly?: boolean;
  onBack: () => void;
  onReload: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
};

type EditTarget = { kind: "tripDesc" | "placeTitle" | "placeNote" | "placeDate"; id?: string };
type LightboxState = { items: MediaItem[]; index: number; caption: string };

// fade thumbnails in once decoded so they don't pop against the placeholder
const markLoaded = (event: { currentTarget: HTMLImageElement }) =>
  event.currentTarget.classList.add("is-loaded");
const settleCached = (el: HTMLImageElement | null) => {
  if (el?.complete && el.naturalWidth > 0) el.classList.add("is-loaded");
};

export function TripView({ detail, readOnly = false, onBack, onReload, onDeleted, onError }: Props) {
  const { trip, stops, media } = detail;
  const orderedStops = useMemo(() => [...stops].sort((a, b) => a.sort_order - b.sort_order), [stops]);
  const mainStops = useMemo(() => orderedStops.filter((stop) => !stop.branch_of), [orderedStops]);
  const subPinsByParent = useMemo(() => {
    const map = new Map<string, Stop[]>();
    orderedStops.forEach((stop) => {
      if (!stop.branch_of) return;
      map.set(stop.branch_of, [...(map.get(stop.branch_of) ?? []), stop]);
    });
    return map;
  }, [orderedStops]);

  const [selectedStopId, setSelectedStopId] = useState<string | null>(mainStops[0]?.id ?? null);
  const [composerOpen, setComposerOpen] = useState(!readOnly && mainStops.length === 0);
  const [subPinParentId, setSubPinParentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pinMode, setPinMode] = useState(false);
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const [adding, setAdding] = useState(false);

  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [editStart, setEditStart] = useState("");

  const [uploadingStopId, setUploadingStopId] = useState<string | null>(null);
  const [dragStopId, setDragStopId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [catPickerStopId, setCatPickerStopId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const reqRef = useRef(0);

  const mediaByStop = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    media.forEach((item) => {
      if (!item.stop_id) return;
      map.set(item.stop_id, [...(map.get(item.stop_id) ?? []), item]);
    });
    return map;
  }, [media]);
  const unsorted = useMemo(() => media.filter((item) => !item.stop_id), [media]);

  const stopImages = useCallback(
    (stopId: string) =>
      (mediaByStop.get(stopId) ?? []).filter((item) => item.kind === "image" && mediaThumbUrl(item)),
    [mediaByStop]
  );

  // thumbnails handed to the map for the on-pin photo carousel
  const photosByStop = useMemo(() => {
    const out: Record<string, { id: string; url: string }[]> = {};
    orderedStops.forEach((stop) => {
      const images = stopImages(stop.id);
      if (images.length) {
        out[stop.id] = images.map((item) => ({ id: item.id, url: mediaThumbUrl(item)! }));
      }
    });
    return out;
  }, [orderedStops, stopImages]);

  const openStopPhoto = useCallback(
    (stopId: string, index: number) => {
      const images = stopImages(stopId);
      if (!images.length) return;
      const stop = orderedStops.find((item) => item.id === stopId);
      setLightbox({ items: images, index, caption: stop?.title ?? trip.title });
    },
    [orderedStops, stopImages, trip.title]
  );

  // keep selection valid
  useEffect(() => {
    if (orderedStops.length === 0) {
      setSelectedStopId(null);
      return;
    }
    if (!selectedStopId || !orderedStops.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(orderedStops[0]!.id);
    }
  }, [orderedStops, selectedStopId]);

  // focus search when composer opens
  useEffect(() => {
    if (composerOpen && !pinMode) searchInputRef.current?.focus();
  }, [composerOpen, pinMode]);

  // poll while media is still processing
  useEffect(() => {
    const pending = media.some(
      (item) => item.processing_status !== "ready" && item.processing_status !== "failed"
    );
    if (!pending) return;
    const timer = window.setTimeout(onReload, 5000);
    return () => window.clearTimeout(timer);
  }, [media, onReload]);

  const composerParent = subPinParentId ? orderedStops.find((stop) => stop.id === subPinParentId) : null;
  const anchor = composerParent
    ? { lat: composerParent.lat, lng: composerParent.lng }
    : mainStops.length
    ? { lat: mainStops[mainStops.length - 1]!.lat, lng: mainStops[mainStops.length - 1]!.lng }
    : undefined;
  const anchorKey = anchor ? `${anchor.lat.toFixed(3)},${anchor.lng.toFixed(3)}` : "";

  // debounced place search
  useEffect(() => {
    const trimmed = query.trim();
    if (pinMode) return;
    if (trimmed.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    const id = ++reqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const { places } = await api.searchPlaces(trimmed, anchor);
        if (id === reqRef.current) setResults(places);
      } catch (error) {
        if (id === reqRef.current) {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : "Search failed");
        }
      } finally {
        if (id === reqRef.current) setSearching(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, anchorKey, pinMode]);

  const resetComposer = useCallback(() => {
    setQuery("");
    setResults([]);
    setSearchError("");
    setDraftPin(null);
    setPinMode(false);
    setSubPinParentId(null);
  }, []);

  const addPlace = useCallback(
    async (place: PlaceSearchResult) => {
      if (adding) return;
      setAdding(true);
      try {
        const { stop } = await api.addStop(trip.id, {
          title: place.name,
          note: "",
          lat: place.lat,
          lng: place.lng,
          sortOrder: orderedStops.length,
          category: inferCategory(place),
          arrivedAt: null,
          departedAt: null,
          branchOf: subPinParentId
        });
        setSelectedStopId(stop.id);
        resetComposer();
        if (subPinParentId) setComposerOpen(false);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not add place");
      } finally {
        setAdding(false);
      }
    },
    [adding, onError, onReload, orderedStops.length, resetComposer, subPinParentId, trip.id]
  );

  const reverseLookup = useCallback(async (lat: number, lng: number) => {
    setSearching(true);
    const id = ++reqRef.current;
    try {
      const { place } = await api.reversePlace(lat, lng);
      if (id === reqRef.current) {
        setResults([{ ...place, lat, lng }]);
        setQuery(place.name);
      }
    } catch {
      if (id === reqRef.current) {
        setResults([
          {
            id: `pin-${lat}-${lng}`,
            name: "Dropped pin",
            label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            category: "pin",
            type: "pin",
            lat,
            lng,
            source: "map"
          }
        ]);
      }
    } finally {
      if (id === reqRef.current) setSearching(false);
    }
  }, []);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      setDraftPin({ lat, lng });
      setComposerOpen(true);
      void reverseLookup(lat, lng);
    },
    [reverseLookup]
  );

  const handlePinMove = useCallback(
    (lat: number, lng: number) => {
      setDraftPin({ lat, lng });
      void reverseLookup(lat, lng);
    },
    [reverseLookup]
  );

  const saveTrip = useCallback(
    async (patch: {
      title?: string;
      description?: string;
      rating?: number | null;
      startsAt?: string | null;
      endsAt?: string | null;
    }) => {
      try {
        await api.updateTrip(trip.id, patch);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not save");
      }
    },
    [onError, onReload, trip.id]
  );

  const saveStop = useCallback(
    async (
      stopId: string,
      patch: {
        title?: string;
        note?: string;
        category?: string;
        arrivedAt?: string | null;
        departedAt?: string | null;
        branchOf?: string | null;
      }
    ) => {
      try {
        await api.updateStop(trip.id, stopId, patch);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not save");
      }
    },
    [onError, onReload, trip.id]
  );

  const removeStop = useCallback(
    async (stop: Stop) => {
      if (!window.confirm(`Remove "${stop.title}" and its photos from this trip?`)) return;
      try {
        await api.deleteStop(trip.id, stop.id);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not remove place");
      }
    },
    [onError, onReload, trip.id]
  );

  const uploadPhotos = useCallback(
    async (stopId: string | null, files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setUploadingStopId(stopId ?? "trip");
      try {
        await api.upload(trip.id, list, stopId);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Upload failed");
      } finally {
        setUploadingStopId(null);
      }
    },
    [onError, onReload, trip.id]
  );

  const removePhoto = useCallback(
    async (item: MediaItem) => {
      try {
        await api.deleteMedia(item.id);
        onReload();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not delete photo");
      }
    },
    [onError, onReload]
  );

  const removeTrip = useCallback(async () => {
    if (!window.confirm(`Delete "${trip.title}"? This removes the journal and all its photos.`)) return;
    try {
      await api.deleteTrip(trip.id);
      onDeleted();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete trip");
    }
  }, [onDeleted, onError, trip.id, trip.title]);

  const shareTrip = useCallback(async () => {
    try {
      const { share } = await api.share(trip.id);
      const url = `${location.origin}/share/${share.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2200);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create share link");
    }
  }, [onError, trip.id]);

  const beginEdit = (target: EditTarget, value: string) => {
    setEdit(target);
    setDraft(value);
  };

  const openMainComposer = () => {
    resetComposer();
    setComposerOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const openSubPinComposer = (parentId: string) => {
    resetComposer();
    setSubPinParentId(parentId);
    setComposerOpen(true);
    setSelectedStopId(parentId);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const dates = formatTripTimelineDates(orderedStops, trip.starts_at, trip.ends_at);
  const previewPlaces = composerOpen && !pinMode ? results : [];
  const activeComposerParent = subPinParentId
    ? orderedStops.find((stop) => stop.id === subPinParentId) ?? null
    : null;

  const renderComposer = (parent?: Stop) => (
    <div className={parent ? "composer subpin-composer" : "composer"}>
      <div className="composer-head">
        <div className="search-box">
          <Search size={16} className="lead" />
          <input
            ref={searchInputRef}
            value={query}
            placeholder={
              pinMode
                ? "Drop a pin on the map…"
                : parent
                ? `Search around ${parent.title}`
                : "Search a destination, address, or landmark"
            }
            disabled={pinMode}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          className="btn btn-icon"
          title="Close"
          onClick={() => {
            resetComposer();
            if (mainStops.length) setComposerOpen(false);
          }}
        >
          <X size={18} />
        </button>
      </div>

      {parent && !pinMode && <div className="search-hint">Adding a sub-pin under {parent.title}</div>}
      {!parent && anchor && !pinMode && query.trim().length >= 3 && (
        <div className="search-hint">Showing places near your latest main pin first</div>
      )}

      <div className="search-results">
        {searching && (
          <div className="search-state">
            <Loader2 size={20} className="spin" /> Searching…
          </div>
        )}
        {!searching && searchError && <div className="search-state">{searchError}</div>}
        {!searching &&
          !searchError &&
          results.map((place) => (
            <button key={place.id} className="result" onClick={() => void addPlace(place)} disabled={adding}>
              <span className="result-pin">
                <MapPin size={16} />
              </span>
              <span className="result-text">
                <span className="result-name">{place.name}</span>
                <span className="result-label">
                  {placeKindLabel(place)} · {placeShortLabel(place)}
                </span>
              </span>
              <span className="result-add">
                <Plus size={18} />
              </span>
            </button>
          ))}
        {!searching && !searchError && !results.length && query.trim().length >= 3 && (
          <div className="search-state">No places found. Try another name.</div>
        )}
        {!searching && !results.length && query.trim().length < 3 && !pinMode && (
          <div className="search-state">
            <Search size={20} />
            Search by name, or drop a pin on the map.
          </div>
        )}
      </div>

      <div className="composer-foot">
        <button
          className={pinMode ? "pin-toggle on" : "pin-toggle"}
          onClick={() => {
            const next = !pinMode;
            setPinMode(next);
            setQuery("");
            setResults([]);
            if (!next) setDraftPin(null);
          }}
        >
          <Crosshair size={15} /> {pinMode ? "Searching by pin" : "Drop a pin instead"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="tripview">
      <div className="tripview-map">
        {pinMode && (
          <div className="map-pin-flag">
            <Crosshair size={15} /> Tap the map where it happened
          </div>
        )}
        <TripMap
          stops={orderedStops}
          selectedStopId={selectedStopId}
          previewPlaces={previewPlaces}
          pinMode={pinMode}
          draftPin={draftPin}
          photosByStop={photosByStop}
          onSelectStop={setSelectedStopId}
          onSelectPreviewPlace={(id) => {
            const place = results.find((item) => item.id === id);
            if (place) void addPlace(place);
          }}
          onMapClick={handleMapClick}
          onPinMove={handlePinMove}
          onOpenPhoto={openStopPhoto}
        />
      </div>

      <div className="tripview-journal">
        <button className="back-link" onClick={onBack}>
          <ChevronLeft size={16} /> {readOnly ? "TripMap" : "All trips"}
        </button>

          {/* ---- journal header ---- */}
        <header className="journal-head">
          <p className="eyebrow">
            <MapPin size={13} /> Trip
          </p>

          {readOnly ? (
            <h1 className="journal-title">{trip.title}</h1>
          ) : (
            <input
              className="journal-title-input"
              defaultValue={trip.title}
              key={trip.title}
              aria-label="Trip title"
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== trip.title) void saveTrip({ title: value });
              }}
            />
          )}

          <div className="journal-meta">
            {dates ? <span>{dates}</span> : null}
            {dates ? <span className="dot" /> : null}
            <span>{pluralize(mainStops.length, "destination")}</span>
            {(trip.rating || !readOnly) && (
              <>
                <span className="dot" />
                <RatingControl
                  value={trip.rating ?? null}
                  readOnly={readOnly}
                  onChange={(rating) => void saveTrip({ rating })}
                />
              </>
            )}
          </div>

          {edit?.kind === "tripDesc" ? (
            <div>
              <textarea
                className="journal-desc"
                value={draft}
                autoFocus
                placeholder="A line or two about this trip…"
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="note-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    void saveTrip({ description: draft.trim() });
                    setEdit(null);
                  }}
                >
                  <Check size={15} /> Save
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => setEdit(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : trip.description ? (
            <p
              className={readOnly ? "journal-desc" : "journal-desc editable"}
              onClick={() => !readOnly && beginEdit({ kind: "tripDesc" }, trip.description)}
            >
              {trip.description}
            </p>
          ) : (
            !readOnly && (
              <button className="place-note-empty" onClick={() => beginEdit({ kind: "tripDesc" }, "")}>
                A line or two about this trip…
              </button>
            )
          )}

          {!readOnly && (
            <div className="note-actions" style={{ marginTop: "1.4rem" }}>
              <button className="btn btn-ghost btn-sm" onClick={shareTrip}>
                {shareCopied ? <Check size={15} /> : <Share2 size={15} />}
                {shareCopied ? "Link copied" : "Share"}
              </button>
              <button className="btn btn-quiet btn-sm btn-danger" onClick={removeTrip}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}
        </header>

        {/* ---- places ---- */}
        <div className="places">
          {mainStops.map((stop, index) => {
            const subPins = subPinsByParent.get(stop.id) ?? [];
            const photos = mediaByStop.get(stop.id) ?? [];
            const isActive = stop.id === selectedStopId || subPins.some((subPin) => subPin.id === selectedStopId);
            const editingTitle = edit?.kind === "placeTitle" && edit.id === stop.id;
            const editingNote = edit?.kind === "placeNote" && edit.id === stop.id;
            const editingDate = edit?.kind === "placeDate" && edit.id === stop.id;
            const meta = categoryMeta(stop.category);
            const CatIcon = meta.Icon;
            const stopDate = formatTripDates(stop.arrived_at, null);
            return (
              <article
                key={stop.id}
                className={isActive ? "place active" : "place"}
                style={{ animationDelay: `${Math.min(index * 0.04, 0.3)}s` }}
                onMouseEnter={() => undefined}
              >
                <span className="place-index" style={{ ["--pin" as string]: meta.color }}>
                  {index + 1}
                </span>

                <div className="place-head" onClick={() => setSelectedStopId(stop.id)}>
                  <span className="place-cat-wrap">
                    <button
                      type="button"
                      className="place-cat"
                      style={{ ["--pin" as string]: meta.color }}
                      title={readOnly ? meta.label : `${meta.label} — tap to change`}
                      disabled={readOnly}
                      onClick={(event) => {
                        event.stopPropagation();
                        setCatPickerStopId((current) => (current === stop.id ? null : stop.id));
                      }}
                    >
                      <CatIcon size={16} strokeWidth={2.1} />
                    </button>
                    {catPickerStopId === stop.id && (
                      <CategoryPicker
                        current={meta.id}
                        onClose={() => setCatPickerStopId(null)}
                        onPick={(id) => {
                          setCatPickerStopId(null);
                          if (id !== meta.id) void saveStop(stop.id, { category: id });
                        }}
                      />
                    )}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {editingTitle ? (
                      <input
                        autoFocus
                        defaultValue={stop.title}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") setEdit(null);
                        }}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value && value !== stop.title) void saveStop(stop.id, { title: value });
                          setEdit(null);
                        }}
                      />
                    ) : (
                      <div className="place-title">{stop.title}</div>
                    )}
                    <div className="place-sub">
                      {editingDate ? (
                        <span className="place-date-edit" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="date"
                            value={editStart}
                            autoFocus
                            onChange={(event) => setEditStart(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setEdit(null);
                              if (event.key === "Enter") {
                                void saveStop(stop.id, { arrivedAt: fromDateInput(editStart), departedAt: null });
                                setEdit(null);
                              }
                            }}
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              void saveStop(stop.id, { arrivedAt: fromDateInput(editStart), departedAt: null });
                              setEdit(null);
                            }}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="btn btn-quiet btn-sm"
                            onClick={() => {
                              void saveStop(stop.id, { arrivedAt: null, departedAt: null });
                              setEdit(null);
                            }}
                          >
                            Clear
                          </button>
                        </span>
                      ) : (
                        <>
                          {stopDate && (
                            <button
                              className={readOnly ? "place-date read-only" : "place-date"}
                              disabled={readOnly}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditStart(toDateInput(stop.arrived_at));
                                setEdit({ kind: "placeDate", id: stop.id });
                              }}
                            >
                              <Calendar size={13} /> {stopDate}
                            </button>
                          )}
                          {!stopDate && !readOnly && (
                            <button
                              className="place-date"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditStart("");
                                setEdit({ kind: "placeDate", id: stop.id });
                              }}
                            >
                              <Calendar size={13} /> Add date
                            </button>
                          )}
                        </>
                      )}
                      {photos.length > 0 && <span>{pluralize(photos.length, "photo")}</span>}
                      {subPins.length > 0 && <span>{pluralize(subPins.length, "sub-pin")}</span>}
                    </div>
                  </div>
                  {!readOnly && (
                    <div className="place-tools">
                      <button
                        className="btn btn-icon"
                        title="Rename"
                        onClick={(event) => {
                          event.stopPropagation();
                          beginEdit({ kind: "placeTitle", id: stop.id }, stop.title);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="btn btn-icon"
                        title="Remove place"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeStop(stop);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {/* note */}
                {editingNote ? (
                  <div>
                    <textarea
                      className="note-edit"
                      value={draft}
                      autoFocus
                      placeholder="What do you want to remember about this place?"
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="note-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          void saveStop(stop.id, { note: draft.trim() });
                          setEdit(null);
                        }}
                      >
                        <Check size={15} /> Save
                      </button>
                      <button className="btn btn-quiet btn-sm" onClick={() => setEdit(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : stop.note ? (
                  <p
                    className={readOnly ? "place-note" : "place-note editable"}
                    onClick={() => !readOnly && beginEdit({ kind: "placeNote", id: stop.id }, stop.note)}
                  >
                    {stop.note}
                  </p>
                ) : (
                  !readOnly && (
                    <button
                      className="place-note-empty"
                      onClick={() => beginEdit({ kind: "placeNote", id: stop.id }, "")}
                    >
                      Add a note…
                    </button>
                  )
                )}

                <PhotoGrid
                  photos={photos}
                  readOnly={readOnly}
                  onOpen={(i) => setLightbox({ items: photos, index: i, caption: stop.title })}
                  onDelete={removePhoto}
                />

                {!readOnly && (
                  <AddPhotos
                    busy={uploadingStopId === stop.id}
                    drag={dragStopId === stop.id}
                    onDragState={(on) => setDragStopId(on ? stop.id : null)}
                    onFiles={(files) => void uploadPhotos(stop.id, files)}
                  />
                )}

                {subPins.length > 0 && (
                  <div className="subpin-list">
                    {subPins.map((subPin) => {
                      const subPhotos = mediaByStop.get(subPin.id) ?? [];
                      const subMeta = categoryMeta(subPin.category);
                      const SubIcon = subMeta.Icon;
                      const editingSubTitle = edit?.kind === "placeTitle" && edit.id === subPin.id;
                      const editingSubNote = edit?.kind === "placeNote" && edit.id === subPin.id;
                      return (
                        <section
                          key={subPin.id}
                          className={subPin.id === selectedStopId ? "subpin active" : "subpin"}
                          onClick={() => setSelectedStopId(subPin.id)}
                        >
                          <div className="subpin-head">
                            <span className="place-cat-wrap">
                              <button
                                type="button"
                                className="place-cat subpin-cat"
                                style={{ ["--pin" as string]: subMeta.color }}
                                title={readOnly ? subMeta.label : `${subMeta.label} — tap to change`}
                                disabled={readOnly}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCatPickerStopId((current) => (current === subPin.id ? null : subPin.id));
                                }}
                              >
                                <SubIcon size={14} strokeWidth={2.1} />
                              </button>
                              {catPickerStopId === subPin.id && (
                                <CategoryPicker
                                  current={subMeta.id}
                                  onClose={() => setCatPickerStopId(null)}
                                  onPick={(id) => {
                                    setCatPickerStopId(null);
                                    if (id !== subMeta.id) void saveStop(subPin.id, { category: id });
                                  }}
                                />
                              )}
                            </span>
                            <div className="subpin-copy">
                              {editingSubTitle ? (
                                <input
                                  autoFocus
                                  defaultValue={subPin.title}
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                    if (event.key === "Escape") setEdit(null);
                                  }}
                                  onBlur={(event) => {
                                    const value = event.target.value.trim();
                                    if (value && value !== subPin.title) void saveStop(subPin.id, { title: value });
                                    setEdit(null);
                                  }}
                                />
                              ) : (
                                <div className="subpin-title">{subPin.title}</div>
                              )}
                              <div className="place-sub">
                                <span>Sub-pin</span>
                                {subPhotos.length > 0 && <span>{pluralize(subPhotos.length, "photo")}</span>}
                              </div>
                            </div>
                            {!readOnly && (
                              <div className="place-tools">
                                <button
                                  className="btn btn-icon"
                                  title="Rename"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    beginEdit({ kind: "placeTitle", id: subPin.id }, subPin.title);
                                  }}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="btn btn-icon"
                                  title="Remove sub-pin"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void removeStop(subPin);
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>

                          {editingSubNote ? (
                            <div>
                              <textarea
                                className="note-edit"
                                value={draft}
                                autoFocus
                                placeholder="What do you want to remember here?"
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setDraft(event.target.value)}
                              />
                              <div className="note-actions">
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void saveStop(subPin.id, { note: draft.trim() });
                                    setEdit(null);
                                  }}
                                >
                                  <Check size={15} /> Save
                                </button>
                                <button className="btn btn-quiet btn-sm" onClick={() => setEdit(null)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : subPin.note ? (
                            <p
                              className={readOnly ? "place-note" : "place-note editable"}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!readOnly) beginEdit({ kind: "placeNote", id: subPin.id }, subPin.note);
                              }}
                            >
                              {subPin.note}
                            </p>
                          ) : (
                            !readOnly && (
                              <button
                                className="place-note-empty"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  beginEdit({ kind: "placeNote", id: subPin.id }, "");
                                }}
                              >
                                Add a note…
                              </button>
                            )
                          )}

                          <PhotoGrid
                            photos={subPhotos}
                            readOnly={readOnly}
                            onOpen={(i) => setLightbox({ items: subPhotos, index: i, caption: subPin.title })}
                            onDelete={removePhoto}
                          />

                          {!readOnly && (
                            <AddPhotos
                              busy={uploadingStopId === subPin.id}
                              drag={dragStopId === subPin.id}
                              onDragState={(on) => setDragStopId(on ? subPin.id : null)}
                              onFiles={(files) => void uploadPhotos(subPin.id, files)}
                            />
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}

                {!readOnly && composerOpen && subPinParentId === stop.id && renderComposer(stop)}

                {!readOnly && !(composerOpen && subPinParentId === stop.id) && (
                  <button className="btn btn-quiet btn-sm add-subpin" onClick={() => openSubPinComposer(stop.id)}>
                    <Plus size={15} /> Add sub-pin
                  </button>
                )}
              </article>
            );
          })}
        </div>

        {/* ---- add main place ---- */}
        {!readOnly &&
          (composerOpen && !activeComposerParent ? (
            renderComposer()
          ) : (
            <button className="btn btn-ghost add-place-cta" onClick={openMainComposer}>
              <Plus size={17} /> Add destination
            </button>
          ))}

        {/* ---- unsorted photos ---- */}
        {unsorted.length > 0 && (
          <section style={{ marginTop: "3rem" }}>
            <p className="eyebrow" style={{ marginBottom: "0.8rem" }}>
              More from this trip
            </p>
            <PhotoGrid
              photos={unsorted}
              readOnly={readOnly}
              onOpen={(i) => setLightbox({ items: unsorted, index: i, caption: trip.title })}
              onDelete={removePhoto}
            />
          </section>
        )}
      </div>

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
          onIndex={(index) => setLightbox((state) => (state ? { ...state, index } : state))}
        />
      )}
    </div>
  );
}

function RatingControl({
  value,
  readOnly,
  onChange
}: {
  value: number | null;
  readOnly: boolean;
  onChange: (value: number | null) => void;
}) {
  if (readOnly) {
    return value ? (
      <span className="rating-read">
        <Star size={14} fill="currentColor" /> {value}/10
      </span>
    ) : null;
  }

  return (
    <label className="rating-control">
      <Star size={14} fill={value ? "currentColor" : "none"} />
      <select
        value={value ?? ""}
        aria-label="Trip rating"
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">Rate</option>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
          <option key={rating} value={rating}>
            {rating}/10
          </option>
        ))}
      </select>
    </label>
  );
}

function CategoryPicker({
  current,
  onPick,
  onClose
}: {
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="cat-pop-scrim" onClick={(event) => { event.stopPropagation(); onClose(); }} />
      <div className="cat-pop" onClick={(event) => event.stopPropagation()}>
        {CATEGORIES.map((category) => {
          const Icon = category.Icon;
          return (
            <button
              key={category.id}
              type="button"
              className={category.id === current ? "cat-opt on" : "cat-opt"}
              style={{ ["--pin" as string]: category.color }}
              onClick={() => onPick(category.id)}
            >
              <Icon size={16} strokeWidth={2.1} />
              <span>{category.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function PhotoGrid({
  photos,
  readOnly,
  onOpen,
  onDelete
}: {
  photos: MediaItem[];
  readOnly: boolean;
  onOpen: (index: number) => void;
  onDelete: (item: MediaItem) => void;
}) {
  if (!photos.length) return null;
  return (
    <div className="photo-grid">
      {photos.map((item, index) => {
        const thumb = mediaThumbUrl(item);
        const showThumb = item.kind === "image" || item.thumbnailUrl;
        const processing = item.processing_status !== "ready" && item.processing_status !== "failed";
        return (
          <div className="photo" key={item.id} onClick={() => onOpen(index)}>
            {showThumb && thumb ? (
              <img
                src={thumb}
                alt={item.file_name}
                loading="lazy"
                ref={settleCached}
                onLoad={markLoaded}
                onError={markLoaded}
              />
            ) : (
              <div className="photo processing" style={{ position: "absolute", inset: 0 }}>
                <Play size={22} />
              </div>
            )}
            {item.kind === "video" && (
              <span className="photo-badge">
                <Play size={11} /> Video
              </span>
            )}
            {processing && (
              <span className="photo-badge">
                <Loader2 size={11} className="spin" />
              </span>
            )}
            {!readOnly && (
              <button
                className="photo-del"
                title="Delete media"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item);
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddPhotos({
  busy,
  drag,
  onFiles,
  onDragState
}: {
  busy: boolean;
  drag: boolean;
  onFiles: (files: FileList) => void;
  onDragState: (on: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        className={drag ? "add-photos drag" : "add-photos"}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          onDragState(true);
        }}
        onDragLeave={() => onDragState(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDragState(false);
          if (event.dataTransfer.files?.length) onFiles(event.dataTransfer.files);
        }}
      >
        {busy ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
        {busy ? "Uploading…" : drag ? "Drop them here" : "Add media"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif,video/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
