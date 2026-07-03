// api/dashboard.js — the DOCKET dashboard: login door, server-rendered pages,
// and htmx fragments. One handler serves /login, /logout, /studio, /dashboard
// and everything under it (see route table at the bottom).
//
// All data access goes through the store/registry facades; HTML comes from
// LiquidJS views in views/ (see lib/views.js). Device endpoints are NOT here
// — they keep Bearer token auth and never use the session cookie.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  OWNER_ID, STORE_DRIVER, HEARTBEAT_SECONDS, DASHBOARD_PASSWORD,
} from '../config.js';
import {
  createSessionCookie, clearSessionCookie, hasValidSession, requireSessionPage,
} from '../lib/session.js';
import { renderView, renderPage } from '../lib/views.js';
import { getTemplates, deleteTemplate } from '../lib/store.js';
import { listJobs, getJob, cancelJob, createJob } from '../lib/job-store.js';
import { listPlugins, getPlugin, setEnabled, upsertPlugin } from '../lib/plugin-registry.js';
import { getState } from '../lib/state-store.js';
import { PLUGINS } from '../plugins/index.js';
import { renderToPreview } from '../render/render-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STUDIO_FILE = path.join(ROOT, 'views', 'studio.html');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

// ---- small formatting helpers ----

function agoShort(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function agoText(iso) {
  const a = agoShort(iso);
  return a === 'now' ? 'just now' : `${a} ago`;
}

function hhmmss(iso) {
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return '';
  }
}

const HISTORY_STATUSES = ['done', 'failed', 'canceled'];

function statusClass(status) {
  if (status === 'failed') return 'red';
  if (status === 'canceled') return 'faint';
  return '';
}

function historyRow(j) {
  return {
    id: j.id,
    name: j.name || j.id,
    sub: j.source || '—',
    statusText: j.status,
    statusClass: statusClass(j.status),
    railTime: agoShort(j.createdAt),
    thumbUrl: `/jobs?png=${j.id}`,
  };
}

// Which plugins print with a given template (from the plugin modules).
function usedByText(templateName) {
  const ids = PLUGINS.filter(m => (m.templates || []).includes(templateName)).map(m => m.id);
  return ids.length ? `used by ${ids.join(', ')}` : 'manual only';
}

// Per-field config editing, derived from the config's shape: arrays edit
// as one-item-per-line textareas, everything else as inline inputs.
// Labels: the plugin's configLabels export wins; otherwise camelCase keys
// are split into words ("temperatureUnit" → "temperature unit").
const humanizeKey = k => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

