// tests/lazy-render.test.ts — the renderer (Satori, resvg, fonts) loads
// only inside the code paths that render. /next, /ack and Tape prints
// import lib/job-store.js and must not pay for it on a cold start. With
// render-core mocked to throw on load, any static import of it from the
// job store or an ops module fails this file at import time.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/lazy-render`;
});

vi.mock('@/render/render-core.js', () => {
  throw new Error('render-core loaded');
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const OPS_DIR = path.resolve(__dirname, '../lib/ops');

it('loads lib/job-store.js and every lib/ops module without the renderer', async () => {
  await expect(import('@/lib/job-store.js')).resolves.toBeDefined();
  // Every file, so a new ops module is covered without editing this test.
  const files = fs.readdirSync(OPS_DIR).filter((f) => /\.(m?js|ts)$/.test(f));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    await expect(import(path.join(OPS_DIR, f)), f).resolves.toBeDefined();
  }
});

it('creates, serves and acks a raw job without the renderer', async () => {
  const { ackJob, createRawJob, nextJob } = await import('@/lib/job-store.js');
  const owner = `owner-${randomUUID()}`;
  const bytes = Buffer.from([0x1b, 0x40, 0x0a]);
  const { id } = await createRawJob(owner, {
    name: 'raw',
    source: 'test',
    bytes,
    png: Buffer.from('png'),
    width: 576,
    height: 1,
  });
  const served = await nextJob(owner);
  expect(served?.id).toBe(id);
  expect(served?.bytes.equals(bytes)).toBe(true);
  expect(await ackJob(owner, id)).toBe(true);
});

it('still reaches the renderer when a job is rendered (the mock is live)', async () => {
  const { createJob } = await import('@/lib/job-store.js');
  const err = await createJob(`owner-${randomUUID()}`, {
    template: '<div>x</div>',
    data: {},
  }).catch((e: Error) => e);
  // vitest wraps a throwing mock factory; the factory's error is the cause.
  expect(String((err as Error)?.cause)).toContain('render-core loaded');
});
