// app/ingest/route.ts — POST /ingest
// Receives messages forwarded from a phone, asks Gemini what tasks the
// message contains, and prints a slip for each. Gemini groups related
// items onto one task and splits unrelated tasks apart, so one message can
// print several slips. See api/ingest.js for the full commentary on auth
// (a dedicated INGEST_TOKEN, rotatable without touching the printer), the
// message-ingest plugin record, and the "task:" override.

import fs from 'node:fs';
import path from 'node:path';
import { INGEST_TOKEN, OWNER_ID } from '@/config.js';
import { createJob } from '@/lib/job-store.js';
import { getPlugin, upsertPlugin } from '@/lib/plugin-registry.js';
import { getTemplates, saveTemplate } from '@/lib/store.js';
import { classifyMessage } from '@/lib/task-classifier.js';
import * as messageIngest from '@/plugins/message-ingest.js';

export const maxDuration = 60;

// One task from the classifier: a single action (items empty) or a group of
// related items/steps that print together on one slip.
type TaskGroup = {
  title?: string;
  items?: string[];
  ordered?: boolean;
  due?: string;
  priority?: string;
  quote?: string;
};

const TASK_TEMPLATE_FILE = path.join(
  process.cwd(),
  'reference',
  'task-templates.json',
);

// This feature is the `message-ingest` plugin: enable/disable and tunables
// live in its registry record, editable on the Plugins page. /tick registers
// it on first run, but this endpoint can be hit first, so seed the record
// from defaults if missing.
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
async function markActivity(
  record: {
    lastRunAt: string;
    lastError: string | null;
    lastErrorAt: string | null;
  },
  { error }: { error?: string } = {},
) {
  const now = new Date().toISOString();
  record.lastRunAt = now;
  record.lastError = error || null;
  record.lastErrorAt = error ? now : null;
  await upsertPlugin(record).catch(() => {});
}

function authorized(req: Request): boolean {
  if (!INGEST_TOKEN) return false;
  const header = req.headers.get('authorization') || '';
  if (header === `Bearer ${INGEST_TOKEN}`) return true;
  return (new URL(req.url).searchParams.get('token') || '') === INGEST_TOKEN;
}

// The Task template seeds like the plugin templates do on /tick, but this
// endpoint can be hit before the first tick — ensure it exists here too.
async function getTaskTemplate() {
  const templates = await getTemplates();
  const existing = templates.find((t: { name: string }) => t.name === 'Task');
  if (existing) return existing;
  const [seed] = JSON.parse(fs.readFileSync(TASK_TEMPLATE_FILE, 'utf-8'));
  await saveTemplate(seed);
  return seed;
}

// "Jul 4 2026" / "14:32" in the configured timezone, matching the brief header.
function receivedParts(receivedAt: string | undefined, timeZone: string) {
  const d = receivedAt ? new Date(receivedAt) : new Date();
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(d)
    .replace(',', '');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return { date, time };
}

export async function POST(req: Request) {
  if (!INGEST_TOKEN) {
    return Response.json(
      { error: 'INGEST_TOKEN is not configured' },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return Response.json(
      { error: 'missing or invalid ingest token' },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const { text, sender, source, receivedAt } = body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  // Off switch: when the message-ingest plugin is disabled on the Plugins
  // page, accept the message but do nothing (no Gemini call, no print).
  const record = await getIngestRecord();
  if (!record.enabled) {
    return Response.json({ skipped: 'disabled' });
  }
  const cfg = { ...messageIngest.defaults.config, ...(record.config || {}) };
  const minConfidence = Number.isFinite(cfg.minConfidence)
    ? cfg.minConfidence
    : 0.6;

  // Manual override: a message that starts with "task:" is always printed,
  // whatever the classifier thinks — an explicit escape hatch for "just
  // print this". Gemini still runs (on the text with the prefix stripped)
  // so it cleans up the wording and extracts due/priority; the override
  // only stops Gemini — or a Gemini outage — from vetoing the print.
  const forced = /^\s*task:/i.test(text);
  const classifyText = forced ? text.replace(/^\s*task:\s*/i, '').trim() : text;

  let verdict: {
    is_task?: boolean;
    confidence?: number;
    tasks?: TaskGroup[];
  };
  try {
    verdict = await classifyMessage(
      { text: classifyText, sender, source, receivedAt },
      { model: cfg.geminiModel },
    );
  } catch (err) {
    console.error(`[ingest] classify failed: ${(err as Error).message}`);
    if (!forced) {
      await markActivity(record, { error: (err as Error).message });
      return Response.json({ error: 'classification failed' }, { status: 502 });
    }
    verdict = {}; // forced task prints even when the classifier is down
  }

  if (forced) {
    verdict.is_task = true;
    verdict.confidence = 1;
    // Keep whatever Gemini grouped; if it gave nothing (trivial content, or
    // the classifier was down), fall back to one slip from the raw text.
    if (!verdict.tasks || verdict.tasks.length === 0) {
      verdict.tasks = [{ title: classifyText || text.trim() }];
    }
  }

  const tasks = verdict.tasks || [];

  // A forced ("task:") message always prints — skip the classifier gate
  // entirely rather than relying on its confidence beating the threshold.
  if (
    !forced &&
    (!verdict.is_task ||
      (verdict.confidence ?? 0) < minConfidence ||
      tasks.length === 0)
  ) {
    await markActivity(record);
    return Response.json({ task: false, confidence: verdict.confidence ?? 0 });
  }

  // One slip per task: Gemini has already grouped related items together and
  // split unrelated tasks apart, so each entry prints on its own.
  const tpl = await getTaskTemplate();
  const { date, time } = receivedParts(receivedAt, cfg.timezone);
  const printed: { id: string; title: string }[] = [];
  for (const t of tasks) {
    const title = t.title || text.slice(0, 80);
    const items = Array.isArray(t.items) ? t.items.filter(Boolean) : [];
    const data = {
      title,
      items,
      ordered: !!t.ordered,
      sender: sender || 'unknown',
      date,
      time,
      due: t.due || '',
      priority: t.priority || 'normal',
      quote: t.quote || '',
    };
    const job = await createJob({
      template: tpl.template,
      data,
      name: `Task: ${title}`,
      source: source || 'sms',
    });
    printed.push({ id: job.id, title });
  }

  await markActivity(record);
  return Response.json({ task: true, printed: printed.length, jobs: printed });
}
