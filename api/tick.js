// api/tick.js — POST /tick
// The heartbeat endpoint that replaces standalone pollers. Nothing in the
// system polls on its own timer: a heartbeat (agent/heartbeat.js now, an
// ESP32 later) POSTs here, and this handler runs whichever registered
// plugins are enabled and due (now - lastRunAt >= intervalSeconds).
//
// Per plugin: sequential execution, a Redis-backed run lock as an overlap
// guard (a tick arriving while a plugin is still mid-run skips it), and
// error isolation — a failing plugin records lastError/lastErrorAt on its
// registry record and never stops the others. lastRunAt advances on both
// success and failure so a broken plugin retries at its own interval, not
// at heartbeat rate.
//
// Requires Authorization: Bearer <DEVICE_TOKEN>, like all device-facing
// endpoints.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_ID, WATCH_TEAMS } from '../config.js';
import { requireDeviceToken } from '../lib/auth.js';
import {
  getPlugin, upsertPlugin, tryAcquireRunLock, releaseRunLock,
} from '../lib/plugin-registry.js';
import { createJob } from '../lib/job-store.js';
import { getTemplates, saveTemplate } from '../lib/store.js';
import { getState, setState } from '../lib/state-store.js';
import { PLUGINS } from '../plugins/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_TEMPLATE_FILES = [
  path.join(__dirname, '..', 'reference', 'wc-templates.json'),
  path.join(__dirname, '..', 'reference', 'brief-templates.json'),
  path.join(__dirname, '..', 'reference', 'photo-templates.json'),
  path.join(__dirname, '..', 'reference', 'task-templates.json'),
];

// Generous upper bound on one poll cycle; the lock expiry means a crashed
// run can never wedge a plugin permanently (same idea as the job lease).
const RUN_LOCK_SECONDS = 60;

// ---- seeding ----

// Seed plugin templates into the template store if they don't already
// exist (WC templates + Daily Brief); runs once per process.
let templatesEnsured = false;
async function ensureSeedTemplates() {
  if (templatesEnsured) return;
  const existing = await getTemplates();
  for (const file of SEED_TEMPLATE_FILES) {
    const toSeed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const t of toSeed) {
      if (existing.some(e => e.name === t.name)) continue;
      await saveTemplate(t);
      console.log(`  seeded template "${t.name}"`);
    }
  }
  templatesEnsured = true;
}

// Ensure a registry record exists for a plugin module. First registration of
// espn-worldcup imports the retired poller's state (state-store key 'espn')
// so nothing already printed reprints, and its watchTeams from WATCH_TEAMS.
async function ensureRecord(module) {
  const existing = await getPlugin(OWNER_ID, module.id);
  if (existing) return existing;

  const config = { ...module.defaults.config };
  let state = {};
  if (module.id === 'espn-worldcup') {
    state = (await getState('espn')) || {};
    if (WATCH_TEAMS.length) config.watchTeams = WATCH_TEAMS;
  }

  const record = {
    id: module.id,
    ownerId: OWNER_ID,
    // a plugin may declare it needs configuration before it can run
    enabled: module.defaults.enabled !== false,
    intervalSeconds: module.defaults.intervalSeconds,
    lastRunAt: null,
    config,
    state,
    lastError: null,
    lastErrorAt: null,
  };
  await upsertPlugin(record);
  console.log(`  registered plugin "${module.id}" (every ${record.intervalSeconds}s)`);
  return record;
}

// ---- plugin context ----

// The only surface plugins get. No stores, no HTTP routes, no files.
function makeCtx(pluginId) {
  return {
    createJob: ({ template, data, name }) =>
      createJob({ template, data, name, source: pluginId }),
    getTemplate: async name => {
      const templates = await getTemplates();
      return templates.find(t => t.name === name) || null;
    },
    log: msg => console.log(`  [${pluginId}] ${msg}`),
  };
}

// ---- handler ----

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  if (!requireDeviceToken(req, res)) return;

  // Record device contact for the dashboard's "printer online" line.
  await setState('device', { lastSeenAt: new Date().toISOString() }).catch(() => {});

  const results = [];

  for (const module of PLUGINS) {
    const summary = { id: module.id };
    try {
      await ensureSeedTemplates();
      const record = await ensureRecord(module);

      if (!record.enabled) {
        summary.status = 'disabled';
        results.push(summary);
        continue;
      }

      const intervalMs = (record.intervalSeconds || module.defaults.intervalSeconds) * 1000;
      const lastRun = record.lastRunAt ? Date.parse(record.lastRunAt) : 0;
      if (Date.now() - lastRun < intervalMs) {
        summary.status = 'not-due';
        results.push(summary);
        continue;
      }

      if (!(await tryAcquireRunLock(OWNER_ID, module.id, RUN_LOCK_SECONDS))) {
        summary.status = 'running';
        results.push(summary);
        continue;
      }

      try {
        const { state } = await module.run({
          config: record.config || {},
          state: record.state || {},
          ctx: makeCtx(module.id),
        });
        record.state = state;
        record.lastRunAt = new Date().toISOString();
        record.lastError = null;
        record.lastErrorAt = null;
        await upsertPlugin(record);
        summary.status = 'ran';
      } catch (err) {
        record.lastRunAt = new Date().toISOString();
        record.lastError = err.message;
        record.lastErrorAt = record.lastRunAt;
        await upsertPlugin(record);
        summary.status = 'error';
        summary.error = err.message;
      } finally {
        await releaseRunLock(OWNER_ID, module.id);
      }
    } catch (err) {
      // Registry/seeding failure for this plugin — report it, run the rest.
      summary.status = 'error';
      summary.error = err.message;
    }
    results.push(summary);
  }

  return res.status(200).json({ results });
}
