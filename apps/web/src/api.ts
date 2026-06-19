import type { PlaceSearchResult, Stop, Trip, TripDetail, TripType, User } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";

type RequestOptions = RequestInit & { timeoutMs?: number };
type ChunkedUploadInit = {
  mediaId: string;
  uploadId: string;
  chunkSize: number;
  directUploadThreshold: number;
};
type UploadedPart = { partNumber: number; etag: string };

const defaultChunkedUploadThreshold = 48 * 1024 * 1024;

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { timeoutMs, ...requestInit } = init ?? {};
  const headers =
    requestInit.body === undefined || requestInit.body instanceof FormData
      ? requestInit.headers
      : { "Content-Type": "application/json", ...requestInit.headers };
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${apiBase}${path}`, {
      credentials: "include",
      headers,
      ...requestInit,
      signal: requestInit.signal ?? controller?.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Try again.");
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

async function uploadSmallFile(tripId: string, file: File, stopId?: string | null) {
  const form = new FormData();
  form.append("tripId", tripId);
  if (stopId) form.append("stopId", stopId);
  form.append("file", file);
  const response = await request<{ media: unknown[] }>("/media/upload", { method: "POST", body: form });
  return response.media;
}

async function uploadChunkedFile(tripId: string, file: File, stopId?: string | null) {
  const init = await request<ChunkedUploadInit>("/media-uploads/init", {
    method: "POST",
    body: JSON.stringify({
      tripId,
      stopId: stopId ?? null,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size
    })
  });
  const parts: UploadedPart[] = [];
  try {
    for (let offset = 0, partNumber = 1; offset < file.size; offset += init.chunkSize, partNumber += 1) {
      const chunk = file.slice(offset, Math.min(offset + init.chunkSize, file.size));
      const form = new FormData();
      form.append("file", chunk, file.name);
      const params = new URLSearchParams({
        uploadId: init.uploadId,
        partNumber: String(partNumber)
      });
      const response = await request<{ part: UploadedPart }>(`/media-uploads/${init.mediaId}/parts?${params}`, {
        method: "POST",
        body: form
      });
      if (!response.part.etag) throw new Error("Upload chunk failed");
      parts.push(response.part);
    }
    const completed = await request<{ media: unknown }>(`/media-uploads/${init.mediaId}/complete`, {
      method: "POST",
      body: JSON.stringify({ uploadId: init.uploadId, parts })
    });
    return [completed.media];
  } catch (error) {
    const params = new URLSearchParams({ uploadId: init.uploadId });
    await request<{ ok: boolean }>(`/media-uploads/${init.mediaId}?${params}`, { method: "DELETE" }).catch(
      () => undefined
    );
    throw error;
  }
}

export const api = {
  me: () => request<{ user: User | null }>("/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  register: (name: string, email: string, password: string) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  trips: () => request<{ trips: Trip[] }>("/trips"),
  trip: (id: string) => request<TripDetail>(`/trips/${id}`),
  sharedTrip: (token: string) => request<TripDetail>(`/share/${token}`),
  createTrip: (input: {
    title: string;
    description: string;
    type: TripType;
    startsAt?: string | null;
    endsAt?: string | null;
  }) =>
    request<{ trip: Trip }>("/trips", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateTrip: (
    id: string,
    input: {
      title?: string;
      description?: string;
      startsAt?: string | null;
      endsAt?: string | null;
    }
  ) =>
    request<{ trip: Trip }>(`/trips/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteTrip: (id: string) => request<{ ok: boolean }>(`/trips/${id}`, { method: "DELETE" }),

  searchPlaces: (query: string, near?: { lat: number; lng: number }) => {
    const params = new URLSearchParams({ q: query });
    if (near) {
      params.set("lat", String(near.lat));
      params.set("lng", String(near.lng));
    }
    return request<{ places: PlaceSearchResult[] }>(`/places/search?${params}`, {
      timeoutMs: 30_000
    });
  },
  reversePlace: (lat: number, lng: number) => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    return request<{ place: PlaceSearchResult }>(`/places/reverse?${params}`);
  },

  addStop: (
    tripId: string,
    input: {
      title: string;
      note: string;
      lat: number;
      lng: number;
      sortOrder: number;
      category?: string;
    }
  ) =>
    request<{ stop: Stop }>(`/trips/${tripId}/stops`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateStop: (
    tripId: string,
    stopId: string,
    input: Partial<{ title: string; note: string; sortOrder: number; category: string }>
  ) =>
    request<{ stop: Stop }>(`/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteStop: (tripId: string, stopId: string) =>
    request<{ ok: boolean }>(`/trips/${tripId}/stops/${stopId}`, { method: "DELETE" }),

  upload: async (tripId: string, files: FileList | File[], stopId?: string | null) => {
    const uploaded: unknown[] = [];
    for (const file of Array.from(files)) {
      const media =
        file.size > defaultChunkedUploadThreshold
          ? await uploadChunkedFile(tripId, file, stopId)
          : await uploadSmallFile(tripId, file, stopId);
      uploaded.push(...media);
    }
    return { media: uploaded };
  },
  deleteMedia: (mediaId: string) =>
    request<{ ok: boolean }>(`/media/${mediaId}`, { method: "DELETE" }),

  share: (tripId: string) =>
    request<{ share: { token: string } }>(`/trips/${tripId}/share-links`, { method: "POST" })
};
