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

Deployment target:

```text
baller:/srv/projects/TripMap
```

Run:

```bash
pnpm deploy:baller
```

The app is served on port `8327` by default.
