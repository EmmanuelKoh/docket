// api/tick.js — POST /tick
// The heartbeat endpoint. Nothing in the system polls on its own timer: the
// ESP32 POSTs here every TICK_MS, and this handler runs whichever plugins
// are due. Requires Authorization: Bearer <DEVICE_TOKEN>.
//
// Scheduling (docs/store-costs.md): every plugin record carries a schedule
// ({ every: seconds } or { at: "HH:MM", timezone }) and a derived nextDueAt
// kept in a sorted due-index by the store layer. An idle tick is ONE store
// command: an atomic claim of everything due, which also bumps claimed
// scores by a lease so concurrent ticks can't double-run a plugin and a
// crashed run re-becomes due after the lease (one late re-run, never a
// silently stopped plugin — plugins keep their own idempotence guards).
//
// Failure policy: a plugin that throws records lastError on its record and
// retries when its claim lease expires (~RUN_LEASE_SECONDS), not at its
// normal schedule — so a 06:30 brief whose calendar fetch failed retries
// within minutes, same day. lastRunAt advances on success and failure.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_ID } from '../config.js';
import { requireDeviceToken } from '../lib/auth.js';
import {
  upsertPlugin, claimDuePlugins, getPlugin, reschedule,
} from '../lib/plugin-registry.js';
import { ensureRegistered } from '../lib/plugin-setup.js';
import { recordDeviceSeen } from '../lib/device-presence.js';
import { createJob } from '../lib/job-store.js';
import { getTemplates, saveTemplate } from '../lib/store.js';
import { PLUGINS } from '../plugins/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_TEMPLATE_FILES = [
  path.join(__dirname, '..', 'reference', 'wc-templates.json'),
  path.join(__dirname, '..', 'reference', 'brief-templates.json'),
  path.join(__dirname, '..', 'reference', 'photo-templates.json'),
  path.join(__dirname, '..', 'reference', 'task-templates.json'),
];

// A claimed plugin must finish (or fail) within this lease; afterwards it
// re-becomes due. Also the retry cadence for failed runs.
const RUN_LEASE_SECONDS = 90;

// ---- seeding ----

// Seed plugin templates into the template store if they don't already
// exist; runs once per process, and only on ticks that run something.
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

  recordDeviceSeen();
  await ensureRegistered();

  const nowMs = Date.now();
  const dueIds = await claimDuePlugins(OWNER_ID, nowMs, RUN_LEASE_SECONDS);
  if (!dueIds.length) {
    return res.status(200).json({ results: [], idle: true });
  }

  await ensureSeedTemplates();
  const results = [];

  for (const id of dueIds) {
    const summary = { id };
    try {
      const record = await getPlugin(OWNER_ID, id);
      const module = PLUGINS.find(m => m.id === id);

      if (!record || !module || module.passive || !record.enabled) {
        // Orphaned due entry (uninstalled/disabled plugin) — drop it.
        if (record) {
          record.nextDueAt = null;
          await upsertPlugin(record, { create: false });
        }
        summary.status = 'dropped';
        results.push(summary);
        continue;
      }

      try {
        const { state } = await module.run({
          config: record.config || {},
          state: record.state || {},
          ctx: makeCtx(id),
        });
        record.state = state;
        record.lastRunAt = new Date().toISOString();
        record.lastError = null;
        record.lastErrorAt = null;
        reschedule(record); // next due computed from now — run late, once
        summary.status = 'ran';
      } catch (err) {
        record.lastRunAt = new Date().toISOString();
        record.lastError = err.message;
        record.lastErrorAt = record.lastRunAt;
        // Keep the claim's retry moment as the visible next-due time.
        record.nextDueAt = nowMs + RUN_LEASE_SECONDS * 1000;
        summary.status = 'error';
        summary.error = err.message;
      }
      await upsertPlugin(record, { create: false });
    } catch (err) {
      // Store failure for this plugin — report it, run the rest.
      summary.status = 'error';
      summary.error = err.message;
    }
    results.push(summary);
  }

  return res.status(200).json({ results });
}
