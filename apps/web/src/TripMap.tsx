import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { PlaceSearchResult, Stop, TripType } from "./types";

type LatLng = { lat: number; lng: number };

type Props = {
  stops: Stop[];
  tripType?: TripType;
  selectedStopId?: string | null;
  previewPlaces?: PlaceSearchResult[];
  pinMode?: boolean;
  draftPin?: LatLng | null;
  onSelectStop?: (id: string) => void;
  onSelectPreviewPlace?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  onPinMove?: (lat: number, lng: number) => void;
};

export function TripMap({
  stops,
  tripType = "road_trip",
  selectedStopId,
  previewPlaces,
  pinMode = false,
  draftPin,
  onSelectStop,
  onSelectPreviewPlace,
  onMapClick,
  onPinMove
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sourceReadyRef = useRef(false);
  const callbacksRef = useRef({ onMapClick, onPinMove, onSelectStop, onSelectPreviewPlace, pinMode });

  useEffect(() => {
    callbacksRef.current = { onMapClick, onPinMove, onSelectStop, onSelectPreviewPlace, pinMode };
  }, [onMapClick, onPinMove, onSelectStop, onSelectPreviewPlace, pinMode]);

  const previews = useMemo(() => previewPlaces ?? [], [previewPlaces]);

  const geojson = useMemo(() => {
    const ordered = [...stops].sort((a, b) => a.sort_order - b.sort_order);

    const points = ordered.map((stop, index) => ({
      type: "Feature" as const,
      properties: {
        stopId: stop.id,
        title: `${index + 1}. ${stop.title}`,
        activeStop: stop.id === selectedStopId
      },
      geometry: { type: "Point" as const, coordinates: [stop.lng, stop.lat] }
    }));

    const route =
      tripType === "road_trip" && ordered.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: { kind: "route" },
              geometry: {
                type: "LineString" as const,
                coordinates: ordered.map((stop) => [stop.lng, stop.lat])
              }
            }
          ]
        : [];

    const previewPoints = previews.map((place, index) => ({
      type: "Feature" as const,
      properties: {
        previewPlaceId: place.id,
        preview: true,
        title: previews.length > 1 ? `${index + 1}. ${place.name}` : place.name
      },
      geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] }
    }));

    return {
      type: "FeatureCollection" as const,
      features: [...route, ...points, ...previewPoints]
    };
  }, [stops, previews, selectedStopId, tripType]);

  const latestGeojson = useRef(geojson);
  latestGeojson.current = geojson;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
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
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "top-right");

    const handleLoad = () => {
      map.addSource("trip", { type: "geojson", data: latestGeojson.current });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "trip",
        filter: ["all", ["==", "$type", "LineString"], ["==", "kind", "route"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2b2620", "line-width": 6, "line-opacity": 0.5 }
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "trip",
        filter: ["all", ["==", "$type", "LineString"], ["==", "kind", "route"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f3c969", "line-width": 3, "line-opacity": 0.95 }
      });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "trip",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": ["case", ["get", "activeStop"], 10, ["get", "preview"], 6, 7],
          "circle-color": ["case", ["get", "preview"], "#f6f0e4", "#c4582b"],
          "circle-stroke-color": [
            "case",
            ["get", "activeStop"],
            "#f3c969",
            ["get", "preview"],
            "#a3421c",
            "#fff7ee"
          ],
          "circle-stroke-width": ["case", ["get", "activeStop"], 3, 2.2]
        }
      });
      map.addLayer({
        id: "labels",
        type: "symbol",
        source: "trip",
        filter: ["all", ["==", "$type", "Point"], ["!=", "preview", true]],
        layout: {
          "text-field": ["get", "title"],
          "text-size": 12,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-max-width": 10
        },
        paint: {
          "text-color": "#fdfbf4",
          "text-halo-color": "#2b2620",
          "text-halo-width": 1.4
        }
      });
      sourceReadyRef.current = true;
      fitToContent(map, stops, previews);
    };

    map.on("load", handleLoad);

    map.on("click", "points", (event) => {
      const feature = event.features?.[0];
      const previewId = feature?.properties?.previewPlaceId;
      if (previewId) {
        callbacksRef.current.onSelectPreviewPlace?.(String(previewId));
        return;
      }
      const stopId = feature?.properties?.stopId;
      if (stopId) callbacksRef.current.onSelectStop?.(String(stopId));
    });

    map.on("mouseenter", "points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "points", () => {
      map.getCanvas().style.cursor = callbacksRef.current.pinMode ? "crosshair" : "";
    });

    map.on("click", (event) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: ["points"] });
      if (hits.length === 0 && callbacksRef.current.pinMode) {
        callbacksRef.current.onMapClick?.(event.lngLat.lat, event.lngLat.lng);
      }
    });

    mapRef.current = map;
    return () => {
      sourceReadyRef.current = false;
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      map.off("load", handleLoad);
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !sourceReadyRef.current) return;
    (map.getSource("trip") as maplibregl.GeoJSONSource | undefined)?.setData(geojson);
  }, [geojson]);

  // draggable draft pin
  useEffect(() => {
    const map = mapRef.current;
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
  }, [pinMode, draftPin?.lat, draftPin?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = pinMode ? "crosshair" : "";
  }, [pinMode]);

  // fly to the selected stop
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStopId || previews.length) return;
    const stop = stops.find((item) => item.id === selectedStopId);
    if (!stop) return;
    map.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(map.getZoom(), 12), duration: 800 });
  }, [selectedStopId]);

  // fit to previews when searching
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !previews.length) return;
    fitToContent(map, stops, previews);
  }, [previews]);

  return <div ref={containerRef} className={pinMode ? "map-canvas pin-mode" : "map-canvas"} />;
}

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
