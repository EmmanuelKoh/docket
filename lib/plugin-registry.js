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

import { eq, and } from 'drizzle-orm';
import { STORE_DRIVER } from '../config.js';
import { pluginConfig } from '../db/schema.js';
import { computeNextDueAt } from './schedule.js';
import { getDb } from './db.js';

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

// Recompute a record's nextDueAt from its schedule (in place) and return
// it. Passive/invalid schedules yield null — the record never enters the
// due-index and the plugin never runs on a timer.
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
