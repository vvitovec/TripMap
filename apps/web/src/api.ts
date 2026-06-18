import type { Collaborator, Folder, PlaceSearchResult, Stop, Trip, TripDetail, User } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "/api";

type RequestOptions = RequestInit & { timeoutMs?: number };

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
  folders: () => request<{ folders: Folder[] }>("/folders"),
  createFolder: (title: string, color: string) =>
    request<{ folder: Folder }>("/folders", {
      method: "POST",
      body: JSON.stringify({ title, color })
    }),
  trips: () => request<{ trips: Trip[] }>("/trips"),
  createTrip: (input: {
    title: string;
    description: string;
    type: Trip["type"];
    folderId?: string | null;
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
      folderId?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
    }
  ) =>
    request<{ trip: Trip }>(`/trips/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  trip: (id: string) => request<TripDetail>(`/trips/${id}`),
  sharedTrip: (token: string) => request<TripDetail>(`/share/${token}`),
  collaborators: (tripId: string) =>
    request<{ collaborators: Collaborator[] }>(`/trips/${tripId}/collaborators`),
  addCollaborator: (tripId: string, email: string, role: Collaborator["role"]) =>
    request<{ collaborator: Collaborator }>(`/trips/${tripId}/collaborators`, {
      method: "POST",
      body: JSON.stringify({ email, role })
    }),
  removeCollaborator: (tripId: string, userId: string) =>
    request<{ ok: boolean }>(`/trips/${tripId}/collaborators/${userId}`, {
      method: "DELETE"
    }),
  searchPlaces: (query: string, near?: { lat: number; lng: number }) => {
    const params = new URLSearchParams({ q: query });
    if (near) {
      params.set("lat", String(near.lat));
      params.set("lng", String(near.lng));
    }
    return request<{ places: PlaceSearchResult[] }>(`/places/search?${params}`, { timeoutMs: 15_000 });
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
      arrivedAt?: string | null;
      departedAt?: string | null;
      branchOf?: string | null;
    }
  ) =>
    request<{ stop: Stop }>(`/trips/${tripId}/stops`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateStop: (
    tripId: string,
    stopId: string,
    input: Partial<{
      title: string;
      note: string;
      lat: number;
      lng: number;
      sortOrder: number;
      arrivedAt: string | null;
      departedAt: string | null;
      branchOf: string | null;
    }>
  ) =>
    request<{ stop: Stop }>(`/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteStop: (tripId: string, stopId: string) =>
    request<{ ok: boolean }>(`/trips/${tripId}/stops/${stopId}`, {
      method: "DELETE"
    }),
  addNote: (tripId: string, body: string, stopId?: string | null) =>
    request(`/trips/${tripId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body, stopId })
    }),
  share: (tripId: string) =>
    request<{ share: { token: string } }>(`/trips/${tripId}/share-links`, {
      method: "POST"
    }),
  upload: (tripId: string, files: FileList, stopId?: string | null) => {
    const form = new FormData();
    form.append("tripId", tripId);
    if (stopId) form.append("stopId", stopId);
    for (const file of Array.from(files)) form.append("file", file);
    return request("/media/upload", { method: "POST", body: form });
  },
  updateMedia: (mediaId: string, stopId: string | null) =>
    request(`/media/${mediaId}`, {
      method: "PATCH",
      body: JSON.stringify({ stopId })
    })
};
