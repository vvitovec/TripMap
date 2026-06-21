# TripMap

Map-first travel journal for saving trips, photos, short videos, and notes.

## Stack

- React + Vite web app, designed to be wrapped by Capacitor later.
- Fastify API with Postgres/PostGIS, Redis, and MinIO.
- BullMQ media worker using Sharp and FFmpeg.
- MapLibre GL JS with a satellite raster layer and trip GeoJSON overlays.

## Local Development

```bash
pnpm install
pnpm dev
```

The Docker Compose setup is the production-shaped runtime:

```bash
docker compose -f infra/docker-compose.yml up --build
```

## Production

Backend deployment target:

```text
baller:/srv/projects/TripMap
```

Run:

```bash
pnpm deploy:baller
```

Verify the public production surfaces:

```bash
pnpm verify:production
```

The app is served on port `8327` by default.

The public app is served at `trip.vvitovec.com` through the `basev-platform`
Cloudflare Tunnel, forwarding to the Baller web service on port `8327`. The API
is also reachable at `trip-api.vvitovec.com` and through `/api/*` on the app
domain.
