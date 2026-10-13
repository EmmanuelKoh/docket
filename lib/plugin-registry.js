// lib/plugin-registry.js — plugin registry storage facade.
// A registry record describes one installed plugin for one owner:
//   { id, ownerId, enabled, schedule, nextDueAt, lastRunAt, config, state,
//     lastError, lastErrorAt }
//
// schedule is { every: seconds } or { at: "HH:MM", timezone } (see
// lib/schedule.js); nextDueAt (epoch ms) is derived from it and kept in a
// due-index the tick runner claims from atomically. All schedule changes go
// through this facade so record and due-index can never disagree:
// reschedule() is called by every path that changes when a plugin should
// run (config save, enable, post-run).
//
// Same interface, two drivers, selected by STORE_DRIVER (json:
// data/plugins.json, redis: Upstash). Callers never know which is active.

import crypto from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { STORE_DRIVER } from '../config.js';
import { pluginConfig } from '../db/schema.js';
import { computeNextDueAt } from './schedule.js';
import { getDb } from './db.js';
import * as kv from './kv.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/plugins-redis.js')
  : await import('./stores/plugins-json.js');

export const listPlugins = impl.listPlugins;
export const getPlugin = impl.getPlugin;
export const upsertPlugin = impl.upsertPlugin;
export const claimDuePlugins = impl.claimDuePlugins;
export const earliestDueAt = impl.earliestDueAt;

// Refresh the owner's tick flag from the due-index (one command). Called
// after anything that changes when a plugin should run — registration,
// toggle, config save, and the end of a tick that ran something — so the
// idle /tick path can trust the blob and skip Redis entirely.
//
// WRITE BUDGET: blob writes are Advanced Operations, capped at 2K/month
// on the Hobby store (the READ side is effectively free — measured July
// 2026, reads land under data transfer). A frequently-scheduled plugin
// reschedules after every run, and writing each fresh nextDueAt would
// burn ~1,440 puts/day at every:60s. So the flag has two modes:
//   active — next due within NEAR_MS: write 0 ("check every tick"),
//            which is STABLE across runs, so the last-written dedup in
//            change-signal suppresses every write until the plugin goes
//            quiet;
//   idle   — next due far off: write the timestamp, quantized to the
//            minute so per-run jitter can't defeat the dedup. Quantizing
//            floors, so real checks resume up to 60s early — the safe
//            direction.
const NEAR_MS = 10 * 60 * 1000;

export async function syncTickSignal(ownerId) {
  const { setTickSignal } = await import('./change-signal.js');
  const due = await impl.earliestDueAt(ownerId);
  let flagValue = null; // nothing scheduled at all
  if (due != null) {
    flagValue =
      due - Date.now() < NEAR_MS ? 0 : Math.floor(due / 60000) * 60000;
  }
  await setTickSignal(ownerId, flagValue);
}

// The tick flag's cheap answer for /tick, read at most from Blob (never
// Redis or Postgres): false = the flag says nothing is due before nowMs;
// null = due, unknown, or no flag (the caller does the real claim). A flag
// of 0 (active mode above: "check every tick") returns null. Only the
// redis driver keeps the flag; json and an unset Blob token read nothing.
export async function peekDue(ownerId, nowMs) {
  if (STORE_DRIVER !== 'redis') return null;
  const { readTickSignal, signalsConfigured } = await import('./change-signal.js');
  if (!signalsConfigured()) return null;
  const flag = await readTickSignal(ownerId);
  return flag && (flag.nextDueAt === null || flag.nextDueAt > nowMs) ? false : null;
}

// Recompute a record's nextDueAt from its schedule (in place) and return
// it. A missing (unscheduled module) or invalid schedule yields null — the
// record never enters the due-index and the plugin never runs on a timer.
export function reschedule(record, fromMs = Date.now()) {
  record.nextDueAt = computeNextDueAt(record.schedule, fromMs);
  return record;
}

// Toggle a plugin. Enabling recomputes the due time from now (an `every`
// plugin becomes due within one interval; an `at` plugin at its next
// wall-clock occurrence); disabling drops it from the due-index via the
// upsert sync.
export async function setEnabled(ownerId, id, enabled) {
  const record = await impl.getPlugin(ownerId, id);
  if (!record) return null;
  record.enabled = !!enabled;
  if (enabled) reschedule(record);
  const saved = await impl.upsertPlugin(record, { create: false });
  await savePluginConfig(saved);
  await syncTickSignal(ownerId);
  return saved;
}

