// db/schema.js — the Drizzle schema: every Postgres table, defined in one
// place. drizzle-kit diffs this file against db/migrations to generate new
// migration SQL (npm run db:generate).
//
// Written in JS (not TS) so plain-node scripts/ can import through
// lib/db.js — same reason all of lib/ is JS.
//
// user/session/account/verification are Better Auth's core tables (plus
// the admin plugin's role/ban fields), hand-ported from the shapes its
// CLI generates for Drizzle pg — column names stay snake_case to match.
// invite is ours: signup is invite-only, and the before-hook in
// lib/auth-server.js claims a row here atomically during sign-up.
//
// Phase 3 adds devices; phase 4 adds jobs/templates/tape_takes/
// plugin_configs.

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // admin plugin fields
  role: text('role'),
  banned: boolean('banned'),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // admin plugin field
  impersonatedBy: text('impersonated_by'),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(), // "credential" for email+password
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'), // scrypt hash, salt:hex
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Invite-only signup. token is the url-safe secret in the invite link;
// email, when set, pins the invite to one address. usedAt doubles as the
// claim: sign-up atomically flips it (UPDATE ... WHERE used_at IS NULL)
// so one link can never create two accounts.
// A physical printer (or laptop agent) paired to an account. Rows are
// born unclaimed by POST /pair (device sends its hardware id, gets a
// short code to print); claiming from the dashboard sets ownerId + name;
// the device's next poll collects tokenPlain ONCE, after which only
// tokenHash (sha256) remains. Steady-state auth never reads this table —
// a Redis mirror + in-memory cache serve the 3-second polling path.
// ownerId is plain text (a user id, or the legacy owner id) — no FK, same
// transition reasoning as invite.
export const device = pgTable('device', {
  id: text('id').primaryKey(),
  hardwareId: text('hardware_id').notNull().unique(),
  ownerId: text('owner_id'),
  name: text('name'),
  tokenHash: text('token_hash'),
  tokenPlain: text('token_plain'),
  pairCode: text('pair_code'),
  pairCodeExpiresAt: timestamp('pair_code_expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  pairedAt: timestamp('paired_at'),
  revokedAt: timestamp('revoked_at'),
});

// ---- record stores (phase 4: Postgres as system of record) ----
// Owner ids are plain text throughout (a user id, or the legacy owner).
// The hot path never reads these tables: the print queue/lease, plugin
// state, and due-index stay in Redis; large artifacts stay in Blob (the
// *Url columns) or, for local dev without Blob, inline base64 (png/bytes).

export const template = pgTable(
  'template',
  {
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    template: text('template').notNull(),
    data: jsonb('data'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.ownerId, t.name] })],
);

// Job metadata + debug record. Ids are job-N per owner, so the key is
// composite. status is informational for listing — the Redis queue and
// inflight lease stay authoritative while a job is live.
export const job = pgTable(
  'job',
  {
    ownerId: text('owner_id').notNull(),
    id: text('id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    status: text('status').notNull(),
    name: text('name').notNull().default(''),
    source: text('source').notNull().default(''),
    template: text('template'),
    data: jsonb('data'),
    dataUrl: text('data_url'),
    pngUrl: text('png_url'),
    bytesUrl: text('bytes_url'),
    png: text('png'), // inline base64, json driver only
    bytes: text('bytes'), // inline base64, json driver only
    width: integer('width'),
    height: integer('height'),
    claimedAt: timestamp('claimed_at'),
  },
  t => [primaryKey({ columns: [t.ownerId, t.id] })],
);

// Tape take metadata; the take document + WAV live in Blob (hosted) or
// data/tape files (local). deletedAt is the soft-delete tombstone.
export const tapeTake = pgTable('tape_take', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  seconds: real('seconds'),
  sampleRate: integer('sample_rate'),
  noteCount: integer('note_count'),
  hasAudio: boolean('has_audio').notNull().default(false),
  docUrl: text('doc_url'),
  audioUrl: text('audio_url'),
  deletedAt: timestamp('deleted_at'),
});

// Plugin CONFIG truth (enabled/schedule/config). The full runtime record
// (state, lastRun, due-index) lives in Redis, written on the hot tick
// path; dashboard config writes land here first and mirror into the
// Redis record, so a lost Redis can be re-seeded from this table.
export const pluginConfig = pgTable(
  'plugin_config',
  {
    ownerId: text('owner_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    schedule: jsonb('schedule'),
    config: jsonb('config'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.ownerId, t.pluginId] })],
);

// createdBy/usedBy are plain text, not FKs: during the accounts
// transition invites can be minted by the legacy owner, who has no user
// row yet.
export const invite = pgTable('invite', {
  token: text('token').primaryKey(),
  email: text('email'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  usedBy: text('used_by'),
});
