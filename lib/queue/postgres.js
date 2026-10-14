// lib/queue/postgres.js — the local print queue: the job table itself.
// Rows with status 'queued' are the queue, oldest first; 'inflight' is the
// lease, with no expiry (single-process dev, as the json driver always
// was). There is no flag to maintain, so hint always says "unknown", and
// the record updates for ack, nack and cancel happen in lib/job-store.js,
// which leaves enqueue, done and drop nothing to do.
//
// Failed attempts and back-of-line places are not in the job table (no
// column for them yet): they live in the state store (json files
// locally) as { attempts: { id: n }, back: { id: ms } }. A job sent to the
// back waits behind every job created up to then: back holds the newest
// created_at at that moment, so it is compared on the database's clock,
// not Node's (they differ when DATABASE_URL points at a remote Postgres).
// front clears it.

import { and, asc, count, eq, inArray, max as maxOf, sql } from 'drizzle-orm';
import { job } from '../../db/schema.js';
import { getDb } from '../db.js';
import { getState, setState } from '../state-store.js';

const ofOwner = (ownerId, id) => and(eq(job.ownerId, ownerId), eq(job.id, id));

const STATE = 'queue';
async function readLine(ownerId) {
  const s = (await getState(ownerId, STATE)) || {};
  return { attempts: { ...s.attempts }, back: { ...s.back } };
}
const saveLine = (ownerId, line) => setState(ownerId, STATE, line);

// Mark one queued row inflight, unless another claim took it first.
async function lease(db, ownerId, ids) {
  const rows = await db
    .update(job)
    .set({ status: 'inflight', claimedAt: new Date() })
    .where(and(eq(job.ownerId, ownerId), eq(job.status, 'queued'), inArray(job.id, ids)))
    .returning({ id: job.id });
  return rows[0]?.id ?? null;
}

// Ties fall back to id order, job-9 before job-10, as the SQL claim does.
const byId = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

// Queued rows in the order claims take them: each job at its back-of-line
// moment, else its created_at; a job at the back follows any job created
// at its moment.
async function waitingInOrder(db, ownerId, line) {
  const waiting = await db
    .select({ id: job.id, createdAt: job.createdAt })
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.status, 'queued')));
  const at = r => line.back[r.id] ?? r.createdAt.getTime();
  const isBack = r => (r.id in line.back ? 1 : 0);
  return waiting.sort((a, b) => at(a) - at(b) || isBack(a) - isBack(b) || byId(a.id, b.id));
}

/** @type {import('./index.js').JobQueue} */
export const postgresQueue = {
  driver: 'postgres',

  // One past the highest job-N this owner has.
  async mintId(ownerId) {
    const db = await getDb();
    const rows = await db.select({ id: job.id }).from(job).where(eq(job.ownerId, ownerId));
    let max = 0;
    for (const r of rows) {
      const m = r.id.match(/^job-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `job-${max + 1}`;
  },

  async enqueue() {}, // the inserted row is already 'queued'

  async hint() {
    return null;
  },

  // One statement: mark the oldest queued row inflight and return its id.
  // The outer status check makes a concurrent claim of the same row
  // update nothing instead of handing it out twice. Ties on created_at
  // fall back to id order (job-9 before job-10). With jobs sent to the
  // back, the line is ordered here instead: each job at its back-of-line
  // moment, else its created_at.
  async claim(ownerId) {
    const db = await getDb();
    const line = await readLine(ownerId);
    if (!Object.keys(line.back).length) {
      const oldest = db
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.ownerId, ownerId), eq(job.status, 'queued')))
        .orderBy(asc(job.createdAt), sql`length(${job.id})`, asc(job.id))
        .limit(1);
      return lease(db, ownerId, oldest);
    }
    const waiting = await waitingInOrder(db, ownerId, line);
    const id = waiting.length ? await lease(db, ownerId, [waiting[0].id]) : null;
    if (id && id in line.back) {
      delete line.back[id]; // claimed: a later nack places it afresh
      await saveLine(ownerId, line);
    }
    return id;
  },

  async done() {},

  // The status update in job-store puts the row back in line; this only
  // records or clears a back-of-line place.
  async requeue(ownerId, id, place = 'front') {
    const line = await readLine(ownerId);
    if (place === 'back') {
      const db = await getDb();
      const [{ latest }] = await db
        .select({ latest: maxOf(job.createdAt) })
        .from(job)
        .where(eq(job.ownerId, ownerId));
      line.back[id] = latest ? latest.getTime() : 0;
    } else if (id in line.back) delete line.back[id];
    else return;
    await saveLine(ownerId, line);
  },

  // Reads the row; the caller's status update completes a cancel.
  async withdraw(ownerId, id) {
    const db = await getDb();
    const rows = await db.select({ status: job.status }).from(job).where(ofOwner(ownerId, id)).limit(1);
    const status = rows[0]?.status;
    if (status === 'queued') {
      const line = await readLine(ownerId);
      if (id in line.back) {
        delete line.back[id];
        await saveLine(ownerId, line);
      }
      return 'removed';
    }
    if (status === 'inflight') return 'leased';
    return 'absent';
  },

  async drop() {},

  async countAttempt(ownerId, id) {
    const line = await readLine(ownerId);
    line.attempts[id] = (line.attempts[id] || 0) + 1;
    await saveLine(ownerId, line);
    return line.attempts[id];
  },

  async attempts(ownerId) {
    return (await readLine(ownerId)).attempts;
  },

  async forget(ownerId, ids) {
    const line = await readLine(ownerId);
    const known = ids.filter(id => id in line.attempts || id in line.back);
    if (!known.length) return;
    for (const id of known) {
      delete line.attempts[id];
      delete line.back[id];
    }
    await saveLine(ownerId, line);
  },

  // The claim's order over every queued row (local only: no meter).
  async order(ownerId) {
    const rows = await waitingInOrder(await getDb(), ownerId, await readLine(ownerId));
    return rows.map(r => r.id);
  },

  // One grouped count over the owner's live rows.
  async size(ownerId) {
    const db = await getDb();
    const rows = await db
      .select({ status: job.status, n: count() })
      .from(job)
      .where(and(eq(job.ownerId, ownerId), inArray(job.status, ['queued', 'inflight'])))
      .groupBy(job.status);
    const of = status => rows.find(r => r.status === status)?.n ?? 0;
    return { queued: of('queued'), inflight: of('inflight') };
  },
};
