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
import { INGEST_TOKEN, INGEST_TIMEZONE } from '../config.js';
import { classifyMessage } from '../lib/task-classifier.js';
import { createJob } from '../lib/job-store.js';
import { getTemplates, saveTemplate } from '../lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASK_TEMPLATE_FILE = path.join(__dirname, '..', 'reference', 'task-templates.json');

// Below this the classifier's own uncertainty wins and nothing prints; a
// wrongly-skipped task costs less than a printer that cries wolf.
const MIN_CONFIDENCE = 0.6;

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

// "Jul 4 2026" / "14:32" in the owner's timezone, matching the brief header.
function receivedParts(receivedAt) {
  const d = receivedAt ? new Date(receivedAt) : new Date();
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: INGEST_TIMEZONE, month: 'short', day: 'numeric', year: 'numeric',
  }).format(d).replace(',', '');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: INGEST_TIMEZONE, hour: '2-digit', minute: '2-digit',
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

  let verdict;
  try {
    verdict = await classifyMessage({ text, sender, source, receivedAt });
  } catch (err) {
    console.error(`[ingest] classify failed: ${err.message}`);
    return res.status(502).json({ error: 'classification failed' });
  }

  if (!verdict.is_task || (verdict.confidence ?? 0) < MIN_CONFIDENCE) {
    return res.status(200).json({ task: false, confidence: verdict.confidence ?? 0 });
  }

  const tpl = await getTaskTemplate();
  const { date, time } = receivedParts(receivedAt);
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

  return res.status(200).json({ task: true, jobId: job.id, title: data.title });
}
