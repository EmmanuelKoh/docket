// tests/ops/messages.test.ts — messages.deliver (lib/ops/messages.js) with
// message-ingest's onMessage: the forced "task:" rule, the confidence gate,
// the off switch and blank text, a classifier failure recorded on the
// record, a record the driver store lost, the token scope, a handler
// that returns no reply (still answered as JSON), and the duplicate guard
// (a resent message prints once; a copy that arrives mid-delivery gets
// conflict; a failure releases the claim; a delivery that never finishes
// holds it for 90 seconds; a handled one for 15 minutes).
// The LLM seam is mocked; the rest runs on the json driver and an
// in-memory PGlite.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DATA_DIR } from '@/config.js';
import { listJobs } from '@/lib/job-store.js';
import { generateObject } from '@/lib/llm/index.js';
import { tokenCaller } from '@/lib/ops/caller.js';
import { messagesDeliver } from '@/lib/ops/messages.js';
import { getPlugin, setEnabled, upsertPlugin } from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';
import { onMessage } from '@/plugins/message-ingest.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-messages`;
});

vi.mock('@/lib/llm/index.js', () => ({ generateObject: vi.fn() }));
// The real module with every export spied (calls go through), so one
// test can make onMessage return no reply.
vi.mock('@/plugins/message-ingest.js', { spy: true });

const llm = vi.mocked(generateObject);
const MODULE = 'message-ingest';

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A registered owner (as after a Slips visit) and their ingest-token caller.
async function setup() {
  const owner = `owner-${randomUUID()}`;
  await ensureRegistered(owner);
  const caller = tokenCaller(owner, `${MODULE}:ingestToken`, [
    'messages.deliver',
  ]);
  const deliver = (envelope: Record<string, unknown>) =>
    messagesDeliver(caller, {
      moduleId: MODULE,
      envelope: envelope as { text: string },
    });
  return { owner, caller, deliver };
}

const record = (owner: string) => getPlugin(owner, MODULE);

