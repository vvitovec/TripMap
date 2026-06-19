import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { categoryMeta } from "./categories";
import type { PlaceSearchResult, Stop, TripType } from "./types";

type LatLng = { lat: number; lng: number };
type StopPhoto = { id: string; url: string };

type Props = {
  stops: Stop[];
  tripType?: TripType;
  selectedStopId?: string | null;
  previewPlaces?: PlaceSearchResult[];
  pinMode?: boolean;
  draftPin?: LatLng | null;
  photosByStop?: Record<string, StopPhoto[]>;
  onSelectStop?: (id: string) => void;
  onSelectPreviewPlace?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  onPinMove?: (lat: number, lng: number) => void;
  onOpenPhoto?: (stopId: string, index: number) => void;
};

// Below this zoom, side-trip ("branch") stops fold into their main pin.
const BRANCH_ZOOM = 8.5;
// At/above this zoom, the selected pin reveals its photo carousel.
const CAROUSEL_ZOOM = 12;

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function TripMap({
  stops,
  tripType = "road_trip",
  selectedStopId,
  previewPlaces,
  pinMode = false,
  draftPin,
  photosByStop,
  onSelectStop,
  onSelectPreviewPlace,
  onMapClick,
  onPinMove,
  onOpenPhoto
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [zoom, setZoom] = useState(3.4);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  const callbacksRef = useRef({ onMapClick, onPinMove, pinMode });

  useEffect(() => {
    callbacksRef.current = { onMapClick, onPinMove, pinMode };
  }, [onMapClick, onPinMove, pinMode]);

  const previews = useMemo(() => previewPlaces ?? [], [previewPlaces]);
  const orderedStops = useMemo(
    () => [...stops].sort((a, b) => a.sort_order - b.sort_order),
    [stops]
  );

  // The route threads only the main stops; side-trips hang off them.
  const routeLine = useMemo(() => {
    if (tripType !== "road_trip") return null;
    const main = orderedStops.filter((stop) => !stop.branch_of);
    if (main.length < 2) return null;
    const coordinates = smoothPath(main.map((stop) => [stop.lng, stop.lat] as [number, number]));
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates }
        }
      ]
    };
  }, [orderedStops, tripType]);
  const latestRoute = useRef(routeLine);
  latestRoute.current = routeLine;
  const latestStops = useRef(orderedStops);
  latestStops.current = orderedStops;
  const latestPreviews = useRef(previews);
  latestPreviews.current = previews;

  // create the map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const instance = new maplibregl.Map({
      container: containerRef.current,
      center: [14.43, 50.08],
      zoom: 3.4,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          satellite: {
            type: "raster",
            tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
            tileSize: 256,
            attribution: "Sentinel-2 cloudless · EOX"
          }
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }]
      }
    });
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    instance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "top-right");

    let rafId = 0;
    const setupRoute = () => {
      if (instance.getSource("route")) return;
      instance.addSource("route", {
        type: "geojson",
        data: latestRoute.current ?? emptyCollection()
      });
      instance.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2b2620", "line-width": 5.5, "line-opacity": 0.3, "line-blur": 0.6 }
      });
      instance.addLayer({
        id: "route-base",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f6efe1", "line-width": 2.6, "line-opacity": 0.85 }
      });
      instance.addLayer({
        id: "route-flow",
        type: "line",
        source: "route",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#eccf8a",
          "line-width": 2.6,
          "line-opacity": 0.95,
          "line-dasharray": [0, 4, 3]
        }
      });

      if (!prefersReducedMotion) {
        let step = 0;
        const tick = (time: number) => {
          const next = Math.floor((time / 90) % DASH_SEQUENCE.length);
          if (next !== step && instance.getLayer("route-flow")) {
            instance.setPaintProperty("route-flow", "line-dasharray", DASH_SEQUENCE[next]!);
            step = next;
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      }
    };

    instance.on("load", setupRoute);
    instance.on("zoom", () => {
      const next = instance.getZoom();
      setZoom((prev) => (Math.abs(prev - next) > 0.15 ? next : prev));
    });
    instance.on("click", (event) => {
      if (callbacksRef.current.pinMode) {
        callbacksRef.current.onMapClick?.(event.lngLat.lat, event.lngLat.lng);
      }
    });

    mapRef.current = instance;
    // Markers are added imperatively and don't need tiles, so render them right
    // away and frame the content rather than waiting on the (tile-gated) load event.
    setMap(instance);
    fitToContent(instance, latestStops.current, latestPreviews.current);
    if (instance.isStyleLoaded()) setupRoute();

    // The map can paint blank until its container settles its size; a resize once
    // it's laid out forces the first real render.
    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      instance.off("load", setupRoute);
      mapRef.current = null;
      setMap(null);
      instance.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push route updates
  useEffect(() => {
    if (!map?.isStyleLoaded()) return;
    (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(
      routeLine ?? emptyCollection()
    );
  }, [map, routeLine]);

  // draggable draft pin
  useEffect(() => {
    if (!map || !pinMode || !draftPin) {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }
    if (!draftMarkerRef.current) {
      const marker = new maplibregl.Marker({ color: "#c4582b", draggable: true })
        .setLngLat([draftPin.lng, draftPin.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const point = marker.getLngLat();
        callbacksRef.current.onPinMove?.(point.lat, point.lng);
      });
      draftMarkerRef.current = marker;
    }
    draftMarkerRef.current.setLngLat([draftPin.lng, draftPin.lat]);
  }, [map, pinMode, draftPin?.lat, draftPin?.lng]);

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = pinMode ? "crosshair" : "";
  }, [map, pinMode]);

  // fly only when the selection actually changes — the first/default selection
  // keeps the overview framing (and stays robust to StrictMode double-invokes).
  const prevSelectedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const instance = mapRef.current;
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedStopId;
    if (!instance || prev === undefined || prev === selectedStopId) return;
    if (!selectedStopId || latestPreviews.current.length) return;
    const stop = latestStops.current.find((item) => item.id === selectedStopId);
    if (!stop) return;
    instance.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(instance.getZoom(), 12.6), duration: 800 });
  }, [selectedStopId]);

  // fit to previews while searching
  useEffect(() => {
    if (!map || !previews.length) return;
    fitToContent(map, orderedStops, previews);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, previews]);

  const branchesVisible = zoom >= BRANCH_ZOOM;
  const carouselZoom = zoom >= CAROUSEL_ZOOM;

  return (
    <div ref={containerRef} className={pinMode ? "map-canvas pin-mode" : "map-canvas"}>
      {map &&
        orderedStops.map((stop, index) => (
          <StopMarker
            key={stop.id}
            map={map}
            stop={stop}
            index={index}
            active={stop.id === selectedStopId}
            visible={!stop.branch_of || branchesVisible}
            photos={photosByStop?.[stop.id] ?? EMPTY_PHOTOS}
            carouselZoom={carouselZoom}
            onSelect={onSelectStop}
            onOpenPhoto={onOpenPhoto}
          />
        ))}
      {map &&
        previews.map((place) => (
          <PreviewMarker key={place.id} map={map} place={place} onSelect={onSelectPreviewPlace} />
        ))}
    </div>
  );
}

