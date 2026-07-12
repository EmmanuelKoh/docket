// app/_lib/slip-data.ts — the unified "slip" view over the EXISTING
// stores. A slip is either a system plugin (plugins/*.js module + its
// registry record) or a standalone template (a stored template no plugin
// owns). This is deliberately an adapter, not a data migration: preview
// deployments share production data with the live legacy app, so the
// physical merge of the templates+plugins stores waits for cutover. All
// store access goes through the lib/ facades, per the house rule.
//
// configFields/parseConfigField/untilText are ported from api/dashboard.js
// so both apps edit config identically (types come from the plugin's
// defaults.config, canonical over stored values).

import { ensureRegistered } from '@/lib/plugin-setup.js';
import { getTemplates } from '@/lib/store.js';
import { PLUGINS } from '@/plugins/index.js';
import { agoText } from './format';

export type ConfigField = {
  key: string;
  label: string;
  multiline: boolean;
  rows?: number;
  value: string;
  wide?: boolean;
};

export type Slip = {
  slug: string;
  kind: 'system' | 'template';
  title: string;
  description: string;
  category: string;
  templates: string[]; // template-store names this slip prints with
  primaryTemplate: string | null; // for the preview stage
  // system slips only:
  enabled?: boolean;
  passive?: boolean;
  scheduleType?: 'every' | 'at' | null;
  scheduleEvery?: string;
  scheduleAt?: string;
  scheduleTz?: string;
  nextRunText?: string;
  lastRunText?: string;
  lastRunRed?: boolean;
  fields?: ConfigField[];
  state?: Record<string, unknown>;
};

type PluginModule = {
  id: string;
  passive?: boolean;
  meta?: { title?: string; description?: string; category?: string };
  templates?: string[];
  configLabels?: Record<string, string>;
  defaults?: { config?: Record<string, unknown> };
};

type PluginRecord = {
  id: string;
  enabled: boolean;
  schedule?: { every?: number; at?: string; timezone?: string } | null;
  nextDueAt?: number | null;
  lastRunAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

// ---- ported formatting/parsing helpers (api/dashboard.js) ----

// "in 42s" / "in 3m" / "in 5h" / "in 2d" for the next-run line.
export function untilText(ms: number): string {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 48 * 3600) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

const humanizeKey = (k: string) =>
  k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

export function configFields(
  config: Record<string, unknown> | undefined,
  labels: Record<string, string> = {},
): ConfigField[] {
  return Object.entries(config || {}).map(([key, value]) => {
    const label = labels[key] || humanizeKey(key);
    if (Array.isArray(value)) {
      return {
        key,
        label,
        multiline: true,
        rows: Math.max(value.length, 1),
        value: value.join('\n'),
      };
    }
    const str = value == null ? '' : String(value);
    return { key, label, multiline: false, value: str, wide: str.length > 32 };
  });
}

export function parseConfigField(
  original: unknown,
  raw: unknown,
): { value?: unknown; error?: string } {
  const s = String(raw ?? '').trim();
  if (Array.isArray(original)) {
    return {
      value: s
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    };
  }
  if (typeof original === 'number' || original === null) {
    if (s === '') return { value: null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { error: 'must be a number' };
    return { value: n };
  }
  if (typeof original === 'boolean') {
    if (s !== 'true' && s !== 'false')
      return { error: 'must be true or false' };
    return { value: s === 'true' };
  }
  return { value: s };
}

// ---- slip assembly ----

function systemSlip(module: PluginModule, record: PluginRecord): Slip {
  const passive = !!module.passive;
  const schedule = record.schedule || {};
  const templates = module.templates || [];
  return {
    slug: module.id,
    kind: 'system',
    title: module.meta?.title || module.id,
    description: module.meta?.description || '',
    category: module.meta?.category || 'plugins',
    templates,
    primaryTemplate: templates[0] || null,
    enabled: !!record.enabled,
    passive,
    scheduleType: passive ? null : schedule.at ? 'at' : 'every',
    scheduleEvery: schedule.every != null ? String(schedule.every) : '',
    scheduleAt: schedule.at ?? '',
    scheduleTz: schedule.timezone ?? '',
    nextRunText: !record.enabled
      ? '—'
      : passive
        ? 'on message'
        : Number.isFinite(record.nextDueAt as number)
          ? untilText(record.nextDueAt as number)
          : '—',
    lastRunText: record.lastError
      ? `${record.lastError} · ${agoText(record.lastErrorAt)}`
      : record.lastRunAt
        ? `${passive ? 'last message' : 'ran'} ${agoText(record.lastRunAt)}`
        : passive
          ? 'no messages yet'
          : 'never run',
    lastRunRed: !!record.lastError,
    fields: configFields(record.config, module.configLabels),
    state: record.state || {},
  };
}

function templateSlip(name: string): Slip {
  return {
    slug: name,
    kind: 'template',
    title: name,
    description: 'A stored template, printable from the Studio.',
    category: 'templates',
    templates: [name],
    primaryTemplate: name,
  };
}

// All slips: system plugins first (registry order), then standalone
// templates (every stored template no plugin claims).
export async function listSlips(ownerId: string): Promise<Slip[]> {
  const [records, templates] = await Promise.all([
    ensureRegistered(ownerId) as Promise<PluginRecord[]>,
    getTemplates(ownerId) as Promise<{ name: string }[]>,
  ]);

  const owned = new Set(
    (PLUGINS as PluginModule[]).flatMap((m) => m.templates || []),
  );
  const slips: Slip[] = [];

  for (const module of PLUGINS as PluginModule[]) {
    const record = records.find((r) => r.id === module.id);
    if (record) slips.push(systemSlip(module, record));
  }
  for (const t of templates) {
    if (!owned.has(t.name)) slips.push(templateSlip(t.name));
  }
  return slips;
}

export async function getSlip(
  ownerId: string,
  slug: string,
): Promise<Slip | null> {
  const slips = await listSlips(ownerId);
  return slips.find((r) => r.slug === slug) || null;
}

// Slips grouped for the index page, categories in first-seen order.
export function groupByCategory(
  slips: Slip[],
): { category: string; slips: Slip[] }[] {
  const groups = new Map<string, Slip[]>();
  for (const r of slips) {
    const list = groups.get(r.category) || [];
    list.push(r);
    groups.set(r.category, list);
  }
  return [...groups.entries()].map(([category, list]) => ({
    category,
    slips: list,
  }));
}
