// tests/history-page.test.ts — a History record's rubber stamp names how
// the job ended. done is PRINTED, canceled is CANCELED, failed is FAILED,
// and only FAILED is red.

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { historyStamp } from '@/app/_lib/format';
import {
  HistoryList,
  type HistoryRow,
  HistoryStamp,
} from '@/components/history-list';
import { job } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import * as jobStore from '@/lib/job-store.js';
import { type Caller, userCaller } from '@/lib/ops/caller.js';
import { jobsCancel, jobsCreateRaw } from '@/lib/ops/jobs.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/history-page`;
});

// The page reads the session through getCaller; here it is whoever the
// test says.
const session = vi.hoisted(() => ({ caller: null as Caller | null }));
vi.mock('@/app/_lib/caller', () => ({
  getCaller: async () => session.caller,
  requestCaller: async () => session.caller,
}));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Depth-first search of a React element tree for elements of `type`.
function findAll(node: unknown, type: unknown, out: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, type, out);
  } else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    for (const v of Object.values(node.props as object)) findAll(v, type, out);
  }
  return out;
}

async function rawJob(caller: Caller, name: string) {
  const { id } = await jobsCreateRaw(caller, {
    bytes: Buffer.from([0x1b, 0x40, 0x0a]).toString('base64'),
    png: Buffer.from('png').toString('base64'),
    width: 576,
    height: 1,
    name,
    source: 'test',
  });
  return id;
}

describe('History stamps', () => {
  it('map status to stamp: done PRINTED, canceled CANCELED, failed FAILED (red)', () => {
    expect(historyStamp('done')).toEqual({ text: 'PRINTED', red: false });
    expect(historyStamp('canceled')).toEqual({ text: 'CANCELED', red: false });
    expect(historyStamp('failed')).toEqual({ text: 'FAILED', red: true });
  });

  it('the stamp prints its text, in red only for a failure', () => {
    const html = (status: string) =>
      renderToStaticMarkup(
        createElement(HistoryStamp, { stamp: historyStamp(status) }),
      );
    expect(html('done')).toMatch(/^<span class="stamp bite [^"]*">PRINTED</);
    expect(html('canceled')).toMatch(/>CANCELED</);
    expect(html('done')).not.toContain('stamp-red');
    expect(html('canceled')).not.toContain('stamp-red');
    expect(html('failed')).toMatch(/class="[^"]*stamp-red[^"]*">FAILED</);
  });

  it('the History page stamps each row by its status', async () => {
    const caller = userCaller({
      userId: `owner-${randomUUID()}`,
      role: 'user',
    });
    const owner = caller.ownerId as string;
    session.caller = caller;

    const printed = await rawJob(caller, 'printed');
    const canceled = await rawJob(caller, 'canceled');
    const failed = await rawJob(caller, 'failed');
    expect(await jobStore.nextJob(owner)).toMatchObject({ id: printed });
    expect(await jobStore.ackJob(owner, printed)).toBe(true);
    expect(await jobsCancel(caller, { id: canceled })).toEqual({
      canceled: true,
    });
    // Nothing marks a job failed today; older rows may say so.
    const db = await getDb();
    await db
      .update(job)
      .set({ status: 'failed' })
      .where(and(eq(job.ownerId, owner), eq(job.id, failed)));

    const { default: HistoryPage } = await import(
      '@/app/(dashboard)/history/page'
    );
    const page = await HistoryPage({ searchParams: Promise.resolve({}) });
    const [list] = findAll(page, HistoryList);
    const rows = (list.props as { rows: HistoryRow[] }).rows;
    const stamps = Object.fromEntries(rows.map((r) => [r.name, r.stamp]));
    expect(stamps).toEqual({
      printed: { text: 'PRINTED', red: false },
      canceled: { text: 'CANCELED', red: false },
      failed: { text: 'FAILED', red: true },
    });
  });
});