function configFields(config, labels = {}) {
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

async function pluginCardData(record, error) {
  const module = PLUGINS.find(m => m.id === record.id);
  return {
    id: record.id,
    encoded: encodeURIComponent(record.id),
    enabled: !!record.enabled,
    intervalSeconds: record.intervalSeconds,
    fields: configFields(record.config, module?.configLabels),
    templates: (module?.templates || []).join(', ') || '—',
    lastRunText: record.lastError
      ? `${record.lastError} · ${agoText(record.lastErrorAt)}`
      : record.lastRunAt ? `ran ${agoText(record.lastRunAt)}` : 'never run',
    lastRunRed: !!record.lastError,
    error: error || '',
  };
}

function queueJobData(j) {
  return {
    id: j.id,
    name: j.name || j.id,
    source: j.source || '—',
    createdTime: hhmmss(j.createdAt),
    inflight: j.status === 'inflight',
    statusText: j.status === 'inflight' ? 'printing' : 'queued',
    claimedAgo: j.claimedAt
      ? `${Math.max(0, Math.floor((Date.now() - new Date(j.claimedAt).getTime()) / 1000))}s`
      : '',
  };
}

// ---- response helpers ----

function html(res, body, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(body);
}

function redirect(res, to) {
  res.setHeader('Location', to);
  return res.status(302).send('');
}

function passwordMatches(given) {
  if (!DASHBOARD_PASSWORD || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(DASHBOARD_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- page builders ----

async function homePage() {
  const [templates, plugins, jobs, device] = await Promise.all([
    getTemplates(),
    listPlugins(OWNER_ID),
    listJobs(1000),
    getState('device'),
  ]);

  const queued = jobs.filter(j => j.status === 'queued').length;
  const printing = jobs.filter(j => j.status === 'inflight').length;
  const history = jobs.filter(j => HISTORY_STATUSES.includes(j.status));
  const last = history[0];

  const queueSubParts = [];
  if (printing) queueSubParts.push(`${printing} printing`);
  if (queued) queueSubParts.push(`${queued} queued`);

  const lastSeen = device?.lastSeenAt;
  const stale = !lastSeen || Date.now() - new Date(lastSeen).getTime() > 90 * 1000;

  return renderPage('home', {
    title: 'Home',
    active: 'home',
    stats: {
      templates: templates.length,
      templatesSub: 'in the store',
      pluginsEnabled: plugins.filter(p => p.enabled).length,
      pluginsTotal: plugins.length,
      queue: queued + printing,
      queueSub: queueSubParts.join(' · ') || 'nothing waiting',
      lastPrintAge: last ? agoShort(last.createdAt) : '—',
      lastPrintSub: last ? (last.name || last.id) : 'no prints yet',
    },
    system: {
      deviceText: lastSeen ? `device seen ${agoText(lastSeen)}` : 'no device contact yet',
      stale,
      driver: STORE_DRIVER,
      tick: HEARTBEAT_SECONDS,
      version: VERSION,
    },
    recent: history.slice(0, 3).map(historyRow),
  });
}

async function templateRows() {
  const templates = await getTemplates();
  return templates.map(t => ({
    name: t.name,
    encoded: encodeURIComponent(t.name),
    usedBy: usedByText(t.name),
    editedAgo: t.updatedAt ? agoShort(t.updatedAt) : '—',
  }));
}

async function queueData() {
  const jobs = await listJobs(1000);
  // Oldest first — top of the list is next to print.
  const live = jobs.filter(j => j.status === 'queued' || j.status === 'inflight').reverse();
  return { jobs: live.map(queueJobData), count: live.length };
}

// ---- handler ----

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://local');
  const p = u.pathname.replace(/\/$/, '') || '/';
  const q = Object.fromEntries(u.searchParams);

  // -- door --
  if (p === '/login') {
    if (req.method === 'POST') {
      if (passwordMatches(req.body?.password)) {
        res.setHeader('Set-Cookie', createSessionCookie());
        return redirect(res, '/dashboard');
      }
      const error = DASHBOARD_PASSWORD ? 'wrong password' : 'DASHBOARD_PASSWORD is not set';
      return html(res, await renderView('login', { error }), 401);
    }
    if (hasValidSession(req)) return redirect(res, '/dashboard');
    return html(res, await renderView('login', {}));
  }

  if (p === '/logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return redirect(res, '/login');
  }

  // -- everything below requires the session --
  if (!requireSessionPage(req, res)) return;

  // -- studio (static HTML, auth-served) --
  if (p === '/studio') {
    return html(res, fs.readFileSync(STUDIO_FILE, 'utf-8'));
  }

  // -- home --
  if (p === '/dashboard') {
    return html(res, await homePage());
  }

  // -- templates --
  if (p === '/dashboard/templates' && req.method === 'GET') {
    const rows = await templateRows();
    return html(res, await renderPage('templates', { title: 'Templates', active: 'templates', rows }));
  }
  if (p === '/dashboard/templates' && req.method === 'DELETE') {
    if (q.name) await deleteTemplate(q.name);
    const rows = await templateRows();
    return html(res, await renderView('template-list', { rows }));
  }
  if (p === '/dashboard/templates/thumb') {
    const templates = await getTemplates();
    const t = templates.find(x => x.name === q.name);
    if (!t) return res.status(404).send('');
    try {
      const data = typeof t.data === 'string' ? JSON.parse(t.data || '{}') : (t.data || {});
      const { preview } = await renderToPreview(t.template, data);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(preview);
    } catch {
      return res.status(500).send('');
    }
  }

  // -- plugins --
  if (p === '/dashboard/plugins' && req.method === 'GET') {
    const records = await listPlugins(OWNER_ID);
    const plugins = await Promise.all(records.map(r => pluginCardData(r)));
    return html(res, await renderPage('plugins', { title: 'Plugins', active: 'plugins', plugins }));
  }
  if (p === '/dashboard/plugins/toggle' && req.method === 'POST') {
    const record = await getPlugin(OWNER_ID, q.id);
    if (!record) return res.status(404).send('');
    const updated = await setEnabled(OWNER_ID, q.id, !record.enabled);
    return html(res, await renderView('plugin-card', { p: await pluginCardData(updated) }));
  }
  if (p === '/dashboard/plugins/config' && req.method === 'POST') {
    const record = await getPlugin(OWNER_ID, q.id);
    if (!record) return res.status(404).send('');
    const interval = parseInt(req.body?.intervalSeconds, 10);
    let error = '';
    const config = { ...(record.config || {}) };
    if (!Number.isFinite(interval) || interval < 1) {
      error = 'interval must be a positive number of seconds — not saved';
    } else {
      // Types come from the plugin's defaults.config (canonical), not the
      // stored value — a previously mistyped value must not weaken parsing.
      const defaultsCfg = PLUGINS.find(m => m.id === record.id)?.defaults?.config || {};
      for (const key of Object.keys(config)) {
        const raw = req.body?.[`cfg_${key}`];
        if (raw === undefined) continue; // field not submitted — keep as is
        const typeRef = key in defaultsCfg ? defaultsCfg[key] : config[key];
        const parsed = parseConfigField(typeRef, raw);
        if (parsed.error) {
          error = `${key} ${parsed.error} — not saved`;
          break;
        }
        config[key] = parsed.value;
      }
    }
    if (!error) {
      const updated = { ...record, intervalSeconds: interval, config };
      await upsertPlugin(updated);
      return html(res, await renderView('plugin-card', { p: await pluginCardData(updated) }));
    }
    return html(res, await renderView('plugin-card', { p: await pluginCardData(record, error) }));
  }

  // -- queue --
  if (p === '/dashboard/queue' && req.method === 'GET') {
    const { jobs, count } = await queueData();
    return html(res, await renderPage('queue', { title: 'Queue', active: 'queue', jobs, count }));
  }
  if (p === '/dashboard/fragments/queue') {
    const { jobs, count } = await queueData();
    return html(res, await renderView('queue-list', { jobs, count, oob: true }));
  }
  if (p === '/dashboard/jobs/cancel' && req.method === 'POST') {
    if (q.job) await cancelJob(q.job);
    const { jobs, count } = await queueData();
    return html(res, await renderView('queue-list', { jobs, count, oob: true }));
  }

  // -- history --
  if (p === '/dashboard/history' && req.method === 'GET') {
    const filter = HISTORY_STATUSES.includes(q.filter) ? q.filter : 'all';
    const all = (await listJobs(1000)).filter(j =>
      filter === 'all' ? HISTORY_STATUSES.includes(j.status) : j.status === filter
    );
    const PER_PAGE = 20;
    const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    const page = Math.min(Math.max(1, parseInt(q.page, 10) || 1), pages);
    const rows = all.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(historyRow);
    return html(res, await renderPage('history', {
      title: 'History', active: 'history',
      rows, total: all.length, filter, page, pages,
    }));
  }
  if (p === '/dashboard/fragments/history-detail') {
    const job = await getJob(q.job);
    if (!job) return html(res, '<div class="row-detail"><span class="status faint">record not found</span></div>');
    // Truncate the code panes — the panel is a glance at the debug record,
    // not an editor (Reprint uses the full stored inputs regardless).
    const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);
    return html(res, await renderView('history-detail', {
      job: {
        id: job.id,
        template: clip(job.template || '', 600),
        dataJson: clip(JSON.stringify(job.data || {}, null, 2), 600),
      },
    }));
  }
  if (p === '/dashboard/jobs/reprint' && req.method === 'POST') {
    const job = await getJob(q.job);
    if (!job) return html(res, '<span class="status red">record not found</span>');
    try {
      const result = await createJob({
        template: job.template,
        data: job.data,
        name: job.name || job.id,
        source: 'reprint',
      });
      return html(res, `<span class="status">queued ${result.id}</span>`);
    } catch (err) {
      return html(res, `<span class="status red">reprint failed · ${String(err.message).replace(/</g, '&lt;')}</span>`);
    }
  }

  return html(res, 'Not found', 404);
}
