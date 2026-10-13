// app/_lib/slip-data.ts — the unified "slip" view. A slip is either a
// system slip (an installed plugin module and the owner's record of it,
// read as { module, record } pairs from slips.list / slips.get) or a
// standalone template (a stored template no module prints with, from
// templates.list). This file only assembles the display; the stores are
// reached through the ops in lib/ops/slips.js and lib/ops/templates.js.
//
// configFields/untilText format a slip's config and next run; the
// matching config parsing lives in slips.saveConfig, typed by the
// module's defaults.config.
//
// Reads only: registration and plugin-template seeding run on the Slips
// pages (slips.register) before they list.
//
// A slip's preview image (thumb) is its primary template rendered with
// that template's stored data, so the URL carries the template's
// updatedAt and the deploy as v: the image is cached for good, and a save
// or a deploy changes the URL.

import { DEPLOY_VERSION } from '@/config.js';
import type { Caller } from '@/lib/ops/caller.js';
import { slipsGet, slipsList } from '@/lib/ops/slips.js';
import { templatesList } from '@/lib/ops/templates.js';
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
  thumb: string | null; // the preview image's URL (thumbSrc)
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

// The module part of a pair (slips.list): what the display needs of it.
type SlipModule = {
  id: string;
  meta: { title?: string; description?: string; category?: string };
  templates: string[];
  configLabels: Record<string, string>;
  scheduled: boolean;
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

export type SlipPair = { module: SlipModule; record: PluginRecord | null };

type TemplateRow = { name: string; updatedAt?: string | null };
// template name -> updatedAt (epoch ms), the thumbnail's version
type Versions = Map<string, number>;

function versionsOf(templates: TemplateRow[]): Versions {
  const versions: Versions = new Map();
  for (const t of templates) {
    const at = Date.parse(t.updatedAt || '');
    if (Number.isFinite(at)) versions.set(t.name, at);
  }
  return versions;
}

// /api/templates/thumb for a template. With a version (its updatedAt) the
// route lets the browser keep the image for good; without one (a
// template not read here) it gets the short cache. The deploy (the short
// commit hash, when set) joins the version, since a deploy can change how
// the same template renders.
export function thumbSrc(
  name: string | null,
  version?: number | null,
  deploy: string = DEPLOY_VERSION,
): string | null {
  if (!name) return null;
  const q = new URLSearchParams({ name });
  if (version) q.set('v', deploy ? `${version}-${deploy}` : String(version));
  return `/api/templates/thumb?${q}`;
}

// ---- formatting helpers ----

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

// ---- slip assembly ----

// A registered module's slip. The toggle and config routes build their
// reply from the pair their op returns (no versions: the panel they
// refresh shows no thumbnail).
export function systemSlip(
  {
    module,
    record,
  }: {
    module: SlipModule;
    record: PluginRecord;
  },
  versions: Versions = new Map(),
): Slip {
  const passive = !module.scheduled; // push-driven: runs on message
  const schedule = record.schedule || {};
  const templates = module.templates;
  const primary = templates[0] || null;
  return {
    slug: module.id,
    kind: 'system',
    title: module.meta?.title || module.id,
    description: module.meta?.description || '',
    category: module.meta?.category || 'plugins',
    templates,
    primaryTemplate: primary,
    thumb: thumbSrc(primary, primary ? versions.get(primary) : null),
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

function templateSlip(name: string, versions: Versions): Slip {
  return {
    slug: name,
    kind: 'template',
    title: name,
    description: 'A stored template, printable from the Studio.',
    category: 'templates',
    templates: [name],
    primaryTemplate: name,
    thumb: thumbSrc(name, versions.get(name)),
  };
}

// All slips: system slips first (installed-module order, registered ones
// only), then standalone templates (every stored template no module
// prints with).
export async function listSlips(caller: Caller): Promise<Slip[]> {
  const [pairs, templates] = await Promise.all([
    slipsList(caller) as Promise<SlipPair[]>,
    templatesList(caller) as Promise<TemplateRow[]>,
  ]);

  const owned = new Set(pairs.flatMap((p) => p.module.templates));
  const versions = versionsOf(templates);
  const slips: Slip[] = [];

  for (const { module, record } of pairs) {
    if (record) slips.push(systemSlip({ module, record }, versions));
  }
  for (const t of templates) {
    if (!owned.has(t.name)) slips.push(templateSlip(t.name, versions));
  }
  return slips;
}

// A module id reads one record (slips.get) and the templates for its
// thumbnail's version; any other slug is looked for among the standalone
// templates.
export async function getSlip(
  caller: Caller,
  slug: string,
): Promise<Slip | null> {
  const pair = await (
    slipsGet(caller, { id: slug }) as Promise<SlipPair>
  ).catch((err: { code?: string }) => {
    if (err?.code === 'not_found') return null;
    throw err;
  });
  if (pair) {
    const { module, record } = pair;
    if (!record) return null;
    const templates = (await templatesList(caller)) as TemplateRow[];
    return systemSlip({ module, record }, versionsOf(templates));
  }
  const slips = await listSlips(caller);
  return slips.find((s) => s.kind === 'template' && s.slug === slug) || null;
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
