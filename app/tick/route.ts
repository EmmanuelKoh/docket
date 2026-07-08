// app/tick/route.ts — POST /tick
// The heartbeat endpoint, ported from api/tick.js. Nothing in the system
// polls on its own timer: the ESP32 POSTs here every TICK_MS, and this
// handler runs whichever plugins are due. See api/tick.js for the full
// scheduling and failure-policy commentary (docs/store-costs.md has the
// cost math); the logic here is a line-for-line port onto the web
// Request/Response API.

import fs from 'node:fs';
import path from 'node:path';
import { OWNER_ID } from '@/config.js';
import { recordDeviceSeen } from '@/lib/device-presence.js';
import { createJob } from '@/lib/job-store.js';
import {
  claimDuePlugins,
  getPlugin,
  reschedule,
  upsertPlugin,
} from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';
import { getTemplates, saveTemplate } from '@/lib/store.js';
import { PLUGINS } from '@/plugins/index.js';
import { deviceAuthorized, unauthorized } from '../_lib/device-auth';

export const maxDuration = 60;

const SEED_TEMPLATE_FILES = [
  path.join(process.cwd(), 'reference', 'wc-templates.json'),
  path.join(process.cwd(), 'reference', 'brief-templates.json'),
  path.join(process.cwd(), 'reference', 'photo-templates.json'),
  path.join(process.cwd(), 'reference', 'task-templates.json'),
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
      if (existing.some((e: { name: string }) => e.name === t.name)) continue;
      await saveTemplate(t);
      console.log(`  seeded template "${t.name}"`);
    }
  }
  templatesEnsured = true;
}

// ---- plugin context ----

// Shape of a plugins/*.js module as used here. Optional fields (passive,
// schedule) are only exported by the plugins that need them.
type PluginModule = {
  id: string;
  passive?: boolean;
  run: (args: {
    config: Record<string, unknown>;
    state: Record<string, unknown>;
    ctx: ReturnType<typeof makeCtx>;
  }) => Promise<{ state: Record<string, unknown> }>;
};

// The only surface plugins get. No stores, no HTTP routes, no files.
function makeCtx(pluginId: string) {
  return {
    createJob: ({
      template,
      data,
      name,
    }: {
      template: string;
      data: unknown;
      name: string;
    }) => createJob({ template, data, name, source: pluginId }),
    getTemplate: async (name: string) => {
      const templates = await getTemplates();
      return templates.find((t: { name: string }) => t.name === name) || null;
    },
    log: (msg: string) => console.log(`  [${pluginId}] ${msg}`),
  };
}

// ---- handler ----

export async function POST(req: Request) {
  if (!deviceAuthorized(req)) return unauthorized();

  recordDeviceSeen();
  await ensureRegistered();

  const nowMs = Date.now();
  const dueIds = await claimDuePlugins(OWNER_ID, nowMs, RUN_LEASE_SECONDS);
  if (!dueIds.length) {
    return Response.json({ results: [], idle: true });
  }

  await ensureSeedTemplates();
  const results = [];

  for (const id of dueIds) {
    const summary: { id: string; status?: string; error?: string } = { id };
    try {
      const record = await getPlugin(OWNER_ID, id);
      const module = (PLUGINS as PluginModule[]).find((m) => m.id === id);

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
        record.lastError = (err as Error).message;
        record.lastErrorAt = record.lastRunAt;
        // Keep the claim's retry moment as the visible next-due time.
        record.nextDueAt = nowMs + RUN_LEASE_SECONDS * 1000;
        summary.status = 'error';
        summary.error = (err as Error).message;
      }
      await upsertPlugin(record, { create: false });
    } catch (err) {
      // Store failure for this plugin — report it, run the rest.
      summary.status = 'error';
      summary.error = (err as Error).message;
    }
    results.push(summary);
  }

  return Response.json({ results });
}
