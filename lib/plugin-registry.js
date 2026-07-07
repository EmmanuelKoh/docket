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

import { STORE_DRIVER } from '../config.js';
import { computeNextDueAt } from './schedule.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/plugins-redis.js')
  : await import('./stores/plugins-json.js');

export const listPlugins = impl.listPlugins;
export const getPlugin = impl.getPlugin;
export const upsertPlugin = impl.upsertPlugin;
export const claimDuePlugins = impl.claimDuePlugins;

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
  return impl.upsertPlugin(record, { create: false });
}
