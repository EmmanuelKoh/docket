// lib/auth-server.js — the Better Auth instance (lazy singleton).
//
// Better Auth owns identity: users, scrypt password hashes (in the
// account table), sessions, and the session cookies. It needs the drizzle
// db synchronously at construction, and our db init is async (PGlite
// fallback), so the instance is built behind getAuth() instead of at
// module top-level; the /api/auth/[...all] route awaits it per request.
//
// Signup policy: invite-only. emailAndPassword signup stays enabled at
// the API level, but the before-hook below rejects /sign-up/email unless
// the request carries a valid invite token, which it claims ATOMICALLY
// (UPDATE ... WHERE used_at IS NULL) so one link can never create two
// accounts. Server-side auth.api.createUser (admin plugin) does not pass
// through /sign-up/email, which is exactly what scripts/create-user.js
// uses to bootstrap the first admin account.
//
// Session verification is served from a signed cookie cache (maxAge
// below) — normal page loads cost ZERO database reads, per the quota
// rules in docs/store-costs.md. The trade-off: a session revoked
// elsewhere stays alive here until the cache expires (≤5 minutes).

import * as schema from '../db/schema.js';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '../config.js';
import { getDb } from './db.js';

// Stashed on globalThis for the same reason as lib/db.js: Next bundles
// this module per route, and per-bundle state would build one auth
// instance per bundle.
const g = globalThis;

async function init() {
  const db = await getDb();
  const { betterAuth } = await import('better-auth');
  const { drizzleAdapter } = await import('better-auth/adapters/drizzle');
  const { APIError, createAuthMiddleware } = await import('better-auth/api');
  const { admin } = await import('better-auth/plugins');
  const { sql } = await import('drizzle-orm');

  // Hosted: login attempts are rate-limited with the counters in Upstash
  // (in-memory counters reset per serverless instance, i.e. don't work).
  // Costs a GET+SET per /api/auth request only — auth traffic is human-
  // scale. storeSessionInDatabase keeps sessions in Postgres; without it,
  // providing secondaryStorage silently moves session rows into Redis.
  const { STORE_DRIVER } = await import('../config.js');
  let hardening = {};
  if (STORE_DRIVER === 'redis') {
    const { getRedis } = await import('./redis.js');
    const redis = await getRedis();
    hardening = {
      secondaryStorage: {
        get: async key => {
          const v = await redis.get(`rp:_auth:${key}`);
          return v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
        },
        set: async (key, value, ttl) =>
          redis.set(`rp:_auth:${key}`, value, ...(ttl ? [{ ex: ttl }] : [])),
        delete: async key => {
          await redis.del(`rp:_auth:${key}`);
        },
      },
      rateLimit: {
        enabled: true,
        storage: 'secondary-storage',
        customRules: { '/sign-in/email': { window: 60, max: 10 } },
      },
    };
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    ...hardening,
    // Falls back to SESSION_SECRET (already in Vercel env) via config.js;
    // Better Auth refuses to start in production with no secret at all.
    ...(BETTER_AUTH_SECRET ? { secret: BETTER_AUTH_SECRET } : {}),
    // Unset locally (request inference is fine on localhost); set
    // BETTER_AUTH_URL in Vercel env for production.
    ...(BETTER_AUTH_URL ? { baseURL: BETTER_AUTH_URL } : {}),
    emailAndPassword: { enabled: true },
    session: {
      cookieCache: { enabled: true, maxAge: 300 },
      storeSessionInDatabase: true,
    },
    plugins: [admin()],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        const token =
          typeof ctx.body?.inviteToken === 'string' ? ctx.body.inviteToken : '';
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
        // One statement claims the invite: valid + unused + unexpired +
        // (unpinned or pinned to this email). Zero rows back = no entry.
        const claimed = await db.execute(sql`
          update invite set used_at = now()
          where token = ${token}
            and used_at is null
            and expires_at > now()
            and (email is null or email = ${email})
          returning token
        `);
        const rows = claimed.rows ?? claimed;
        if (!rows.length) {
          throw new APIError('FORBIDDEN', {
            message: 'signup is by invitation — this link is invalid, already used, or expired',
          });
        }
      }),
    },
  });
}

export async function getAuth() {
  if (!g.__docketAuthPromise) g.__docketAuthPromise = init();
  return g.__docketAuthPromise;
}
