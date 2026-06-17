import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { PlaceSearchResult, Trip } from "./types";

type Props = {
  trips: Trip[];
  selectedTripId: string | null;
  selectedStopId?: string | null;
  previewPlace?: PlaceSearchResult | null;
  previewPlaces?: PlaceSearchResult[];
  previewRoute?: Array<{ lat: number; lng: number }>;
  onSelectTrip: (id: string) => void;
  onSelectStop?: (id: string) => void;
  onSelectPreviewPlace?: (id: string) => void;
  onMapClick: (lat: number, lng: number) => void;
  onViewChange?: (center: { lat: number; lng: number }) => void;
};

export function TripMap({
  trips,
  selectedTripId,
  selectedStopId,
  previewPlace,
  previewPlaces,
  previewRoute,
  onSelectTrip,
  onSelectStop,
  onSelectPreviewPlace,
  onMapClick,
  onViewChange
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacksRef = useRef({
    onMapClick,
    onSelectPreviewPlace,
    onSelectStop,
    onSelectTrip,
    onViewChange
  });
  const previewRoutePoints = previewRoute ?? [];

  useEffect(() => {
    callbacksRef.current = {
      onMapClick,
      onSelectPreviewPlace,
      onSelectStop,
      onSelectTrip,
      onViewChange
    };
  }, [onMapClick, onSelectPreviewPlace, onSelectStop, onSelectTrip, onViewChange]);

  const effectivePreviewPlaces = useMemo(() => {
    const previews = new Map<string, PlaceSearchResult>();
    previewPlaces?.forEach((place) => previews.set(place.id, place));
    if (previewPlace) previews.set(previewPlace.id, previewPlace);
    return [...previews.values()];
  }, [previewPlace, previewPlaces]);

  const geojson = useMemo(() => {
    const pointFeatures = trips.flatMap((trip) =>
      trip.stops.map((stop) => ({
        type: "Feature" as const,
        properties: {
          tripId: trip.id,
          stopId: stop.id,
          title: stop.title,
          tripTitle: trip.title,
          selected: trip.id === selectedTripId,
          activeStop: stop.id === selectedStopId,
          branchOf: stop.branch_of ?? ""
        },
        geometry: {
          type: "Point" as const,
          coordinates: [stop.lng, stop.lat]
        }
      }))
    );
    const lineFeatures = trips
      .flatMap((trip) => {
        const orderedStops = [...trip.stops].sort((a, b) => a.sort_order - b.sort_order);
        const mainStops = orderedStops.filter((stop) => !stop.branch_of);
        const route =
          trip.type === "road_trip" && mainStops.length > 1
            ? [
                {
                  type: "Feature" as const,
                  properties: { tripId: trip.id, selected: trip.id === selectedTripId, kind: "route" },
                  geometry: {
                    type: "LineString" as const,
                    coordinates: mainStops.map((stop) => [stop.lng, stop.lat])
                  }
                }
              ]
            : [];
        const branches = orderedStops.flatMap((stop) => {
          if (!stop.branch_of) return [];
          const parent = orderedStops.find((item) => item.id === stop.branch_of);
          if (!parent) return [];
          return [
            {
              type: "Feature" as const,
              properties: { tripId: trip.id, selected: trip.id === selectedTripId, kind: "branch" },
              geometry: {
                type: "LineString" as const,
                coordinates: [
                  [parent.lng, parent.lat],
                  [stop.lng, stop.lat]
                ]
              }
            }
          ];
        });
        return [...route, ...branches];
      });
    const previewFeatures = effectivePreviewPlaces.map((place, index) => ({
      type: "Feature" as const,
      properties: {
        tripId: "",
        previewPlaceId: place.id,
        title: effectivePreviewPlaces.length > 1 ? `${index + 1}. ${place.name}` : place.name,
        tripTitle: "Preview",
        selected: true,
        preview: true
      },
      geometry: {
        type: "Point" as const,
        coordinates: [place.lng, place.lat]
      }
    }));
    const previewRouteFeature =
      previewRoutePoints.length > 1
        ? {
            type: "Feature" as const,
            properties: { tripId: "", selected: true, kind: "preview-route" },
            geometry: {
              type: "LineString" as const,
              coordinates: previewRoutePoints.map((point) => [point.lng, point.lat])
            }
          }
        : null;
    return {
      type: "FeatureCollection" as const,
      features: [
        ...lineFeatures,
        ...(previewRouteFeature ? [previewRouteFeature] : []),
        ...pointFeatures,
        ...previewFeatures
      ]
    };
  }, [effectivePreviewPlaces, previewRoutePoints, selectedStopId, selectedTripId, trips]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [14.43, 50.08],
      zoom: 4,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
            ],
            tileSize: 256,
            attribution: "Sentinel-2 cloudless - EOX"
          }
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }]
      }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "top-right");

    const reportCenter = () => {
      const center = map.getCenter();
      callbacksRef.current.onViewChange?.({ lat: center.lat, lng: center.lng });
    };

    map.on("load", () => {
      reportCenter();
      map.addSource("trips", { type: "geojson", data: geojson });
      map.addLayer({
        id: "trip-lines",
        type: "line",
        source: "trips",
        filter: ["all", ["==", "$type", "LineString"], ["==", ["get", "kind"], "route"]],
        paint: {
          "line-width": ["case", ["get", "selected"], 5, 3],
          "line-color": ["case", ["get", "selected"], "#f97316", "#38bdf8"],
          "line-opacity": 0.88
        }
      });
      map.addLayer({
        id: "trip-branches",
        type: "line",
        source: "trips",
        filter: ["all", ["==", "$type", "LineString"], ["==", ["get", "kind"], "branch"]],
        paint: {
          "line-width": ["case", ["get", "selected"], 4, 2],
          "line-color": ["case", ["get", "selected"], "#22c55e", "#67e8f9"],
          "line-dasharray": [1.4, 1.2],
          "line-opacity": 0.9
        }
      });
      map.addLayer({
        id: "preview-route",
        type: "line",
        source: "trips",
        filter: ["all", ["==", "$type", "LineString"], ["==", ["get", "kind"], "preview-route"]],
        paint: {
          "line-width": 4,
          "line-color": "#fde047",
          "line-dasharray": [1.2, 1],
          "line-opacity": 0.95
        }
      });
      map.addLayer({
        id: "trip-points",
        type: "circle",
        source: "trips",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": [
            "case",
            ["get", "activeStop"],
            12,
            ["get", "selected"],
            10,
            7
          ],
          "circle-color": [
            "case",
            ["get", "preview"],
            "#22c55e",
            ["get", "activeStop"],
            "#fde047",
            ["get", "selected"],
            "#f97316",
            "#f8fafc"
          ],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 2
        }
      });
      map.addLayer({
        id: "trip-labels",
        type: "symbol",
        source: "trips",
        filter: ["==", "$type", "Point"],
        layout: {
          "text-field": ["get", "title"],
          "text-size": 12,
          "text-offset": [0, 1.35],
          "text-anchor": "top"
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 1.2
        }
      });
    });

    map.on("click", "trip-points", (event) => {
      const feature = event.features?.[0];
      if (feature?.properties?.preview) {
        const previewPlaceId = feature.properties.previewPlaceId;
        if (previewPlaceId) callbacksRef.current.onSelectPreviewPlace?.(previewPlaceId);
        return;
      }
      const tripId = feature?.properties?.tripId;
      const stopId = feature?.properties?.stopId;
      if (tripId) callbacksRef.current.onSelectTrip(tripId);
      if (stopId) callbacksRef.current.onSelectStop?.(stopId);
    });

    map.on("click", (event) => {
      const features = map.queryRenderedFeatures(event.point, { layers: ["trip-points"] });
      if (features.length === 0) callbacksRef.current.onMapClick(event.lngLat.lat, event.lngLat.lng);
    });
    map.on("moveend", reportCenter);

    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource("trips") as maplibregl.GeoJSONSource | undefined;
    source?.setData(geojson);
  }, [geojson]);

  useEffect(() => {
    if (previewRoutePoints.length > 1 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds();
      previewRoutePoints.forEach((point) => bounds.extend([point.lng, point.lat]));
      mapRef.current.fitBounds(bounds, { padding: 90, maxZoom: 12, duration: 850 });
      return;
    }
    if (effectivePreviewPlaces.length === 1 && mapRef.current) {
      const place = effectivePreviewPlaces[0]!;
      mapRef.current.flyTo({
        center: [place.lng, place.lat],
        zoom: Math.max(mapRef.current.getZoom(), 12),
        duration: 850
      });
      return;
    }
    if (effectivePreviewPlaces.length > 1 && mapRef.current) {
      const bounds = new maplibregl.LngLatBounds();
      effectivePreviewPlaces.forEach((place) => bounds.extend([place.lng, place.lat]));
      mapRef.current.fitBounds(bounds, { padding: 90, maxZoom: 12, duration: 850 });
      return;
    }
    const trip = trips.find((item) => item.id === selectedTripId);
    if (!trip?.stops.length || !mapRef.current) return;
    const bounds = new maplibregl.LngLatBounds();
    trip.stops.forEach((stop) => bounds.extend([stop.lng, stop.lat]));
    mapRef.current.fitBounds(bounds, { padding: 90, maxZoom: 12, duration: 900 });
  }, [effectivePreviewPlaces, previewRoutePoints, selectedTripId, trips]);

  return <div ref={containerRef} className="map-canvas" />;
}
