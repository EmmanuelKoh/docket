// lib/ops/device-service.js: the device wire's domain side (/pair, /next,
// /ack, /nack, /tick). Plain functions taking the device caller
// (lib/ops/identity.js), not operations: no tool lists them, and
// defineOperation would put zod on /next's cold start. The routes in app/
// only shape the frozen responses (tests/device-wire.test.ts).
//
// Static imports stay light: /next never loads plugins, zod or the
// renderer. The tick's dependencies (registry, plugins, ctx) load inside
// runDue.
//
// COST RULE (docs/store-costs.md, tests/meter-budget.test.ts): an idle
// /next or /tick reads one Blob flag per owner and touches neither Redis
// nor Postgres. A safety check does the real claim at least once per
// window per warm instance, so a stale or lost flag delays work by at most
// that long. /next reads the queue flag on the safety check too: the
// claim corrects the flag from that read (lib/queue/redis.js).

import { beginPairing, pollPairing } from '../devices.js';
import { recordDeviceSeen } from '../device-presence.js';
import * as jobStore from '../job-store.js';
import { OpError } from './define.js';

const NEXT_SAFETY_MS = 60_000;   // /next trusts the queue flag this long
const TICK_SAFETY_MS = 300_000;  // /tick trusts the tick flag this long
// A claimed plugin must finish (or fail) within this lease; afterwards it
// re-becomes due. Also the retry cadence for failed runs.
const RUN_LEASE_SECONDS = 90;
const HARDWARE_ID = /^[a-zA-Z0-9:_-]{6,64}$/;
const lastQueueCheck = new Map(); // per owner per warm instance
const lastTickCheck = new Map();

/** @typedef {import('./caller.js').Caller} Caller */

function assertDevice(caller) {
  if (caller?.actor.kind !== 'device') throw new OpError('forbidden', 'device token required');
}

// "owner~job-N" as /next hands out; the owner must be one the device
// serves. A bare id (pre-sharing firmware) means the primary owner.
/** @param {{ owners: string[] }} actor @param {string} raw */
export function parseJobRef(actor, raw) {
  const sep = raw.indexOf('~');
  if (sep < 0) return { owner: actor.owners[0], id: raw };
  const owner = raw.slice(0, sep);
  return actor.owners.includes(owner) ? { owner, id: raw.slice(sep + 1) } : null;
}
// null: the job's owner is no longer on this device (they left, were
// removed, or the printer changed hands since /next).
function jobRef(caller, raw) {
  assertDevice(caller);
  if (!raw) throw new OpError('invalid', 'job query parameter is required');
  return parseJobRef(caller.actor, raw);
}
// The answer for such a job: 200 and nothing done. The firmware retries
// any other /ack status forever and prints nothing meanwhile
// (firmware/docket-agent/docket-agent.ino doPoll); the job is not this
// device's to finish. Its own owner's queue still holds it: the lease
// expiry (hosted) or a Requeue puts it back for their printer.
const gone = () => ({ gone: true });

// Unauthenticated by design: an unpaired device has no credentials.
// Authority is the printed code plus a signed-in claimer. Pairing is rare
// and human-present, so it may query Postgres.
//   { hardwareId }        -> { code, ttlSeconds, pollSeconds } to print
//   { hardwareId, code }  -> { token } exactly once after the claim, else null (204)
/** @param {any} body */
export async function pair(body) {
  const hardwareId = typeof body?.hardwareId === 'string' ? body.hardwareId : '';
  if (!HARDWARE_ID.test(hardwareId)) throw new OpError('invalid', 'hardwareId required');
  const code = typeof body?.code === 'string' ? body.code.toUpperCase() : '';
  if (!code) return { ...(await beginPairing(hardwareId)), pollSeconds: 5 };
  return pollPairing(hardwareId, code);
}

// The oldest job across the owners the device serves, in stable order,
// or null. jobRef is owner-qualified because members' ids can collide;
// the firmware echoes it opaquely.
/** @param {Caller | null} caller @returns {Promise<{ jobRef: string, bytes: Buffer } | null>} */
export async function serveNext(caller) {
  assertDevice(caller);
  recordDeviceSeen(caller.ownerId); // one heartbeat per device, primary owner's slot
  for (const owner of caller.actor.owners) {
    const seen = await jobStore.peekQueue(owner); // the flag now: true, false or null (unknown)
    if (seen === false && Date.now() - (lastQueueCheck.get(owner) || 0) < NEXT_SAFETY_MS) continue; // 0 Redis, 0 Postgres
    lastQueueCheck.set(owner, Date.now());
    const job = await jobStore.nextJob(owner, seen);
    if (job) return { jobRef: `${owner}~${job.id}`, bytes: job.bytes };
  }
  return null;
}

/** @param {Caller | null} caller @param {string | null} raw */
export async function ack(caller, raw) {
  const ref = jobRef(caller, raw);
  if (!ref) return gone();
  return { acked: raw, found: await jobStore.ackJob(ref.owner, ref.id) };
}

// Each nack counts a failed attempt; the job store decides where the job
// waits (the front, or the back once it keeps failing).
/** @param {Caller | null} caller @param {string | null} raw */
export async function nack(caller, raw) {
  const ref = jobRef(caller, raw);
  if (!ref) return gone();
  return { requeued: raw, found: await jobStore.nackJob(ref.owner, ref.id) };
}

// Run every due plugin for every owner the device serves, in stable order.
// Registration and template seeding happen on the Slips page view
// (lib/plugin-setup.js), never here: a new owner's plugins activate on
// their first Slips visit.
/** @param {Caller | null} caller @returns {Promise<{ results: Array<{ id: string, status?: string, error?: string }>, idle?: true }>} */
export async function runDue(caller) {
  assertDevice(caller);
  recordDeviceSeen(caller.ownerId); // one heartbeat per device, primary owner's slot
  const registry = await import('../plugin-registry.js');
  const nowMs = Date.now();
  const results = [];

  for (const owner of caller.actor.owners) {
    if (nowMs - (lastTickCheck.get(owner) || 0) < TICK_SAFETY_MS
      && (await registry.peekDue(owner, nowMs)) === false) continue; // idle: 0 Redis, 0 Postgres
    lastTickCheck.set(owner, nowMs);
    const dueIds = await registry.claimDuePlugins(owner, nowMs, RUN_LEASE_SECONDS);
    if (!dueIds.length) {
      // Verified idle: refresh the flag so the cheap path answers next time.
      await registry.syncTickSignal(owner);
      continue;
    }

    const { findModule, isScheduled } = await import('../../plugins/index.js');
    const { makeCtx } = await import('../plugin-context.js');
    for (const id of dueIds) {
      const summary = { id };
      try {
        const record = await registry.getPlugin(owner, id);
        const module = findModule(id);

        if (!record || !module || !isScheduled(module) || !record.enabled) {
          // Orphaned due entry (uninstalled, unscheduled or disabled plugin): drop it.
          if (record) {
            record.nextDueAt = null;
            await registry.upsertPlugin(record, { create: false });
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
          registry.reschedule(record); // next due computed from now: run late, once
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
        await registry.upsertPlugin(record, { create: false });
      } catch (err) {
        // Store failure for this plugin: report it, run the rest.
        summary.status = 'error';
        summary.error = err.message;
      }
      results.push(summary);
    }

    // Reschedules above moved the due-index; let the flag catch up.
    await registry.syncTickSignal(owner);
  }

  return results.length ? { results } : { results: [], idle: true };
}
