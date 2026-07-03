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

// Shared secret for device-facing endpoints (/next, /ack, /nack). The default
// keeps local dev working out of the box; set a long random value anywhere
// the server is reachable from outside your machine.
export const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'dev-token';

// Dashboard door. DASHBOARD_PASSWORD is what you type at /login;
// SESSION_SECRET signs the stateless session cookie. No defaults — both must
// be set (locally in .env, hosted in the Vercel env vars) for login to work.
export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

// Heartbeat — seconds between /tick POSTs from agent/heartbeat.js. Each tick
// runs whichever registered plugins are enabled and due.
export const HEARTBEAT_SECONDS = parseInt(process.env.HEARTBEAT_SECONDS, 10) || 30;

// ESPN poller (WATCH_TEAMS also seeds the espn-worldcup plugin's config on
// first registration)
export const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL, 10) || 30;
export const WATCH_TEAMS   = process.env.WATCH_TEAMS
  ? process.env.WATCH_TEAMS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
