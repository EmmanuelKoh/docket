// lib/ops/slips.js: the Slips pages' operations. A system slip is an
// installed plugin module (plugins/index.js) plus the owner's registry
// record of it (lib/plugin-registry.js). These ops register the owner's
// modules, read them as { module, record } pairs, switch them on and off,
// save their schedule and config, and print a slip's test receipt.
// Display assembly (labels, "ran 3m ago", standalone template slips) stays
// in app/_lib/slip-data.ts; templates are lib/ops/templates.js.
import { z } from 'zod';
import { findModule, isScheduled, PLUGINS } from '../../plugins/index.js';
import * as jobStore from '../job-store.js';
import * as registry from '../plugin-registry.js';
import { ensureRegistered } from '../plugin-setup.js';
import { validateSchedule } from '../schedule.js';
import * as store from '../store.js';
import { defineOperation, JOB_CREATE, OpError } from './define.js';

const required = msg => z.string({ error: msg }).min(1, { error: msg });
const moduleId = required('id required');

// What a client needs of a module: card copy, the templates it prints
// with, config labels and defaults (the canonical types for config
// edits), whether it runs on a schedule, and which config keys are
// credentials (hooks.credentials).
const moduleInfo = m => ({
  id: m.id,
  meta: m.meta || {},
  templates: m.templates || [],
  configLabels: m.configLabels || {},
  defaultsConfig: { ...m.defaults?.config },
  scheduled: isScheduled(m),
  credentialKeys: (m.hooks?.credentials || []).map(c => c.key),
});

// A record as this caller may see it. Credential values (the keys
// hooks.credentials declares, e.g. the ingest token) go only to a signed-in
// user; any other caller (a token with a 'read' grant, a script) gets the
// record without those keys, so a config it sends back keeps them as they are.
function visibleRecord(caller, module, record) {
  const keys = (module.hooks?.credentials || []).map(c => c.key);
  if (!record?.config || caller.actor.kind === 'user' || !keys.length) return record;
  const config = { ...record.config };
  for (const key of keys) delete config[key];
  return { ...record, config };
}