// ---- Postgres config truth (phase 4) ----
// enabled/schedule/config live in the plugin_config table as the system
// of record; the full runtime record (state, lastRun, due-index) stays in
// the driver store, written on the hot tick path. Call this from every
// DASHBOARD write (registration, toggle, config save) — never from tick.

export async function savePluginConfig(record) {
  const db = await getDb();
  const values = {
    ownerId: record.ownerId,
    pluginId: record.id,
    enabled: !!record.enabled,
    schedule: record.schedule ?? null,
    config: record.config ?? {},
    updatedAt: new Date(),
  };
  await db
    .insert(pluginConfig)
    .values(values)
    .onConflictDoUpdate({
      target: [pluginConfig.ownerId, pluginConfig.pluginId],
      set: {
        enabled: values.enabled,
        schedule: values.schedule,
        config: values.config,
        updatedAt: values.updatedAt,
      },
    });
}

// The stored config truth for one plugin, or null. Registration uses it
// to restore a plugin's settings when the driver store lost its record
// (fresh Redis, flushed dev store) — state is gone, config survives.
export async function getPluginConfig(ownerId, pluginId) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(pluginConfig)
    .where(
      and(eq(pluginConfig.ownerId, ownerId), eq(pluginConfig.pluginId, pluginId)),
    )
    .limit(1);
  return rows[0] || null;
}

// ---- credentials (hooks.credentials, e.g. message-ingest's ingestToken) ----
// /ingest finds its sender's owner by the token. Postgres config truth
// answers that, but a query per message would wake Neon for every text, so
// a kv mirror maps sha256(token) to the owner:
//   rp:_credentials:{moduleId}:{key}:{sha256}  ->  { ownerId }
// written when the token is minted (lib/plugin-setup.js) and when a
// Postgres lookup finds it. A mirror hit counts only while the owner's
// registry record still holds that token, so an edited token stops
// working at once although its old entry remains (dropped on that miss).
const CREDENTIALS = '_credentials';
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const credentialName = (moduleId, key, hash) => `${moduleId}:${key}:${hash}`;

// Tokens Postgres did not know, per warm instance, for a minute (as
// lib/devices.js caches unknown device tokens): a sender retrying a junk
// or stale token asks neither Redis nor Postgres again until then. A token
// minted here clears its entry. One typed into the config just after this
// instance refused it waits out the minute here.
const UNKNOWN_TTL_MS = 60 * 1000;
const UNKNOWN_MAX = 1000; // a flood of junk tokens drops the oldest
const unknown = new Map(); // credential name -> when Postgres said no

export async function mirrorCredential(moduleId, key, token, ownerId) {
  const name = credentialName(moduleId, key, sha256(token));
  unknown.delete(name);
  await kv.set(CREDENTIALS, name, { ownerId });
}

// The owner whose config for moduleId holds `token` under `key`, or null.
// A token refused in the last minute is refused again from memory. Else
// the mirror (two Redis reads hosted: the entry, then the registry record
// it is checked against); Postgres only on a miss, which also resolves a
// token whose driver-store record was lost. Push traffic only (/ingest),
// never the device cadence.
export async function findOwnerByCredential(moduleId, key, token) {
  if (!token) return null;
  const hash = sha256(token);
  const name = credentialName(moduleId, key, hash);
  const refusedAt = unknown.get(name);
  if (refusedAt !== undefined) {
    if (Date.now() - refusedAt < UNKNOWN_TTL_MS) return null;
    unknown.delete(name);
  }
  const mirrored = (await kv.get(CREDENTIALS, name))?.ownerId;
  if (mirrored) {
    const record = await impl.getPlugin(mirrored, moduleId);
    const current = record?.config?.[key];
    if (current && sha256(current) === hash) return mirrored;
    if (record) await kv.del(CREDENTIALS, name); // the token was edited away
  }
  const db = await getDb();
  const rows = await db
    .select({ ownerId: pluginConfig.ownerId })
    .from(pluginConfig)
    .where(
      sql`${pluginConfig.pluginId} = ${moduleId} and ${pluginConfig.config}->>${key}::text = ${token}`,
    )
    .limit(1);
  const ownerId = rows[0]?.ownerId || null;
  if (ownerId) await kv.set(CREDENTIALS, name, { ownerId });
  else {
    if (unknown.size >= UNKNOWN_MAX) unknown.delete(unknown.keys().next().value);
    unknown.set(name, Date.now());
  }
  return ownerId;
}
