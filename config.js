// config.js — single source for all environment-specific settings.
// Copy .env.example to .env and fill in your values, or export env vars directly.

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DejaVu TTFs are vendored in render/fonts so the render core works the same on
// macOS, Linux, and Vercel without a system font install. Override with FONT_DIR.
const BUNDLED_FONT_DIR = path.join(__dirname, 'render', 'fonts');

export const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.1.87';
export const PRINTER_PORT = parseInt(process.env.PRINTER_PORT, 10) || 9100;
export const PRINT_WIDTH  = parseInt(process.env.PRINT_WIDTH, 10)  || 576;
export const FONT_DIR     = process.env.FONT_DIR     || BUNDLED_FONT_DIR;
export const JOB_CAP      = parseInt(process.env.JOB_CAP, 10)      || 50;

// Storage
// STORE_DRIVER selects the backing store for templates, jobs, and poller
// state: 'json' (local files in data/) or 'redis' (Upstash Redis + Vercel
// Blob). Connection vars for the redis driver are read directly by
// lib/redis.js and the @vercel/blob SDK — see .env.example.
export const STORE_DRIVER  = (process.env.STORE_DRIVER || 'json').toLowerCase();
export const OWNER_ID      = process.env.OWNER_ID || 'default';
export const LEASE_SECONDS = parseInt(process.env.LEASE_SECONDS, 10) || 120;

// Postgres (Neon) — system of record for users, devices, and record
// metadata; Redis stays the hot path (queue, due-index, mirrors). Unset
// locally = lib/db.js falls back to PGlite, an embedded Postgres in
// data/pg/, so dev works with no cloud account (the json-driver
// equivalent for SQL).
export const DATABASE_URL = process.env.DATABASE_URL || '';

// Legacy shared device secret (/next, /ack, /nack, /tick) — the
// transition fallback while printers move to per-device pairing tokens
// (lib/devices.js). The dev-token default only ever applies locally:
// hosted deployments get no default, so the old insecure out-of-the-box
// token cannot exist in production.
export const DEVICE_TOKEN =
  process.env.DEVICE_TOKEN || (process.env.VERCEL ? '' : 'dev-token');

// Dashboard door. DASHBOARD_PASSWORD is what you type at /login;
// SESSION_SECRET signs the stateless session cookie. No defaults — both must
// be set (locally in .env, hosted in the Vercel env vars) for login to work.
export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

// Better Auth (user accounts). The secret signs its session cookies —
// falls back to SESSION_SECRET so hosted deployments need no new var
// (Better Auth itself refuses to boot in production with none set, and
// uses a fixed dev secret locally). BETTER_AUTH_URL pins the canonical
// origin in production; unset locally, the origin is inferred per request.
export const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || '';
export const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || '';

// Heartbeat — seconds between /tick POSTs from agent/heartbeat.js. Each tick
// runs whichever registered plugins are enabled and due.
export const HEARTBEAT_SECONDS = parseInt(process.env.HEARTBEAT_SECONDS, 10) || 30;

// Message ingestion (/ingest) — texts forwarded from a phone are classified
// by Gemini and printed as task receipts when they contain one.
// INGEST_TOKEN is the shared secret the forwarder sends (no default: the
// endpoint refuses to run without it). GEMINI_API_KEY comes from Google AI
// Studio. INGEST_TIMEZONE controls how "received at" prints on the receipt.
export const INGEST_TOKEN    = process.env.INGEST_TOKEN || '';
export const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
export const INGEST_TIMEZONE = process.env.INGEST_TIMEZONE || 'America/New_York';

// ESPN poller (WATCH_TEAMS also seeds the espn-worldcup plugin's config on
// first registration)
export const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL, 10) || 30;
export const WATCH_TEAMS   = process.env.WATCH_TEAMS
  ? process.env.WATCH_TEAMS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
