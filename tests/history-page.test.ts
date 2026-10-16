// tests/history-page.test.ts — a History record's rubber stamp names how
// the job ended. done is PRINTED, canceled is CANCELED, failed is FAILED,
// and only FAILED is marked as a failure (the kit's red fail stamp). The
// deck holds the current filter key down and keeps Reprint off until a
// record that can print again is open.

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { historyStamp } from '@/app/_lib/format';
import { HistoryList, type HistoryRow } from '@/components/history-list';
import { HistoryView, type HistoryViewProps } from '@/components/history-view';
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
// The page reads the viewer's time zone from a cookie; no request here.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

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
  it('map status to stamp: done printed, canceled canceled, failed failed', () => {
    expect(historyStamp('done')).toBe('printed');
    expect(historyStamp('canceled')).toBe('canceled');
    expect(historyStamp('failed')).toBe('failed');
    expect(historyStamp('queued')).toBeNull();
  });

  it('each row prints its stamp, marked as a failure only when it failed', () => {
    const row = (name: string, status: string): HistoryRow => ({
      id: `job-${name}`,
      image: '/api/jobs/png?job=x',
      width: 576,
      height: 100,
      name,
      source: 'Studio',
      time: '17:30',
      stamp: historyStamp(status),
      attempts: '',
      reprintable: true,
    });
    const html = (status: string) =>
      renderToStaticMarkup(
        createElement(HistoryList, { rows: [row(status, status)] }),
      );
    const stamp = (markup: string) =>
      markup
        .match(/<span[^>]* class="(hw-stamp[^"]*)"[^>]*>([^<]*)</)
        ?.slice(1);
    const [printedClass, printedText] = stamp(html('done')) ?? [];
    const [canceledClass, canceledText] = stamp(html('canceled')) ?? [];
    const [failedClass, failedText] = stamp(html('failed')) ?? [];
    expect(printedText).toBe('Printed');
    expect(canceledText).toBe('Canceled');
    expect(failedText).toBe('Failed');
    expect(printedClass).not.toContain('hw-stamp--fail');
    expect(canceledClass).not.toContain('hw-stamp--fail');
    expect(canceledClass).toContain('hw-stamp--void');
    expect(failedClass).toContain('hw-stamp--fail');
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
    const page = (await HistoryPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<HistoryViewProps>;
    expect(page.type).toBe(HistoryView);
    expect(page.props.count).toBe(3);
    // one sheet per day
    const rows = page.props.days.flatMap((day) => day.rows);
    const stamps = Object.fromEntries(rows.map((r) => [r.name, r.stamp]));
    expect(stamps).toEqual({
      printed: 'printed',
      canceled: 'canceled',
      failed: 'failed',
    });
  });

  it('the deck holds the current filter down and Reprint stays off until a record opens', () => {
    const html = renderToStaticMarkup(
      createElement(HistoryView, {
        count: 3,
        filters: [
          { label: 'All', href: '/history', current: false },
          { label: 'Failed', href: '/history?filter=failed', current: true },
        ],
        lamp: { state: 'online', text: 'Online' },
        days: [],
        empty: { title: 'Failed', text: 'No failed jobs.' },
        pager: null,
      }),
    );
    expect(html).toMatch(
      /<a[^>]*aria-current="true"[^>]*href="\/history\?filter=failed"[^>]*>/,
    );
    expect(html).not.toMatch(/<a[^>]*aria-current[^>]*href="\/history"/);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*class="pk-key pk-key--print"[^>]*><span class="pk-key-legend">Reprint</,
    );
    expect(html).toContain('3 receipts');
    expect(html).toContain('No failed jobs.');
  });
});
