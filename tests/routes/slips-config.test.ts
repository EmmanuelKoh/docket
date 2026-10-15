// tests/routes/slips-config.test.ts — what POST /api/slips/config parses
// before slips.saveConfig sees it: the Slips form's flat fields (sched_every,
// sched_at, sched_tz, cfg_<key>) become { schedule, config }, fields the
// form leaves out keep their stored values, and the reply is the assembled
// slip. Also the toggle route: the wanted state when the caller sends one,
// else a read-then-flip, which the ops never see.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as configRoute } from '@/app/api/slips/config/route';
import { POST as toggleRoute } from '@/app/api/slips/toggle/route';
import { userCaller } from '@/lib/ops/caller.js';
import { slipsRegister } from '@/lib/ops/slips.js';
import { getPlugin } from '@/lib/plugin-registry.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/routes-slips-config`;
});

vi.mock('@/lib/auth-server.js', () => import('../helpers/fake-auth'));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// An owner after their first Slips visit.
async function owner() {
  const id = `owner-${randomUUID()}`;
  await slipsRegister(userCaller({ userId: id, role: 'user' }));
  return id;
}

async function post(
  route: (req: Request) => Promise<Response>,
  path: string,
  who: string | null,
  body?: unknown,
) {
  const res = await route(
    new Request(`http://docket.test${path}`, {
      method: 'POST',
      headers: who ? { 'x-test-user': `${who}:user` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const saveConfig = (who: string | null, id: string, body: unknown) =>
  post(configRoute, `/api/slips/config?id=${id}`, who, body);

describe('POST /api/slips/config', () => {
  it("maps the form's fields onto the slip's schedule kind and typed config", async () => {
    const o = await owner();
    // The form always posts all three schedule fields; morning-brief's
    // schedule is "at", so sched_every is not read.
    const res = await saveConfig(o, 'morning-brief', {
      sched_every: '',
      sched_at: '07:15',
      sched_tz: 'Europe/London',
      cfg_icsUrls: 'https://a.test/one.ics\nhttps://b.test/two.ics',
      cfg_latitude: '51.5',
      cfg_longitude: '',
      cfg_focus: '  ship it  ',
    });

    expect(res.status).toBe(200);
    expect(res.body.slip).toMatchObject({
      slug: 'morning-brief',
      kind: 'system',
      scheduleType: 'at',
      scheduleAt: '07:15',
      scheduleTz: 'Europe/London',
    });
    const field = (key: string) =>
      res.body.slip.fields.find((f: { key: string }) => f.key === key);
    expect(field('icsUrls')).toMatchObject({ multiline: true, rows: 2 });
    expect(field('latitude').value).toBe('51.5');

    const record = await getPlugin(o, 'morning-brief');
    expect(record?.schedule).toEqual({
      at: '07:15',
      timezone: 'Europe/London',
    });
    expect(record?.config).toMatchObject({
      icsUrls: ['https://a.test/one.ics', 'https://b.test/two.ics'],
      latitude: 51.5,
      longitude: null,
      focus: 'ship it',
      // not in the form: kept
      timezone: 'America/New_York',
      temperatureUnit: 'fahrenheit',
    });
  });

  it('keeps the stored schedule and config when the form leaves them out', async () => {
    const o = await owner();
    const before = await getPlugin(o, 'espn-worldcup');
    expect(before?.schedule).toEqual({ every: 60 });

    expect((await saveConfig(o, 'espn-worldcup', {})).status).toBe(200);
    const after = await getPlugin(o, 'espn-worldcup');
    expect(after?.schedule).toEqual({ every: 60 });
    expect(after?.config).toEqual(before?.config);

    const res = await saveConfig(o, 'espn-worldcup', {
      sched_every: '120',
      sched_at: '',
      sched_tz: '',
    });
    expect(res.body.slip).toMatchObject({
      scheduleType: 'every',
      scheduleEvery: '120',
    });
    expect((await getPlugin(o, 'espn-worldcup'))?.schedule).toEqual({
      every: 120,
    });
  });

  it('answers 400 with the inline error and saves nothing; 404, 400 and 401 otherwise', async () => {
    const o = await owner();
    const before = await getPlugin(o, 'morning-brief');
    expect(
      await saveConfig(o, 'morning-brief', {
        sched_at: '25:00',
        cfg_focus: 'changed',
      }),
    ).toEqual({
      status: 400,
      body: { error: 'schedule: at must be HH:MM (24-hour) (not saved)' },
    });
    expect(await getPlugin(o, 'morning-brief')).toEqual(before);

    expect(await saveConfig(o, 'no-such-slip', {})).toEqual({
      status: 404,
      body: { error: 'not found' },
    });
    expect(await post(configRoute, '/api/slips/config', o, {})).toEqual({
      status: 400,
      body: { error: 'id required' },
    });
    expect((await saveConfig(null, 'morning-brief', {})).status).toBe(401);
  });
});

describe('POST /api/slips/toggle', () => {
  it('flips the stored enabled state and answers the slip', async () => {
    const o = await owner();
    const toggle = () =>
      post(toggleRoute, '/api/slips/toggle?id=morning-brief', o);
    expect((await getPlugin(o, 'morning-brief'))?.enabled).toBe(false);

    const on = await toggle();
    expect(on.status).toBe(200);
    expect(on.body.slip).toMatchObject({
      slug: 'morning-brief',
      enabled: true,
    });
    expect((await getPlugin(o, 'morning-brief'))?.nextDueAt).toEqual(
      expect.any(Number),
    );

    expect((await toggle()).body.slip.enabled).toBe(false);
    expect((await getPlugin(o, 'morning-brief'))?.enabled).toBe(false);
  });

  it('sets the wanted state, so a repeated click keeps the choice', async () => {
    const o = await owner();
    const set = (enabled: string) =>
      post(
        toggleRoute,
        `/api/slips/toggle?id=morning-brief&enabled=${enabled}`,
        o,
      );
    for (const _ of [1, 2]) {
      const on = await set('true');
      expect(on.status).toBe(200);
      expect(on.body.slip.enabled).toBe(true);
    }
    expect((await getPlugin(o, 'morning-brief'))?.enabled).toBe(true);
    // the next run of a slip with a daily time, in its own time zone
    expect((await set('true')).body.slip.runLabel).toMatch(
      /^(Today|Tomorrow) 06:30$/,
    );
    for (const _ of [1, 2]) {
      expect((await set('false')).body.slip.enabled).toBe(false);
    }
    expect((await getPlugin(o, 'morning-brief'))?.enabled).toBe(false);
    expect((await set('false')).body.slip.runLabel).toBe('Daily 06:30');
  });
});