describe('messages.deliver to message-ingest', () => {
  it('a forced task: message prints one job while the LLM throws', async () => {
    const { owner, deliver } = await setup();
    llm.mockRejectedValue(new Error('Gemini 503: unavailable'));

    const reply = await deliver({ text: 'task: call the plumber' });

    expect(reply).toEqual({
      task: true,
      printed: 1,
      jobs: [{ id: expect.any(String), title: 'call the plumber' }],
    });
    const jobs = await listJobs(owner);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'Task: call the plumber',
      source: 'sms',
      kind: 'template',
    });
    expect((await record(owner))?.lastError).toBeNull();
  });

  it('a verdict below minConfidence answers task: false and clears lastError', async () => {
    const { owner, deliver } = await setup();
    const before = await record(owner);
    await upsertPlugin({ ...before, lastError: 'old failure' });
    llm.mockResolvedValue({
      is_task: true,
      confidence: 0.3,
      tasks: [{ title: 'Maybe call Bob' }],
    });

    expect(await deliver({ text: 'call bob sometime?' })).toEqual({
      task: false,
      confidence: 0.3,
    });
    const after = await record(owner);
    expect(after?.lastError).toBeNull();
    expect(after?.lastRunAt).toEqual(expect.any(String));
    expect(await listJobs(owner)).toEqual([]);
  });

  it('a disabled record answers skipped: disabled; blank text answers skipped: empty', async () => {
    const { owner, deliver } = await setup();
    llm.mockClear();

    expect(await deliver({ text: ' \n\t ' })).toEqual({ skipped: 'empty' });
    await setEnabled(owner, MODULE, false);
    expect(await deliver({ text: 'task: anything' })).toEqual({
      skipped: 'disabled',
    });
    expect(llm).not.toHaveBeenCalled();
    expect(await listJobs(owner)).toEqual([]);
  });

  it('an LLM failure without task: raises unavailable and records lastError', async () => {
    const { owner, deliver } = await setup();
    llm.mockRejectedValue(new Error('Gemini 429: quota exceeded'));

    await expect(deliver({ text: 'pick up milk' })).rejects.toMatchObject({
      name: 'OpError',
      code: 'unavailable',
    });
    const after = await record(owner);
    expect(after?.lastError).toBe('Gemini 429: quota exceeded');
    expect(after?.lastErrorAt).toEqual(expect.any(String));
    expect(await listJobs(owner)).toEqual([]);
  });

  it('restores a record the driver store lost, with the same ingestToken', async () => {
    const { owner, deliver } = await setup();
    const token = (await record(owner))?.config.ingestToken;
    expect(token).toEqual(expect.any(String));

    const file = path.join(DATA_DIR, 'plugins.json');
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(
      file,
      JSON.stringify(
        all.filter(
          (r: { ownerId: string; id: string }) =>
            !(r.ownerId === owner && r.id === MODULE),
        ),
      ),
    );
    expect(await record(owner)).toBeNull();

    llm.mockResolvedValue({ is_task: false, confidence: 0.9, tasks: [] });
    expect(await deliver({ text: 'hi there' })).toEqual({
      task: false,
      confidence: 0.9,
    });
    const restored = await record(owner);
    expect(restored?.enabled).toBe(true);
    expect(restored?.config.ingestToken).toBe(token);
  });

  it("refuses another module's token, and the printed job keeps the envelope's source", async () => {
    const { owner, deliver } = await setup();
    const other = tokenCaller(owner, 'espn-worldcup:ingestToken', [
      'messages.deliver',
    ]);
    await expect(
      messagesDeliver(other, {
        moduleId: MODULE,
        envelope: { text: 'task: x' },
      }),
    ).rejects.toMatchObject({ name: 'OpError', code: 'forbidden' });

    llm.mockResolvedValue({
      is_task: true,
      confidence: 0.95,
      tasks: [{ title: 'Grocery list', items: ['Milk', 'Eggs'] }],
    });
    const reply = await deliver({
      text: 'get milk and eggs',
      sender: 'Alice',
      source: 'rcs',
    });
    expect(reply).toMatchObject({ task: true, printed: 1 });
    const jobs = await listJobs(owner);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'Task: Grocery list',
      source: 'rcs',
    });
  });

  it('a handler that returns no reply answers {}, never undefined', async () => {
    const { owner, deliver } = await setup();
    vi.mocked(onMessage).mockResolvedValueOnce({ state: { seen: 1 } });

    expect(await deliver({ text: 'hello' })).toEqual({});
    const after = await record(owner);
    expect(after?.state).toEqual({ seen: 1 });
    expect(after?.lastError).toBeNull();
  });
});

