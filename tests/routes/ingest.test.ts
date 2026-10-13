// tests/routes/ingest.test.ts — what POST /ingest parses before
// messages.deliver sees it: the ingest token as a Bearer header or
// ?token=, a 401 for a missing or wrong one, and blank text answering 200
// so the phone forwarder never stalls on it. Then the statuses of the
// duplicate guard: 409 while the same message is being handled, 200
// { duplicate: true } once it was.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/ingest/route';
import { generateObject } from '@/lib/llm/index.js';
import { getPlugin } from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-ingest`;
});

vi.mock('@/lib/llm/index.js', () => ({ generateObject: vi.fn() }));
const llm = vi.mocked(generateObject);

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // No classifier: a "task:" message prints anyway.
  llm.mockRejectedValue(new Error('no classifier'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let token = '';

beforeAll(async () => {
  const owner = `owner-${randomUUID()}`;
  await ensureRegistered(owner);
  token = (await getPlugin(owner, 'message-ingest'))?.config.ingestToken;
});

async function ingest(
  body: unknown,
  { bearer, query }: { bearer?: string; query?: string } = {},
) {
  const url = `http://docket.test/ingest${query === undefined ? '' : `?token=${encodeURIComponent(query)}`}`;
  const res = await POST(
    new Request(url, {
      method: 'POST',
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const unauthorized = {
  status: 401,
  body: { error: 'missing or invalid ingest token' },
};

describe('POST /ingest', () => {
  it('answers 401 without a token or with a wrong one', async () => {
    expect(token).toEqual(expect.any(String));
    expect(await ingest({ text: 'hi' })).toEqual(unauthorized);
    expect(await ingest({ text: 'hi' }, { bearer: 'nope' })).toEqual(
      unauthorized,
    );
    expect(await ingest({ text: 'hi' }, { query: 'nope' })).toEqual(
      unauthorized,
    );
  });

  it('takes the token as Bearer and as ?token=; blank text answers 200 skipped: empty', async () => {
    const skipped = { status: 200, body: { skipped: 'empty' } };
    expect(await ingest({ text: '   ' }, { bearer: token })).toEqual(skipped);
    expect(await ingest({ text: '' }, { query: token })).toEqual(skipped);
  });

  it('answers 400 when text is missing or not a string', async () => {
    const missing = { status: 400, body: { error: 'text is required' } };
    expect(await ingest({ sender: 'Alice' }, { bearer: token })).toEqual(
      missing,
    );
    expect(await ingest({ text: 42 }, { bearer: token })).toEqual(missing);
    expect(await ingest('not json object', { bearer: token })).toEqual(missing);
  });

  it('answers 409 while the same message is being handled, then 200 duplicate: true', async () => {
    const msg = { text: 'task: post the parcel', sender: 'Alice' };
    let finish: (v: unknown) => void = () => {};
    llm.mockClear();
    llm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const first = ingest(msg, { bearer: token });
    await vi.waitFor(() => expect(llm).toHaveBeenCalledTimes(1));
    expect(await ingest(msg, { bearer: token })).toEqual({
      status: 409,
      body: { error: 'this message is already being handled' },
    });
    finish({ is_task: false, confidence: 0, tasks: [] });
    expect(await first).toMatchObject({
      status: 200,
      body: { task: true, printed: 1 },
    });
    expect(await ingest(msg, { query: token })).toEqual({
      status: 200,
      body: { duplicate: true },
    });
  });
});
