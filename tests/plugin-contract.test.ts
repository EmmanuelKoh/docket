// tests/plugin-contract.test.ts — the module contract (plugins/index.js):
// a scheduled module has run(), hooks.credentials are minted once and kept,
// and generic code derives "passive" instead of reading a flag or
// branching on a module id. defaults.enabled applies to new records only:
// espn-worldcup registers off, and a record that exists (or its Postgres
// config truth) keeps its setting.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  earliestDueAt,
  getPlugin,
  getPluginConfig,
  listPlugins,
  savePluginConfig,
  setEnabled,
} from '@/lib/plugin-registry.js';
import { ensureRegistered } from '@/lib/plugin-setup.js';
import { isScheduled, PLUGINS, takesMessages } from '@/plugins/index.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/plugin-contract`;
});

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

type Module = {
  id: string;
  run?: unknown;
  defaults: { schedule?: unknown };
  hooks?: { credentials?: { key: string; kind: string }[] };
};
const modules = PLUGINS as unknown as Module[];

it('every scheduled module has run, and every module has a trigger', () => {
  for (const m of modules) {
    if (m.defaults.schedule) {
      expect(typeof m.run, m.id).toBe('function');
      expect(isScheduled(m), m.id).toBe(true);
    }
    expect(isScheduled(m) || takesMessages(m), m.id).toBe(true);
  }
});

it('hooks.credentials keys are minted once and survive a forced re-registration', async () => {
  const declared = modules.filter((m) => m.hooks?.credentials?.length);
  expect(declared.map((m) => m.id)).toContain('message-ingest');

  const owner = `owner-${randomUUID()}`;
  const values = async () => {
    const records = await listPlugins(owner);
    const out: Record<string, unknown> = {};
    for (const m of declared) {
      const record = records.find((r: { id: string }) => r.id === m.id);
      const truth = await getPluginConfig(owner, m.id);
      for (const { key } of m.hooks?.credentials || []) {
        out[`${m.id}.${key}`] = record?.config[key];
        // Postgres config truth holds the same value.
        expect(truth?.config[key], `${m.id}.${key}`).toBe(record?.config[key]);
      }
    }
    return out;
  };

  await ensureRegistered(owner);
  const minted = await values();
  for (const [k, v] of Object.entries(minted)) {
    expect(v, k).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes, base64url
  }

  await ensureRegistered(owner, { force: true });
  expect(await values()).toEqual(minted);
});

it('espn-worldcup registers off for a new owner; an existing setting survives registration', async () => {
  const ESPN = 'espn-worldcup';
  const enabled = async (owner: string) => ({
    record: (await getPlugin(owner, ESPN))?.enabled,
    truth: (await getPluginConfig(owner, ESPN))?.enabled,
  });

  // New: off in the driver store and in Postgres, and nothing of the
  // owner's is due (morning-brief is off too, message-ingest unscheduled).
  const fresh = `owner-${randomUUID()}`;
  await ensureRegistered(fresh);
  expect(await enabled(fresh)).toEqual({ record: false, truth: false });
  expect(await earliestDueAt(fresh)).toBeNull();

  // An owner who switched it on keeps it on through re-registration.
  const on = `owner-${randomUUID()}`;
  await ensureRegistered(on);
  await setEnabled(on, ESPN, true);
  await ensureRegistered(on, { force: true });
  expect(await enabled(on)).toEqual({ record: true, truth: true });

  // A record the driver store lost comes back with its Postgres setting.
  const restored = `owner-${randomUUID()}`;
  await savePluginConfig({
    id: ESPN,
    ownerId: restored,
    enabled: true,
    schedule: { every: 60 },
    config: { watchTeams: [] },
  });
  expect(await getPlugin(restored, ESPN)).toBeNull();
  await ensureRegistered(restored);
  expect(await enabled(restored)).toEqual({ record: true, truth: true });
  expect(await earliestDueAt(restored)).toEqual(expect.any(Number));
});

it('lib/ and app/ neither read a passive flag nor branch on a module id', () => {
  const root = path.resolve(__dirname, '..');
  const banned = /\.passive\b|passive:|module\.id\s*===/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|tsx?)$/.test(e.name)) {
        fs.readFileSync(p, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (banned.test(line))
              hits.push(`${path.relative(root, p)}:${i + 1}`);
          });
      }
    }
  };
  walk(path.join(root, 'lib'));
  walk(path.join(root, 'app'));
  expect(hits).toEqual([]);
});
