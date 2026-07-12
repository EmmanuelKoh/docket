// lib/plugin-setup.js — plugin registration, record migration, and plugin
// template seeding. Phase 5 moved all of this OFF the tick path: it runs
// on the dashboard's Slips page view (and is cheap when warm — once per
// owner per process). A brand-new owner's plugins therefore activate on
// their first Slips visit; until then the owner has no due-index entries
// and their device's ticks are pure no-ops.
//
// Ensures every installed plugin module has a registry record with a
// schedule and a due-index entry, and migrates records created before
// schedules existed: intervalSeconds becomes { every }, and morning-brief's
// printAt/timezone config becomes its { at } schedule.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WATCH_TEAMS } from '../config.js';
import {
  getPluginConfig,
  listPlugins,
  reschedule,
  savePluginConfig,
  syncTickSignal,
  upsertPlugin,
} from './plugin-registry.js';
import { getState } from './state-store.js';
import { getTemplates, saveTemplate } from './store.js';
import { PLUGINS } from '../plugins/index.js';

// Plugin template seeds (only-if-missing, per owner) — moved here from
// /tick so the device cadence never pays for them.
const SEED_TEMPLATE_FILES = [
  path.join(process.cwd(), 'reference', 'wc-templates.json'),
  path.join(process.cwd(), 'reference', 'brief-templates.json'),
  path.join(process.cwd(), 'reference', 'photo-templates.json'),
  path.join(process.cwd(), 'reference', 'task-templates.json'),
];

async function ensureSeedTemplates(ownerId) {
  const existing = await getTemplates(ownerId);
  for (const file of SEED_TEMPLATE_FILES) {
    const toSeed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const t of toSeed) {
      if (existing.some(e => e.name === t.name)) continue;
      await saveTemplate(ownerId, t);
      console.log(`  seeded template "${t.name}"`);
    }
  }
}

const checked = new Set();

// Returns the current records (post-registration/migration). Cheap when
// warm: one listPlugins per owner per process, then reuses nothing —
// callers that need records fetch their own.
export async function ensureRegistered(ownerId, { force = false } = {}) {
  const records = await listPlugins(ownerId);
  if (checked.has(ownerId) && !force) return records;

  for (const module of PLUGINS) {
    const existing = records.find(r => r.id === module.id);

    if (!existing) {
      const config = { ...(module.defaults.config || {}) };
      let state = {};
      if (module.id === 'espn-worldcup') {
        // First registration imports the retired poller's state so nothing
        // already printed reprints, and watchTeams from WATCH_TEAMS.
        state = (await getState(ownerId, 'espn')) || {};
        if (WATCH_TEAMS.length) config.watchTeams = WATCH_TEAMS;
      }
      const record = {
        id: module.id,
        ownerId,
        enabled: module.defaults.enabled !== false,
        schedule: module.passive ? null : { ...(module.defaults.schedule || {}) },
        nextDueAt: null,
        lastRunAt: null,
        config,
        state,
        lastError: null,
        lastErrorAt: null,
      };
      // If Postgres holds config truth for this plugin (the driver store
      // was reset — fresh Redis, wiped data/), restore the settings; only
      // the runtime state is genuinely gone.
      const truth = await getPluginConfig(ownerId, module.id);
      if (truth) {
        record.enabled = truth.enabled;
        record.schedule = truth.schedule ?? record.schedule;
        record.config = truth.config ?? record.config;
      }
      // message-ingest gets a per-owner ingest token: /ingest resolves the
      // sender to an owner by this value (see app/ingest/route.ts).
      if (module.id === 'message-ingest' && !record.config.ingestToken) {
        record.config.ingestToken = crypto.randomBytes(16).toString('base64url');
      }
      if (!module.passive) reschedule(record);
      await upsertPlugin(record);
      await savePluginConfig(record);
      records.push(record);
      console.log(`  registered plugin "${module.id}"`);
      continue;
    }

    // Existing message-ingest records predate per-owner tokens: mint one.
    if (module.id === 'message-ingest' && !existing.config?.ingestToken) {
      existing.config = {
        ...existing.config,
        ingestToken: crypto.randomBytes(16).toString('base64url'),
      };
      await upsertPlugin(existing, { create: false });
      await savePluginConfig(existing);
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

  await ensureSeedTemplates(ownerId);
  await syncTickSignal(ownerId);
  checked.add(ownerId);
  return records;
}