// One submitted config value, typed by the module's default for that key:
// arrays take one item per line or comma, numbers (and null defaults) a
// number or blank for null, booleans true/false; anything else is a
// trimmed string.
function parseConfigField(original, raw) {
  const s = String(raw ?? '').trim();
  if (Array.isArray(original)) {
    return { value: s.split(/[\n,]+/).map(x => x.trim()).filter(Boolean) };
  }
  if (typeof original === 'number' || original === null) {
    if (s === '') return { value: null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { error: 'must be a number' };
    return { value: n };
  }
  if (typeof original === 'boolean') {
    if (s !== 'true' && s !== 'false') return { error: 'must be true or false' };
    return { value: s === 'true' };
  }
  return { value: s };
}

// Registration and plugin-template seeding, run explicitly on the Slips
// pages (reads never write). Cheap when warm: once per owner per process.
export const slipsRegister = defineOperation({
  name: 'slips.register',
  description: 'Set up your slips: give every installed module a record (schedule, config, credentials) and seed the templates they print with. Safe to repeat.',
  permission: 'owner',
  effects: ['kv.write', 'db.write', 'signal.write'],
  input: z.object({}),
  async run(caller) {
    await ensureRegistered(caller.ownerId);
    return { ok: true };
  },
});

export const slipsList = defineOperation({
  name: 'slips.list',
  description: "Your system slips: every installed module with your record of it (enabled, schedule, config, state, last run), or record null before slips.register. Credential values (module.credentialKeys) are in config only for a signed-in user.",
  permission: 'owner',
  effects: ['kv.read'],
  input: z.object({}),
  async run(caller) {
    const records = await registry.listPlugins(caller.ownerId);
    return PLUGINS.map(m => ({
      module: moduleInfo(m),
      record: visibleRecord(caller, m, records.find(r => r.id === m.id) ?? null),
    }));
  },
});

export const slipsGet = defineOperation({
  name: 'slips.get',
  description: 'One system slip by module id: the module and your record of it (null before slips.register). Credential values (module.credentialKeys) are in config only for a signed-in user.',
  permission: 'owner',
  effects: ['kv.read'],
  input: z.object({ id: moduleId }),
  async run(caller, { id }) {
    const module = findModule(id);
    if (!module) throw new OpError('not_found', 'not found');
    return { module: moduleInfo(module), record: visibleRecord(caller, module, await registry.getPlugin(caller.ownerId, id)) };
  },
});

// Enabling recomputes the next due time from now; disabling drops the
// slip from the due-index (plugin-registry.setEnabled).
export const slipsSetEnabled = defineOperation({
  name: 'slips.setEnabled',
  description: 'Turn a system slip on or off. Turning a scheduled slip on schedules its next run from now.',
  permission: 'owner',
  effects: ['kv.write', 'db.write', 'signal.write'],
  input: z.object({
    id: moduleId,
    enabled: z.boolean({ error: 'enabled must be true or false' }),
  }),
  async run(caller, { id, enabled }) {
    const module = findModule(id);
    const record = module && (await registry.setEnabled(caller.ownerId, id, enabled));
    if (!record) throw new OpError('not_found', 'not found');
    return { module: moduleInfo(module), record: visibleRecord(caller, module, record) };
  },
});

// One save updates everything: record, next-due time, due-index, the
// Postgres config truth and the tick flag. Submitted keys merge into the
// stored config; keys not submitted keep their value, unknown keys are
// ignored. Invalid input saves nothing (the message is the Slips page's
// inline red line).
export const slipsSaveConfig = defineOperation({
  name: 'slips.saveConfig',
  description: "Save a system slip's schedule and config. config values are typed by the module's defaults (lists one item per line, numbers, true/false); keys you leave out keep their value. schedule edits the slip's own kind: every (seconds, 10 or more) or at (HH:MM) with timezone.",
  permission: 'owner',
  effects: ['kv.write', 'db.write', 'signal.write'],
  input: z.object({
    id: moduleId,
    schedule: z.object({
      every: z.union([z.number(), z.string()]).optional(),
      at: z.string().optional(),
      timezone: z.string().optional(),
    }).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  async run(caller, { id, schedule: submitted, config: values = {} }) {
    const owner = caller.ownerId;
    const module = findModule(id);
    const record = module && (await registry.getPlugin(owner, id));
    if (!record) throw new OpError('not_found', 'not found');
    const scheduled = isScheduled(module);
    const invalid = msg => new OpError('invalid', `${msg} (not saved)`);

    // The kind (every vs at) is fixed by the record; the caller edits its
    // values, and a value left out keeps the stored one.
    let schedule = record.schedule || null;
    if (scheduled && submitted) {
      const kind = record.schedule?.at ? ['at', 'timezone'] : ['every'];
      const v = validateSchedule(Object.fromEntries(kind.map(k => [k, submitted[k] ?? record.schedule?.[k]])));
      if (v.error) throw invalid(`schedule: ${v.error}`);
      schedule = v.schedule;
    }

    // Types come from the module's defaults.config (canonical), not the
    // stored value: a previously mistyped value must not weaken parsing.
    const types = module.defaults?.config || {};
    const credentials = (module.hooks?.credentials || []).map(c => c.key);
    const config = { ...(record.config || {}) };
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(values, key) || values[key] === undefined) continue;
      const parsed = parseConfigField(key in types ? types[key] : config[key], values[key]);
      if (parsed.error) throw invalid(`${key} ${parsed.error}`);
      // A blank credential would be re-minted at the next registration,
      // silently changing the token its sender holds.
      if (credentials.includes(key) && !parsed.value) throw invalid(`${key} must not be blank`);
      config[key] = parsed.value;
    }

    const updated = { ...record, schedule, config };
    if (scheduled && updated.enabled) registry.reschedule(updated);
    await registry.upsertPlugin(updated, { create: false });
    await registry.savePluginConfig(updated);
    await registry.syncTickSignal(owner);
    return { module: moduleInfo(module), record: visibleRecord(caller, module, updated) };
  },
});

// The cheap probe: put a slip's primary template through the printer with
// its stored default data. A module's slip prints its first template; a
// standalone template slip prints itself.
export const slipsPrintTest = defineOperation({
  name: 'slips.printTest',
  description: "Print a slip's test receipt: its primary template with the template's stored default data. slug is a module id or a standalone template's name.",
  permission: 'owner',
  effects: ['db.read', 'render', ...JOB_CREATE],
  input: z.object({ slug: required('slug required') }),
  async run(caller, { slug }) {
    const module = findModule(slug);
    // A template a module prints with belongs to that module's slip.
    const owned = !module && PLUGINS.some(m => (m.templates || []).includes(slug));
    const name = module ? module.templates?.[0] : owned ? null : slug;
    const t = name ? await store.getTemplate(caller.ownerId, name) : null;
    if (!t) throw new OpError('not_found', module && name ? `template "${name}" is missing` : 'slip not found');
    const data = typeof t.data === 'string' ? JSON.parse(t.data || '{}') : t.data || {};
    const job = await jobStore.createJob(caller.ownerId, {
      template: t.template,
      data,
      name: `${t.name} (test)`,
      source: 'test',
    });
    return { queued: job.id };
  },
});
