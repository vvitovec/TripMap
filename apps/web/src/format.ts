import type { MediaItem, PlaceSearchResult, Stop } from "./types";

export function mediaThumbUrl(item: MediaItem) {
  return item.thumbnailUrl ?? item.optimizedUrl ?? item.originalUrl ?? undefined;
}

export function mediaFullUrl(item: MediaItem) {
  return item.optimizedUrl ?? item.originalUrl ?? item.thumbnailUrl ?? undefined;
}

export function isImage(item: MediaItem) {
  return item.kind === "image";
}

export function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function placeKindLabel(place: PlaceSearchResult) {
  const type = place.type && place.type !== "yes" ? place.type : place.category;
  return titleize(type || "Place");
}

export function placeShortLabel(place: PlaceSearchResult) {
  const parts = place.label.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return place.label;
  // drop the first part if it just repeats the name
  const rest = parts[0]?.toLowerCase() === place.name.toLowerCase() ? parts.slice(1) : parts;
  return rest.slice(0, 3).join(", ");
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function fmt(date: Date, opts: Intl.DateTimeFormatOptions) {
  return date.toLocaleDateString(undefined, opts);
}

export function formatTripDates(start?: string | null, end?: string | null): string {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;
  const validEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : null;

  if (validStart && validEnd) {
    const sameDay = validStart.toDateString() === validEnd.toDateString();
    if (sameDay) return fmt(validStart, { day: "numeric", month: "short", year: "numeric" });
    const sameYear = validStart.getFullYear() === validEnd.getFullYear();
    const sameMonth = sameYear && validStart.getMonth() === validEnd.getMonth();
    if (sameMonth) {
      return `${validStart.getDate()}–${validEnd.getDate()} ${fmt(validEnd, {
        month: "short",
        year: "numeric"
      })}`;
    }
    if (sameYear) {
      return `${fmt(validStart, { day: "numeric", month: "short" })} – ${fmt(validEnd, {
        day: "numeric",
        month: "short",
        year: "numeric"
      })}`;
    }
    return `${fmt(validStart, { day: "numeric", month: "short", year: "numeric" })} – ${fmt(validEnd, {
      day: "numeric",
      month: "short",
      year: "numeric"
    })}`;
  }
  if (validStart) return fmt(validStart, { day: "numeric", month: "short", year: "numeric" });
  if (validEnd) return fmt(validEnd, { day: "numeric", month: "short", year: "numeric" });
  return "";
}

export function formatTripTimelineDates(
  stops: Stop[] = [],
  fallbackStart?: string | null,
  fallbackEnd?: string | null
) {
  const datedMainStops = stops
    .filter((stop) => !stop.branch_of && stop.arrived_at)
    .map((stop) => stop.arrived_at!)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  if (datedMainStops.length) {
    return formatTripDates(datedMainStops[0], datedMainStops[datedMainStops.length - 1]);
  }

  return formatTripDates(fallbackStart, fallbackEnd);
}

export function toDateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function fromDateInput(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