describe('messages.deliver duplicate guard', () => {
  const verdict = (title: string) => ({
    is_task: true,
    confidence: 0.9,
    tasks: [{ title }],
  });

  it('a resent message prints once and answers duplicate: true', async () => {
    const { owner, deliver } = await setup();
    llm.mockClear();
    llm.mockResolvedValue(verdict('Water the plants'));
    const msg = { text: 'water the plants', sender: 'Alice', source: 'sms' };

    expect(await deliver(msg)).toMatchObject({ task: true, printed: 1 });
    expect(await deliver(msg)).toEqual({ duplicate: true });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(await listJobs(owner)).toHaveLength(1);
  });

  it('the same text from another sender or source, or for another owner, is a new message', async () => {
    const { owner, deliver } = await setup();
    llm.mockResolvedValue(verdict('Call the vet'));
    const text = 'call the vet';

    for (const m of [
      { text, sender: 'Alice', source: 'sms' },
      { text, sender: 'Bob', source: 'sms' },
      { text, sender: 'Alice', source: 'rcs' },
      { text },
    ]) {
      expect(await deliver(m)).toMatchObject({ task: true, printed: 1 });
    }
    expect(await listJobs(owner)).toHaveLength(4);

    const other = await setup();
    expect(await other.deliver({ text })).toMatchObject({ printed: 1 });
  });

  it('a copy that arrives while the first is still running gets conflict; once it is done, duplicate', async () => {
    const { owner, deliver } = await setup();
    llm.mockClear();
    let finish: (v: unknown) => void = () => {};
    llm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const msg = { text: 'book the plumber', sender: 'Alice' };

    const first = deliver(msg);
    await vi.waitFor(() => expect(llm).toHaveBeenCalledTimes(1));
    await expect(deliver(msg)).rejects.toMatchObject({
      name: 'OpError',
      code: 'conflict',
    });
    finish(verdict('Book the plumber'));
    expect(await first).toMatchObject({ task: true, printed: 1 });
    expect(await deliver(msg)).toEqual({ duplicate: true });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(await listJobs(owner)).toHaveLength(1);
  });

  it('a failed delivery releases its claim, so the retry runs and prints', async () => {
    const { owner, deliver } = await setup();
    const msg = { text: 'renew the passport', sender: 'Alice' };

    llm.mockRejectedValueOnce(new Error('Gemini 503: unavailable'));
    await expect(deliver(msg)).rejects.toMatchObject({ code: 'unavailable' });
    llm.mockResolvedValueOnce(verdict('Renew the passport'));
    expect(await deliver(msg)).toMatchObject({ task: true, printed: 1 });
    expect(await deliver(msg)).toEqual({ duplicate: true });
    expect(await listJobs(owner)).toHaveLength(1);
  });

  it('skipped messages claim nothing: one sent while the slip was off prints once it is on', async () => {
    const { owner, deliver } = await setup();
    llm.mockResolvedValue(verdict('Feed the cat'));
    const msg = { text: 'feed the cat' };

    await setEnabled(owner, MODULE, false);
    expect(await deliver(msg)).toEqual({ skipped: 'disabled' });
    await setEnabled(owner, MODULE, true);
    expect(await deliver(msg)).toMatchObject({ task: true, printed: 1 });
  });

  it('a delivery that never finishes (killed at the function limit) holds its claim for 90 seconds', async () => {
    const { owner, deliver } = await setup();
    llm.mockClear();
    // The first copy's handler hangs, as a function killed at maxDuration
    // never reaches the failure path that releases the claim.
    llm.mockImplementationOnce(() => new Promise(() => {}));
    const msg = { text: 'water the garden', sender: 'Alice' };
    const T0 = Date.parse('2026-10-13T13:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      void deliver(msg);
      // (waitFor moves the fake clock on by its 50ms interval per check)
      await vi.waitFor(() => expect(llm).toHaveBeenCalledTimes(1));
      vi.setSystemTime(T0 + 89_000);
      await expect(deliver(msg)).rejects.toMatchObject({ code: 'conflict' });
      vi.setSystemTime(T0 + 91_000);
      llm.mockResolvedValueOnce(verdict('Water the garden'));
      expect(await deliver(msg)).toMatchObject({ task: true, printed: 1 });
      expect(await deliver(msg)).toEqual({ duplicate: true });
    } finally {
      vi.useRealTimers();
    }
    expect(await listJobs(owner)).toHaveLength(1);
  });

  it('the claim lasts 15 minutes from the end of the delivery', async () => {
    const { owner, deliver } = await setup();
    llm.mockResolvedValue(verdict('Pay rent'));
    const msg = { text: 'pay rent', sender: 'Landlord' };
    const T0 = Date.parse('2026-10-13T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      expect(await deliver(msg)).toMatchObject({ printed: 1 });
      vi.setSystemTime(T0 + 15 * 60_000 - 1_000);
      expect(await deliver(msg)).toEqual({ duplicate: true });
      vi.setSystemTime(T0 + 15 * 60_000);
      expect(await deliver(msg)).toMatchObject({ printed: 1 });
    } finally {
      vi.useRealTimers();
    }
    expect(await listJobs(owner)).toHaveLength(2);
  });
});
