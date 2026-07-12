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
// Which owner the local-dev DEVICE_TOKEN resolves to (see below); set it
// to your local account id if you drive the queue with the laptop agents.
export const OWNER_ID      = process.env.OWNER_ID || 'default';
export const LEASE_SECONDS = parseInt(process.env.LEASE_SECONDS, 10) || 120;

// Postgres (Neon) — system of record for users, devices, and record
// metadata; Redis stays the hot path (queue, due-index, mirrors). Unset
// locally = lib/db.js falls back to PGlite, an embedded Postgres in
// data/pg/, so dev works with no cloud account (the json-driver
// equivalent for SQL).
export const DATABASE_URL = process.env.DATABASE_URL || '';

// Local-dev shared device secret for the laptop agents
// (agent/heartbeat.js, agent/printer-agent.js) — real printers use
// per-device pairing tokens (lib/devices.js). No default on Vercel, so
// this door does not exist hosted; it maps to the OWNER_ID owner below.
export const DEVICE_TOKEN =
  process.env.DEVICE_TOKEN || (process.env.VERCEL ? '' : 'dev-token');

// Better Auth (user accounts). The secret signs its session cookies —
// falls back to SESSION_SECRET (the pre-accounts cookie secret, still in
// hosted env) so deployments need no new var. BETTER_AUTH_URL pins the
// canonical origin in production; unset locally, the origin is inferred
// per request.
export const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || '';
export const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || '';

// Heartbeat — seconds between /tick POSTs from agent/heartbeat.js. Each tick
// runs whichever registered plugins are enabled and due.
export const HEARTBEAT_SECONDS = parseInt(process.env.HEARTBEAT_SECONDS, 10) || 30;

// Message ingestion (/ingest) — texts forwarded from a phone are classified
// by Gemini and printed as task receipts when they contain one. The
// forwarder authenticates with the per-owner token from the message-ingest
// plugin config (Slips page). GEMINI_API_KEY comes from Google AI Studio.
// INGEST_TIMEZONE controls how "received at" prints on the receipt.
export const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
export const INGEST_TIMEZONE = process.env.INGEST_TIMEZONE || 'America/New_York';

// ESPN poller (WATCH_TEAMS also seeds the espn-worldcup plugin's config on
// first registration)
export const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL, 10) || 30;
export const WATCH_TEAMS   = process.env.WATCH_TEAMS
  ? process.env.WATCH_TEAMS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
