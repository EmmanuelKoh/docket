// app/tick/route.ts — POST /tick
// The heartbeat endpoint. Nothing in the system polls on its own timer:
// each paired device POSTs here every TICK_MS, and this handler runs
// whichever of ITS OWNER'S plugins are due (docs/store-costs.md has the
// cost math).
//
// Cost shape (phase 5): the per-owner tick flag in Blob holds the
// owner's earliest nextDueAt, so an idle tick — the overwhelmingly
// common case — reads one cheap blob and touches NEITHER Redis NOR
// Postgres. Registration and template seeding moved to the dashboard's
// Slips page (lib/plugin-setup.js): a brand-new owner's plugins activate
// on their first Slips visit. A safety valve does the real Redis claim
// at least once per SAFETY_CHECK_MS per warm instance, bounding the
// damage of a stale/lost flag.

import { STORE_DRIVER } from '@/config.js';
import { readTickSignal, signalsConfigured } from '@/lib/change-signal.js';
import { recordDeviceSeen } from '@/lib/device-presence.js';
import { createJob } from '@/lib/job-store.js';
import {
  claimDuePlugins,
  getPlugin,
  reschedule,
  syncTickSignal,
  upsertPlugin,
} from '@/lib/plugin-registry.js';
import { getTemplates } from '@/lib/store.js';
import { PLUGINS } from '@/plugins/index.js';
import { deviceAuth, unauthorized } from '../_lib/device-auth';

export const maxDuration = 60;

// A claimed plugin must finish (or fail) within this lease; afterwards it
// re-becomes due. Also the retry cadence for failed runs.
const RUN_LEASE_SECONDS = 90;

// Trust the tick flag for at most this long before doing a real claim
// anyway — a lost flag write delays a plugin run by at most this much.
const SAFETY_CHECK_MS = 300_000;
const lastRealCheckAt = new Map<string, number>(); // per owner per warm instance

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
function makeCtx(ownerId: string, pluginId: string) {
  return {
    createJob: ({
      template,
      data,
      name,
    }: {
      template: string;
      data: unknown;
      name: string;
    }) => createJob(ownerId, { template, data, name, source: pluginId }),
    getTemplate: async (name: string) => {
      const templates = await getTemplates(ownerId);
      return templates.find((t: { name: string }) => t.name === name) || null;
    },
    log: (msg: string) => console.log(`  [${pluginId}] ${msg}`),
  };
}

// ---- handler ----

export async function POST(req: Request) {
  const dev = await deviceAuth(req);
  if (!dev) return unauthorized();
  const owner = dev.ownerId;

  recordDeviceSeen(owner);

  const nowMs = Date.now();

  // Idle short-circuit: when the flag is fresh and says nothing is due,
  // this tick costs zero store commands. The flag only guards the metered
  // store; the json driver (local dev) is free to query directly.
  if (
    STORE_DRIVER === 'redis' &&
    signalsConfigured() &&
    nowMs - (lastRealCheckAt.get(owner) || 0) < SAFETY_CHECK_MS
  ) {
    const flag = await readTickSignal(owner);
    if (flag && (flag.nextDueAt === null || flag.nextDueAt > nowMs)) {
      return Response.json({ results: [], idle: true });
    }
    // due, unknown, or missing flag: fall through to the real claim
  }

  lastRealCheckAt.set(owner, nowMs);
  const dueIds = await claimDuePlugins(owner, nowMs, RUN_LEASE_SECONDS);
  if (!dueIds.length) {
    // Verified-idle: refresh the flag so the cheap path answers next time.
    await syncTickSignal(owner);
    return Response.json({ results: [], idle: true });
  }

  const results = [];

  for (const id of dueIds) {
    const summary: { id: string; status?: string; error?: string } = { id };
    try {
      const record = await getPlugin(owner, id);
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
          ctx: makeCtx(owner, id),
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

  // Reschedules above moved the due-index; let the flag catch up.
  await syncTickSignal(owner);

  return Response.json({ results });
}
