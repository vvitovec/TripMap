import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl
});

export async function migrate() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS folders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      color text NOT NULL DEFAULT '#3b82f6',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS trips (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      type text NOT NULL CHECK (type IN ('one_destination', 'road_trip')),
      starts_at timestamptz,
      ends_at timestamptz,
      privacy text NOT NULL DEFAULT 'private',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS trip_collaborators (
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('viewer', 'editor')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (trip_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS stops (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      title text NOT NULL,
      note text NOT NULL DEFAULT '',
      lat double precision NOT NULL,
      lng double precision NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      arrived_at timestamptz,
      departed_at timestamptz,
      branch_of uuid REFERENCES stops(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      stop_id uuid REFERENCES stops(id) ON DELETE CASCADE,
      author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      stop_id uuid REFERENCES stops(id) ON DELETE SET NULL,
      uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('image', 'video')),
      original_key text NOT NULL,
      optimized_key text,
      thumbnail_key text,
      mime_type text NOT NULL,
      file_name text NOT NULL,
      size_bytes bigint NOT NULL,
      width integer,
      height integer,
      duration_seconds double precision,
      captured_at timestamptz,
      latitude double precision,
      longitude double precision,
      metadata jsonb NOT NULL DEFAULT '{}',
      processing_status text NOT NULL DEFAULT 'queued',
      processing_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS share_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'viewer',
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS stops_trip_order_idx ON stops(trip_id, sort_order);
    CREATE INDEX IF NOT EXISTS media_trip_idx ON media_items(trip_id, created_at);
    CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips(owner_id, created_at DESC);
  `);
}
