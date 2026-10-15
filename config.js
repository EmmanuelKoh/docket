// config.js — single source for all environment-specific settings.
// Copy .env.example to .env and fill in your values, or export env vars directly.

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DejaVu TTFs are vendored in render/fonts so the render core works the same on
// macOS, Linux, and Vercel without a system font install. Override with FONT_DIR.
const BUNDLED_FONT_DIR = path.join(__dirname, 'render', 'fonts');

// The laptop printer agent's target: a network printer's address, or
// file:<dir> for the dry-run sink (each job's bytes go to <dir>/<job
// id>.bin). No default: agent/printer-agent.js exits when it is unset.
export const PRINTER_IP   = process.env.PRINTER_IP   || '';
export const PRINTER_PORT = parseInt(process.env.PRINTER_PORT, 10) || 9100;
export const PRINT_WIDTH  = parseInt(process.env.PRINT_WIDTH, 10)  || 576;
export const FONT_DIR     = process.env.FONT_DIR     || BUNDLED_FONT_DIR;
export const JOB_CAP      = parseInt(process.env.JOB_CAP, 10)      || 50;

// The deploy, as the short commit hash Vercel sets (empty locally). Slip
// preview URLs carry it, so a deploy that changes rendering refreshes them.
export const DEPLOY_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);

// Storage
// Records (accounts, devices, templates, jobs, plugin config) live in
// Postgres either way. STORE_DRIVER selects the hot-path stores: 'json'
// (local: files in data/, the queue as rows in PGlite) or 'redis'
// (Upstash Redis + Vercel Blob). Connection vars for the redis driver are
// read directly by lib/redis.js and the @vercel/blob SDK; see .env.example.
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

// Local state directory for every json-driver file and PGlite. Tests point
// it at a temp dir (and PGLITE_DIR at 'memory://') so they never touch the
// developer's data/ or a cloud database.
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
export const PGLITE_DIR = process.env.PGLITE_DIR || path.join(DATA_DIR, 'pg');

// Local-dev defaults (the dev-token below, the generated session secret
// in lib/auth-secret.js) exist only outside production builds and off
// Vercel, so a production deploy anywhere gets none of them.
export const DEV_DEFAULTS = !(
  process.env.VERCEL || process.env.NODE_ENV === 'production'
);

// Local-dev shared device secret for the laptop agents
// (agent/heartbeat.js, agent/printer-agent.js) — real printers use
// per-device pairing tokens (lib/devices.js). The 'dev-token' default is
// a DEV_DEFAULTS one, so a production deploy has no such door unless
// DEVICE_TOKEN is set; it maps to the OWNER_ID owner below.
export const DEVICE_TOKEN =
  process.env.DEVICE_TOKEN || (DEV_DEFAULTS ? 'dev-token' : '');

// Better Auth (user accounts). The secret signs its session cookies —
// falls back to SESSION_SECRET (the pre-accounts cookie secret, still in
// hosted env) so deployments need no new var. With neither set, a local
// run generates one (lib/auth-secret.js). BETTER_AUTH_URL pins the
// canonical origin in production; unset locally, the origin is inferred
// per request.
export const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || '';
// Better Auth also reads two names itself: AUTH_SECRET (its other name
// for the secret) and BETTER_AUTH_SECRETS (versioned secrets for
// rotation, "2:new,1:old"). Either one counts as a configured secret, so
// a local run generates none and passes none over it (lib/auth-secret.js).
export const AUTH_SECRET_IN_ENV = !!(
  process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRETS
);
export const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || '';

// Heartbeat — seconds between /tick POSTs from agent/heartbeat.js. Each tick
// runs whichever registered plugins are enabled and due.
export const HEARTBEAT_SECONDS = parseInt(process.env.HEARTBEAT_SECONDS, 10) || 30;

// Message ingestion (/ingest) — texts forwarded from a phone are classified
// by Gemini and printed as task receipts when they contain one. The
// forwarder authenticates with the per-owner token from the message-ingest
// plugin config (Slips page). GEMINI_API_KEY comes from Google AI Studio.
// The receipt's timezone is the plugin's timezone config.
export const GEMINI_API_KEY  = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

// WATCH_TEAMS seeds the espn-worldcup plugin's watchTeams config on first
// registration (comma-separated team abbreviations; empty = all teams).
export const WATCH_TEAMS   = process.env.WATCH_TEAMS
  ? process.env.WATCH_TEAMS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
