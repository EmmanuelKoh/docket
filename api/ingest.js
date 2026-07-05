// api/ingest.js — POST /ingest
// Receives messages forwarded from a phone (an Android SMS-forwarder app
// today; Slack/email adapters can normalize into the same shape later),
// asks Gemini whether the message contains a task, and if so prints a task
// receipt immediately via createJob.
//
// Body: { text, sender?, source?, receivedAt? }   (text required)
// Auth: Authorization: Bearer <INGEST_TOKEN>, or ?token=<INGEST_TOKEN> for
// forwarder apps that can only set the URL. Neither the device token nor
// the dashboard cookie opens this door — the forwarder gets its own secret
// so it can be rotated without touching the printer.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { INGEST_TOKEN, OWNER_ID } from '../config.js';
import { classifyMessage } from '../lib/task-classifier.js';
import { createJob } from '../lib/job-store.js';
import { getTemplates, saveTemplate } from '../lib/store.js';
import { getPlugin, upsertPlugin } from '../lib/plugin-registry.js';
import * as messageIngest from '../plugins/message-ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASK_TEMPLATE_FILE = path.join(__dirname, '..', 'reference', 'task-templates.json');

// This feature is the `message-ingest` plugin: enable/disable and tunables
// (min confidence, timezone, Gemini model) live in its registry record,
// editable on the Plugins page. /tick registers it on first run, but this
// endpoint can be hit first, so seed the record from defaults if missing.
async function getIngestRecord() {
  let record = await getPlugin(OWNER_ID, messageIngest.id);
  if (!record) {
    record = {
      id: messageIngest.id,
      ownerId: OWNER_ID,
      enabled: messageIngest.defaults.enabled !== false,
      intervalSeconds: null,
      lastRunAt: null,
      config: { ...messageIngest.defaults.config },
      state: {},
      lastError: null,
      lastErrorAt: null,
    };
    await upsertPlugin(record);
  }
  return record;
}

// Persist activity to the plugin record so the dashboard card shows status:
// lastRunAt = last message processed, lastError = last classifier failure.
async function markActivity(record, { error } = {}) {
  const now = new Date().toISOString();
  record.lastRunAt = now;
  record.lastError = error || null;
  record.lastErrorAt = error ? now : null;
  await upsertPlugin(record).catch(() => {});
}

function authorized(req) {
  if (!INGEST_TOKEN) return false;
  const header = req.headers?.authorization || '';
  if (header === `Bearer ${INGEST_TOKEN}`) return true;
  return (req.query?.token || '') === INGEST_TOKEN;
}

// The Task template seeds like the plugin templates do on /tick, but this
// endpoint can be hit before the first tick — ensure it exists here too.
async function getTaskTemplate() {
  const templates = await getTemplates();
  const existing = templates.find(t => t.name === 'Task');
  if (existing) return existing;
  const [seed] = JSON.parse(fs.readFileSync(TASK_TEMPLATE_FILE, 'utf-8'));
  await saveTemplate(seed);
  return seed;
}

// "Jul 4 2026" / "14:32" in the configured timezone, matching the brief header.
function receivedParts(receivedAt, timeZone) {
  const d = receivedAt ? new Date(receivedAt) : new Date();
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric',
  }).format(d).replace(',', '');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit',
  }).format(d);
  return { date, time };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  if (!INGEST_TOKEN) {
    return res.status(503).json({ error: 'INGEST_TOKEN is not configured' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'missing or invalid ingest token' });
  }

  const { text, sender, source, receivedAt } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  // Off switch: when the message-ingest plugin is disabled on the Plugins
  // page, accept the message but do nothing (no Gemini call, no print).
  const record = await getIngestRecord();
  if (!record.enabled) {
    return res.status(200).json({ skipped: 'disabled' });
  }
  const cfg = { ...messageIngest.defaults.config, ...(record.config || {}) };
  const minConfidence = Number.isFinite(cfg.minConfidence) ? cfg.minConfidence : 0.6;

  // Manual override: a message that starts with "task:" is always printed,
  // whatever the classifier thinks — an explicit escape hatch for "just
  // print this". Gemini still runs (on the text with the prefix stripped)
  // so it cleans up the wording and extracts due/priority; the override
  // only stops Gemini — or a Gemini outage — from vetoing the print.
  const forced = /^\s*task:/i.test(text);
  const classifyText = forced ? text.replace(/^\s*task:\s*/i, '').trim() : text;

  let verdict;
  try {
    verdict = await classifyMessage({ text: classifyText, sender, source, receivedAt },
      { model: cfg.geminiModel });
  } catch (err) {
    console.error(`[ingest] classify failed: ${err.message}`);
    if (!forced) {
      await markActivity(record, { error: err.message });
      return res.status(502).json({ error: 'classification failed' });
    }
    verdict = {}; // forced task prints even when the classifier is down
  }

  if (forced) {
    verdict.is_task = true;
    verdict.confidence = 1;
    // Keep Gemini's cleaned-up title; fall back to the raw text only if it
    // gave none (e.g. trivial content, or the classifier was down).
    if (!verdict.title) verdict.title = classifyText || text.trim();
  }

  // A forced ("task:") message always prints — skip the classifier gate
  // entirely rather than relying on its confidence beating the threshold.
  if (!forced && (!verdict.is_task || (verdict.confidence ?? 0) < minConfidence)) {
    await markActivity(record);
    return res.status(200).json({ task: false, confidence: verdict.confidence ?? 0 });
  }

  const tpl = await getTaskTemplate();
  const { date, time } = receivedParts(receivedAt, cfg.timezone);
  const data = {
    title: verdict.title || text.slice(0, 80),
    sender: sender || 'unknown',
    date,
    time,
    due: verdict.due || '',
    priority: verdict.priority || 'normal',
    quote: verdict.quote || '',
  };

  const job = await createJob({
    template: tpl.template,
    data,
    name: `Task: ${data.title}`,
    source: source || 'sms',
  });

  await markActivity(record);
  return res.status(200).json({ task: true, jobId: job.id, title: data.title });
}
