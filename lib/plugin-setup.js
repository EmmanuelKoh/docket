// lib/plugin-setup.js — plugin registration and record migration, shared by
// /tick (authoritative, every cold start) and the dashboard Plugins page
// (so a newly deployed plugin shows up before its first tick).
//
// Ensures every installed plugin module has a registry record with a
// schedule and a due-index entry, and migrates records created before
// schedules existed: intervalSeconds becomes { every }, and morning-brief's
// printAt/timezone config becomes its { at } schedule.

import { OWNER_ID, WATCH_TEAMS } from '../config.js';
import { listPlugins, upsertPlugin, reschedule } from './plugin-registry.js';
import { getState } from './state-store.js';
import { PLUGINS } from '../plugins/index.js';

let checked = false;

// Returns the current records (post-registration/migration). Cheap when
// warm: one listPlugins per process, then reuses nothing — callers that
// need records fetch their own.
export async function ensureRegistered({ force = false } = {}) {
  const records = await listPlugins(OWNER_ID);
  if (checked && !force) return records;

  for (const module of PLUGINS) {
    const existing = records.find(r => r.id === module.id);

    if (!existing) {
      const config = { ...(module.defaults.config || {}) };
      let state = {};
      if (module.id === 'espn-worldcup') {
        // First registration imports the retired poller's state so nothing
        // already printed reprints, and watchTeams from WATCH_TEAMS.
        state = (await getState('espn')) || {};
        if (WATCH_TEAMS.length) config.watchTeams = WATCH_TEAMS;
      }
      const record = {
        id: module.id,
        ownerId: OWNER_ID,
        enabled: module.defaults.enabled !== false,
        schedule: module.passive ? null : { ...(module.defaults.schedule || {}) },
        nextDueAt: null,
        lastRunAt: null,
        config,
        state,
        lastError: null,
        lastErrorAt: null,
      };
      if (!module.passive) reschedule(record);
      await upsertPlugin(record);
      records.push(record);
      console.log(`  registered plugin "${module.id}"`);
      continue;
    }

    if (module.passive) continue;

    // Migrate pre-schedule records (created before schedules existed).
    if (!existing.schedule) {
      if (module.id === 'morning-brief') {
        existing.schedule = {
          at: existing.config?.printAt || '06:30',
          timezone: existing.config?.timezone || 'America/New_York',
        };
        if (existing.config) delete existing.config.printAt;
      } else if (existing.intervalSeconds) {
        existing.schedule = { every: existing.intervalSeconds };
      } else {
        existing.schedule = { ...(module.defaults.schedule || {}) };
      }
      delete existing.intervalSeconds;
      reschedule(existing);
      await upsertPlugin(existing, { create: false });
      console.log(`  migrated plugin "${module.id}" to schedule`);
      continue;
    }

    // Repair: enabled with a schedule but no due entry (e.g. hand-edited).
    if (existing.enabled && !Number.isFinite(existing.nextDueAt)) {
      reschedule(existing);
      await upsertPlugin(existing, { create: false });
    }
  }

  checked = true;
  return records;
}