const EMPTY_PHOTOS: StopPhoto[] = [];

function StopMarker({
  map,
  stop,
  index,
  active,
  visible,
  photos,
  carouselZoom,
  onSelect,
  onOpenPhoto
}: {
  map: maplibregl.Map;
  stop: Stop;
  index: number;
  active: boolean;
  visible: boolean;
  photos: StopPhoto[];
  carouselZoom: boolean;
  onSelect?: (id: string) => void;
  onOpenPhoto?: (stopId: string, index: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  if (!elRef.current) {
    elRef.current = document.createElement("div");
    elRef.current.className = "pin-root";
  }
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    const marker = new maplibregl.Marker({ element: elRef.current!, anchor: "bottom" })
      .setLngLat([stop.lng, stop.lat])
      .addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    markerRef.current?.setLngLat([stop.lng, stop.lat]);
  }, [stop.lng, stop.lat]);

  useEffect(() => {
    if (elRef.current) elRef.current.style.zIndex = active ? "4" : stop.branch_of ? "1" : "2";
  }, [active, stop.branch_of]);

  const meta = categoryMeta(stop.category);
  const isBranch = Boolean(stop.branch_of);
  const showCarousel = active && carouselZoom && photos.length > 0;
  const Icon = meta.Icon;

  return createPortal(
    <div
      className={
        "map-pin" +
        (active ? " active" : "") +
        (isBranch ? " branch" : "") +
        (visible ? "" : " hidden")
      }
      style={{ ["--pin" as string]: meta.color }}
    >
      {showCarousel && (
        <PinCarousel photos={photos} onOpen={(photoIndex) => onOpenPhoto?.(stop.id, photoIndex)} />
      )}
      <button
        type="button"
        className="pin-badge"
        title={stop.title}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(stop.id);
        }}
      >
        <Icon size={active ? 17 : 14} strokeWidth={2.2} />
      </button>
      <span className="pin-stem" />
      <span className="pin-label">{isBranch ? stop.title : `${index + 1} · ${stop.title}`}</span>
    </div>,
    elRef.current
  );
}

function PinCarousel({ photos, onOpen }: { photos: StopPhoto[]; onOpen: (index: number) => void }) {
  return (
    <div className="pin-carousel" onClick={(event) => event.stopPropagation()}>
      <div className="pin-carousel-track">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="pin-carousel-shot"
            onClick={() => onOpen(index)}
          >
            <img src={photo.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewMarker({
  map,
  place,
  onSelect
}: {
  map: maplibregl.Map;
  place: PlaceSearchResult;
  onSelect?: (id: string) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  if (!elRef.current) {
    elRef.current = document.createElement("div");
    elRef.current.className = "pin-root preview";
  }
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    const marker = new maplibregl.Marker({ element: elRef.current!, anchor: "bottom" })
      .setLngLat([place.lng, place.lat])
      .addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
    };
  }, [map]);

  useEffect(() => {
    markerRef.current?.setLngLat([place.lng, place.lat]);
  }, [place.lng, place.lat]);

  return createPortal(
    <div className="map-pin preview">
      <button
        type="button"
        className="pin-badge"
        title={place.name}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(place.id);
        }}
      >
        <span className="pin-preview-dot" />
      </button>
      <span className="pin-stem" />
      <span className="pin-label">{place.name}</span>
    </div>,
    elRef.current
  );
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

// Chaikin corner-cutting — rounds the sharp joints between stops into gentle curves.
function smoothPath(points: [number, number][], iterations = 2): [number, number][] {
  let path = points;
  for (let pass = 0; pass < iterations; pass += 1) {
    if (path.length < 3) break;
    const next: [number, number][] = [path[0]!];
    for (let i = 0; i < path.length - 1; i += 1) {
      const [ax, ay] = path[i]!;
      const [bx, by] = path[i + 1]!;
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(path[path.length - 1]!);
    path = next;
  }
  return path;
}

const DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5]
];

function fitToContent(map: maplibregl.Map, stops: Stop[], previews: PlaceSearchResult[]) {
  const focus = previews.length ? previews : stops;
  if (!focus.length) return;
  if (focus.length === 1) {
    const point = focus[0]!;
    map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 12), duration: 800 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  focus.forEach((point) => bounds.extend([point.lng, point.lat]));
  map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 850 });
}
