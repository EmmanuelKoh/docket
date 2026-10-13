// lib/plugin-setup.js — plugin registration, declared credentials, and
// plugin template seeding. Phase 5 moved all of this OFF the tick path: it
// runs on the dashboard's Slips page view (and is cheap when warm — once
// per owner per process), and on a message delivery whose record the
// driver store lost (lib/ops/messages.js). A brand-new owner's plugins
// therefore activate on their first Slips visit; until then the owner has
// no due-index entries and their device's ticks are pure no-ops.
//
// Ensures every installed plugin module has a registry record (a scheduled
// one with a schedule and a due-index entry) and mints the credentials its
// hooks.credentials declares. Generic: nothing here branches on a module id.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPluginConfig,
  listPlugins,
  mirrorCredential,
  reschedule,
  savePluginConfig,
  syncTickSignal,
  upsertPlugin,
} from './plugin-registry.js';
import { getTemplates, saveTemplate } from './store.js';
import { PLUGINS, isScheduled } from '../plugins/index.js';

// Plugin template seeds (only-if-missing, per owner) — moved here from
// /tick so the device cadence never pays for them.
const SEED_TEMPLATE_FILES = [
  path.join(process.cwd(), 'reference', 'wc-templates.json'),
  path.join(process.cwd(), 'reference', 'brief-templates.json'),
  path.join(process.cwd(), 'reference', 'photo-templates.json'),
  path.join(process.cwd(), 'reference', 'task-templates.json'),
];

// Seed the plugin templates the owner lacks; `names` narrows the set (a
// message delivery seeds just its module's templates before it runs).
// Existing ones are never overwritten.
export async function seedTemplates(ownerId, names) {
  const have = new Set((await getTemplates(ownerId)).map(t => t.name));
  for (const file of SEED_TEMPLATE_FILES) {
    const toSeed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const t of toSeed) {
      if (have.has(t.name) || (names && !names.includes(t.name))) continue;
      await saveTemplate(ownerId, t);
      have.add(t.name);
      console.log(`  seeded template "${t.name}"`);
    }
  }
}

const checked = new Set();

// Mint each hooks.credentials key the record's config lacks (16 random
// bytes, base64url). Never re-mints or drops one: a credential stays as
// minted until the owner edits it on the Slips page. Returns the minted
// keys.
function mintCredentials(module, record) {
  const minted = [];
  for (const { key } of module.hooks?.credentials || []) {
    if (record.config?.[key]) continue;
    record.config = { ...record.config, [key]: crypto.randomBytes(16).toString('base64url') };
    minted.push(key);
  }
  return minted;
}

// After the record and its config truth are saved: mirror each fresh
// credential, so its first use resolves without Postgres.
async function mirrorMinted(module, record, keys) {
  for (const key of keys) {
    await mirrorCredential(module.id, key, record.config[key], record.ownerId);
  }
}

// Returns the current records (post-registration). Cheap when warm: one
// listPlugins per owner per process; `force` re-checks (a delivery whose
// record went missing).
export async function ensureRegistered(ownerId, { force = false } = {}) {
  const records = await listPlugins(ownerId);
  if (checked.has(ownerId) && !force) return records;

  for (const module of PLUGINS) {
    const scheduled = isScheduled(module);
    const existing = records.find(r => r.id === module.id);

    if (!existing) {
      const record = {
        id: module.id,
        ownerId,
        enabled: module.defaults.enabled !== false,
        schedule: scheduled ? { ...module.defaults.schedule } : null,
        nextDueAt: null,
        lastRunAt: null,
        config: { ...(module.defaults.config || {}) },
        state: {},
        lastError: null,
        lastErrorAt: null,
      };
      // If Postgres holds config truth for this plugin (the driver store
      // was reset — fresh Redis, wiped data/), restore the settings and
      // credentials; only the runtime state is genuinely gone.
      const truth = await getPluginConfig(ownerId, module.id);
      if (truth) {
        record.enabled = truth.enabled;
        record.schedule = truth.schedule ?? record.schedule;
        record.config = truth.config ?? record.config;
      }
      const minted = mintCredentials(module, record);
      if (scheduled) reschedule(record);
      await upsertPlugin(record);
      await savePluginConfig(record);
      await mirrorMinted(module, record, minted);
      records.push(record);
      console.log(`  registered plugin "${module.id}"`);
      continue;
    }

    const minted = mintCredentials(module, existing);
    if (minted.length) {
      await upsertPlugin(existing, { create: false });
      await savePluginConfig(existing);
      await mirrorMinted(module, existing, minted);
    }

    if (!scheduled) continue;

    // A scheduled module's record without a schedule gets the default.
    if (!existing.schedule) {
      existing.schedule = { ...module.defaults.schedule };
      reschedule(existing);
      await upsertPlugin(existing, { create: false });
      await savePluginConfig(existing);
      continue;
    }

    // Repair: enabled with a schedule but no due entry (e.g. hand-edited).
    if (existing.enabled && !Number.isFinite(existing.nextDueAt)) {
      reschedule(existing);
      await upsertPlugin(existing, { create: false });
    }
  }

  await seedTemplates(ownerId);
  await syncTickSignal(ownerId);
  checked.add(ownerId);
  return records;
}
