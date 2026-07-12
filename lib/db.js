// lib/db.js — Postgres client (lazy singleton), the SQL sibling of
// lib/redis.js. Postgres is the system of record for users, devices, and
// (from phase 4) job/template/take metadata; Redis keeps the hot path
// (queue, due-index, plugin state, mirrors).
//
// HARD RULE: nothing on the device cadence may import this on its hot
// path. /next and idle /tick must stay Blob/Redis-only, or Neon never
// scales to zero (docs/store-costs.md has the CU-hour math).
//
// Driver selection mirrors STORE_DRIVER:
//   DATABASE_URL set   → Neon serverless Postgres over HTTP (production,
//                        or local dev against a Neon branch)
//   DATABASE_URL unset → PGlite, an embedded Postgres living in data/pg/
//                        (dev dependency; local dev needs no cloud account)
//
// Migrations live in db/migrations (npm run db:generate). Neon applies
// them via npm run db:migrate; PGlite applies them automatically on first
// use so local dev is always current.

import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_URL } from '../config.js';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

// The promise is stashed on globalThis, not module state: Next bundles
// this module separately into each route/page, and per-bundle state would
// open one PGlite instance per bundle over the same data dir — writes in
// one invisible to the others. globalThis is shared per Node process
// (also survives dev hot reload).
const g = globalThis;

async function init() {
  if (DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const { drizzle } = await import('drizzle-orm/neon-http');
    return drizzle(neon(DATABASE_URL));
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  // PGlite mkdirs its data dir but not parents; a fresh checkout has no data/.
  const dataDir = path.join(process.cwd(), 'data', 'pg');
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client);
  // Auto-apply migrations locally; skip until the first one exists.
  if (fs.existsSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'))) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  return db;
}

export async function getDb() {
  if (!g.__docketDbPromise) g.__docketDbPromise = init();
  return g.__docketDbPromise;
}
