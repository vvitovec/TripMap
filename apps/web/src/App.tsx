import { Compass, LogOut, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { initials } from "./format";
import { TripGallery } from "./TripGallery";
import { TripView } from "./TripView";
import type { Trip, TripDetail, User } from "./types";

function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <Compass size={size * 0.55} strokeWidth={1.7} />
    </span>
  );
}

export function App() {
  const shareToken = location.pathname.startsWith("/share/")
    ? location.pathname.split("/share/")[1] || null
    : null;

  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [sharedDetail, setSharedDetail] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // boot: shared trip, or current session
  useEffect(() => {
    if (shareToken) {
      api
        .sharedTrip(shareToken)
        .then(setSharedDetail)
        .catch((err) => setError(err.message))
        .finally(() => setBooting(false));
      return;
    }
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => undefined)
      .finally(() => setBooting(false));
  }, [shareToken]);

  const loadTrips = useCallback(async () => {
    if (!user) return;
    const { trips } = await api.trips();
    setTrips(trips);
  }, [user]);

  useEffect(() => {
    loadTrips()
      .catch((err) => setError(err.message))
      .finally(() => setTripsLoaded(true));
  }, [loadTrips]);

  const loadDetail = useCallback(async () => {
    if (!selectedTripId) {
      setDetail(null);
      return;
    }
    const data = await api.trip(selectedTripId);
    setDetail(data);
  }, [selectedTripId]);

  useEffect(() => {
    loadDetail().catch((err) => setError(err.message));
  }, [loadDetail]);

  const reload = useCallback(() => {
    loadDetail().catch((err) => setError(err.message));
    loadTrips().catch((err) => setError(err.message));
  }, [loadDetail, loadTrips]);

  const createTrip = useCallback(
    async (input: { title: string; description: string; startsAt: string | null; endsAt: string | null }) => {
      const { trip } = await api.createTrip({
        title: input.title,
        description: input.description,
        type: "road_trip",
        startsAt: input.startsAt,
        endsAt: input.endsAt
      });
      setShowCreate(false);
      await loadTrips().catch(() => undefined);
      setSelectedTripId(trip.id);
    },
    [loadTrips]
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    setTrips([]);
    setTripsLoaded(false);
    setSelectedTripId(null);
    setDetail(null);
  }, []);

  if (booting) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <BrandMark size={56} />
          <span>TripMap</span>
        </div>
      </div>
    );
  }

  // shared (read-only) trip view
  if (shareToken) {
    if (!sharedDetail) {
      return (
        <div className="boot">
          <div className="boot-inner">
            <BrandMark size={56} />
            <span>{error ?? "Loading shared trip…"}</span>
          </div>
        </div>
      );
    }
    return (
      <>
        <TripView
          detail={sharedDetail}
          readOnly
          onBack={() => {
            location.href = "/";
          }}
          onReload={() => undefined}
          onDeleted={() => undefined}
          onError={setError}
        />
        <ErrorBanner error={error} onClose={() => setError(null)} />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AuthScreen onAuthed={setUser} onError={setError} />
        <ErrorBanner error={error} onClose={() => setError(null)} />
      </>
    );
  }

  const showTrip = selectedTripId && detail;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setSelectedTripId(null)}>
          <BrandMark />
          <span className="brand-word">
            Trip<b>Map</b>
          </span>
        </button>
        <div className="topbar-actions">
          <span className="user-chip">
            <span className="avatar">{initials(user.name)}</span>
            <span className="user-name">{user.name}</span>
          </span>
          <button className="btn btn-icon" title="Sign out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {showTrip ? (
        <TripView
          detail={detail!}
          onBack={() => setSelectedTripId(null)}
          onReload={reload}
          onDeleted={() => {
            setSelectedTripId(null);
            setDetail(null);
            loadTrips().catch(() => undefined);
          }}
          onError={setError}
        />
      ) : (
        <TripGallery
          trips={trips}
          userName={user.name}
          loading={!tripsLoaded}
          onOpenTrip={setSelectedTripId}
          onNewTrip={() => setShowCreate(true)}
        />
      )}

      {showCreate && (
        <CreateTripModal onClose={() => setShowCreate(false)} onCreate={createTrip} onError={setError} />
      )}
      <ErrorBanner error={error} onClose={() => setError(null)} />
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function AuthScreen({ onAuthed, onError }: { onAuthed: (user: User) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { user } =
        mode === "login" ? await api.login(email, password) : await api.register(name, email, password);
      onAuthed(user);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-art">
        <span className="brand">
          <BrandMark />
          <span className="brand-word">
            Trip<b>Map</b>
          </span>
        </span>
        <p className="auth-art-quote">“We travel not to escape life, but for life not to escape us.”</p>
        <p className="auth-art-foot">Keep every journey somewhere it can be found again.</p>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <span className="brand auth-card-brand">
            <BrandMark size={32} />
            <span className="brand-word">
              Trip<b>Map</b>
            </span>
          </span>
          <h1>{mode === "login" ? "Welcome back" : "Start your atlas"}</h1>
          <p>
            {mode === "login"
              ? "Sign in to open your travel journals."
              : "Create an account to begin keeping your trips."}
          </p>
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Traveller" />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="At least 8 characters"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
              {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "login" ? "New to TripMap?" : "Already have an account?"}{" "}
            <button onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function CreateTripModal({
  onClose,
  onCreate,
  onError
}: {
  onClose: () => void;
  onCreate: (input: {
    title: string;
    description: string;
    startsAt: string | null;
    endsAt: string | null;
  }) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        startsAt: start ? new Date(`${start}T12:00:00`).toISOString() : null,
        endsAt: end ? new Date(`${end}T12:00:00`).toISOString() : null
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create trip");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New journal">
        <div className="modal-head">
          <h2>New journal</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="sub">Give your trip a name. You can add places and photos next.</p>
        <form className="modal-form" onSubmit={submit}>
          <label className="field">
            <span>Trip name</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
              placeholder="Iceland Ring Road, summer ’24"
            />
          </label>
          <label className="field">
            <span>A few words (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ten days chasing waterfalls and midnight sun."
            />
          </label>
          <div className="row">
            <label className="field">
              <span>From</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
              {busy ? "Creating…" : "Create trip"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ErrorBanner({ error, onClose }: { error: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(onClose, 6000);
    return () => window.clearTimeout(timer);
  }, [error, onClose]);
  if (!error) return null;
  return (
    <div className="banner error">
      <span>{error}</span>
      <button onClick={onClose} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
