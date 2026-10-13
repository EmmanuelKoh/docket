// tests/routes/adapters.test.ts — the dashboard adapter path: a route
// resolves the session to a Caller (app/_lib/caller.ts), calls an op, and
// app/_lib/http.ts maps the result or the OpError to an HTTP response.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { tokenCaller } from '@/lib/ops/caller.js';
import { defineOperation, OpError } from '@/lib/ops/define.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-adapters`;
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const lookup = defineOperation({
  name: 'test.lookup',
  description: 'look up a job by id',
  input: z.object({
    id: z.string({ error: 'job query parameter is required' }),
  }),
  permission: 'owner',
  effects: ['db.read'],
  run: async (caller, { id }) => {
    if (id === 'missing') throw new OpError('not_found', 'job not found');
    if (id === 'broken') throw new Error('store exploded');
    return { id, ownerId: caller.ownerId };
  },
});

// The shape every dashboard route takes (CONTRIBUTING.md has the recipe).
async function POST(req: Request) {
  const caller = await requestCaller(req);
  const id = new URL(req.url).searchParams.get('job');
  return json(() => lookup(caller, { id } as { id: string }));
}

function request(query: string, user?: string) {
  const headers: Record<string, string> = {};
  if (user) headers['x-test-user'] = user;
  return new Request(`http://docket.test/api/test${query}`, {
    method: 'POST',
    headers,
  });
}

async function call(query: string, user?: string) {
  const res = await POST(request(query, user));
  return { status: res.status, body: await res.json() };
}

const owner = `owner-${randomUUID()}`;

it('answers 200 with the op result', async () => {
  expect(await call('?job=job-1', `${owner}:user`)).toEqual({
    status: 200,
    body: { id: 'job-1', ownerId: owner },
  });
});

it('answers 401 without a session', async () => {
  expect(await call('?job=job-1')).toEqual({
    status: 401,
    body: { error: 'sign in required' },
  });
});

it('answers 400 with the Zod message', async () => {
  expect(await call('', `${owner}:user`)).toEqual({
    status: 400,
    body: { error: 'job query parameter is required' },
  });
});

it('answers 404 for not_found', async () => {
  expect(await call('?job=missing', `${owner}:user`)).toEqual({
    status: 404,
    body: { error: 'job not found' },
  });
});

it('answers 500 for a plain Error', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await call('?job=broken', `${owner}:admin`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'store exploded' });
    expect(logged).toHaveBeenCalledOnce();
  } finally {
    logged.mockRestore();
  }
});

it('answers 403 for a caller the op refuses', async () => {
  // A credential granted some other op only.
  const caller = tokenCaller(owner, 'message-ingest:ingestToken', [
    'messages.deliver',
  ]);
  const res = await json(() => lookup(caller, { id: 'job-1' }));
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'not allowed' });
});

it('answers the status a route passes for success', async () => {
  const res = await json(async () => ({ id: 'job-1' }), 201);
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ id: 'job-1' });
});

it('answers 200 null when the op returns nothing', async () => {
  const res = await json(async () => undefined);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('null');
});
