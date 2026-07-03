// lib/session.js — stateless signed-cookie sessions for the dashboard door.
//
// The cookie payload is base64url JSON ({ exp }) plus an HMAC-SHA256 signature
// keyed by SESSION_SECRET. No server-side session storage — Vercel functions
// share no memory, so validity must be provable from the cookie alone.
//
// Device endpoints (/next /ack /nack /tick) never use this — they keep
// Bearer DEVICE_TOKEN auth only.

import crypto from 'crypto';
import { SESSION_SECRET } from '../config.js';

const COOKIE_NAME = 'docket_session';
const SESSION_DAYS = 30;

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

export function createSessionCookie() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400 * 1000 })
  ).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  return serialize(value, SESSION_DAYS * 86400);
}

export function clearSessionCookie() {
  return serialize('', 0);
}

function serialize(value, maxAge) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

export function hasValidSession(req) {
  if (!SESSION_SECRET) return false;
  const cookies = req.headers?.cookie || '';
  const match = cookies.split(/;\s*/).find(c => c.startsWith(COOKIE_NAME + '='));
  if (!match) return false;
  const value = match.slice(COOKIE_NAME.length + 1);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

// For HTML pages: redirect to /login when signed out. Returns true if OK.
export function requireSessionPage(req, res) {
  if (hasValidSession(req)) return true;
  res.setHeader('Location', '/login');
  res.status(302).send('');
  return false;
}

// For JSON APIs: 401 when signed out. Returns true if OK.
export function requireSessionApi(req, res) {
  if (hasValidSession(req)) return true;
  res.status(401).json({ error: 'sign in required' });
  return false;
}
