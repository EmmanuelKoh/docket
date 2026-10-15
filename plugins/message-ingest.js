// plugins/message-ingest.js — the SMS/RCS ingestion feature, as a plugin.
//
// Unlike the other plugins, this one is PUSH-driven, not polled: messages
// arrive at the /ingest endpoint (forwarded from a phone), which hands each
// one to onMessage through messages.deliver (lib/ops/messages.js). onMessage
// asks Gemini (through ctx.llm) for the tasks in the message and prints a
// slip for each: related items grouped into a list, unrelated tasks split
// apart. It has no schedule and no run(), so the tick never calls it; it
// still has a registry record, so it shows on the Slips page with an
// enable/disable toggle and editable config.
//
// The runner skips delivery when the plugin is disabled and passes the
// record's config below. GEMINI_API_KEY stays in env, never in plugin
// config, which is stored and shown on the dashboard.
//
// Config (editable from the Slips page):
//   minConfidence  0-1 threshold; a classified task only prints at or above
//                  it (a "task:" prefix always prints, bypassing this)
//   timezone       IANA zone for the "received at" stamp on the receipt
//   geminiModel    Gemini model id used for classification
//   ingestToken    the sender's credential (hooks.credentials below)

import { z } from 'zod';
import { escapeHtml } from '../render/escape-html.js';

export const id = 'message-ingest';

// Card copy for the Slips pages. trigger: what makes it print, shown where
// a slip with a daily time shows its next run. sources: the job sources
// its receipts carry (the envelope's, 'sms' by default), so a receipt
// names this slip.
export const meta = {
  title: 'Text messages',
  description: 'Classifies texts forwarded from your phone and prints task receipts.',
  category: 'messages',
  trigger: 'Each text',
  sources: ['sms'],
};

export const defaults = {
  enabled: true, // gated further by GEMINI_API_KEY being set
  config: {
    minConfidence: 0.6,
    timezone: 'America/New_York',
    geminiModel: 'gemini-3.1-flash-lite',
  },
};

// Template this plugin prints with (shown on the dashboard card). The
// runner seeds it if missing before each delivery.
export const templates = ['Task'];

// Friendly labels for the dashboard's per-field config editor.
export const configLabels = {
  minConfidence: 'min confidence',
  geminiModel: 'gemini model',
  timezone: 'receipt time zone',
};

export const hooks = {
  // The per-owner ingest token: minted at registration when missing, never
  // re-minted or dropped, editable on the Slips page. /ingest resolves the
  // sender's owner by it (lib/ops/identity.js#callerForCredential).
  credentials: [{ key: 'ingestToken', kind: 'token' }],
};

// ---- classifier: "what tasks does this message contain?" ----
// One structured-output call through ctx.llm, with the reply schema written
// in Zod: the provider is constrained to it and the reply is parsed against
// it into { is_task, confidence, tasks: [...] }. A single message can
// produce more than one slip: Gemini groups related actions or items onto
// one task (a shopping list, the steps of a routine) and splits unrelated
// tasks into separate ones.

// Lenient on purpose: every field carries .catch(), so a malformed field
// degrades to its default (missing title falls back to the message text,
// bad tasks print nothing) instead of failing every forwarder retry at
// temperature 0. .catch() adds only a JSON Schema `default`, which the
// Gemini translation drops, so the request schema is unchanged.
const Task = z.object({
  title: z
    .string()
    .describe(
      'Heading for this slip: a short imperative for a single action ("Renew car insurance"), or a name for a group of related items ("Grocery list", "Before leaving").',
    )
    .catch(''),
  items: z
    .array(z.string())
    .describe(
      'The related sub-items or steps that belong on this one slip, each a short phrase. Leave empty for a single-action task.',
    )
    .optional()
    .catch(undefined),
  ordered: z
    .boolean()
    .describe(
      'True ONLY when the items must be done in sequence (steps); false for an unordered list such as shopping.',
    )
    .optional()
    .catch(undefined),
  due: z
    .string()
    .describe(
      'Due date as YYYY-MM-DD if stated or clearly implied for this task, else empty.',
    )
    .optional()
    .catch(undefined),
  priority: z.enum(['low', 'normal', 'high']).optional().catch(undefined),
  quote: z
    .string()
    .describe(
      'The exact phrase from the message that makes this a task. Empty if none.',
    )
    .optional()
    .catch(undefined),
});

export const TaskVerdict = z.object({
  is_task: z
    .boolean()
    .describe('True if the message contains at least one task.')
    .catch(false),
  confidence: z
    .number()
    .describe('0-1 confidence that this classification is correct.')
    .catch(0),
  tasks: z
    .array(Task)
    .describe(
      'One entry per distinct task. Related actions or items are grouped into a single entry (with its items filled in); unrelated tasks are separate entries. Empty when is_task is false.',
    )
    .catch([]),
});

function buildPrompt({ text, sender, source, receivedAt }) {
  const today = (receivedAt ? new Date(receivedAt) : new Date())
    .toISOString()
    .slice(0, 10);
  return `You triage incoming personal messages for the recipient and extract the tasks in each one — things the recipient must do or act on.

Count as tasks: direct requests or commands addressed to the recipient — including short imperatives with no deadline ("bring me dinner", "call me back", "pick up milk") — reminders with an action ("insurance is due next week"), commitments the recipient made ("you said you'd bring the cables"), appointments requiring preparation, and reminders to perform a courtesy on a specific occasion ("remember to wish your dad happy birthday"). A message that tells the recipient to do something is a task even when it is brief and has no date.
Do NOT count: pure FYIs, greetings, marketing/OTP/notification spam, questions answerable with a quick reply and no follow-up action, delivery status updates. Also do NOT count throwaway social relays — casually passing along a greeting or pleasantry the recipient would just echo in a reply ("tell her I said hi", "say hi to your mum for me", "send my love"). Note the difference from an occasion reminder above: "remember to wish your dad happy birthday" is a task; "tell her I said hi" is not.

The bar is a to-do-list item: something the recipient must remember to do that takes real action and has a consequence if forgotten.

GROUPING. A message can contain several tasks. Group actions or items that belong together onto ONE task (a shopping list, or the steps of one routine) by filling in its "items"; put UNRELATED tasks in SEPARATE entries. Examples:
- "Get milk and eggs from the store, and remember to wish your dad happy birthday" -> two entries: { title: "Grocery list", items: ["Milk", "Eggs"] } and { title: "Wish Dad happy birthday", items: [] }.
- "Before you leave for the day: take out the trash, turn off the devices, lock the doors" -> one entry: { title: "Before leaving", items: ["Take out the trash", "Turn off the devices", "Lock the doors"], ordered: false }.
For a single action, leave "items" empty and put the action in "title". Never split a single action into separate words. Set "ordered" true only when the items are a sequence that must happen in a specific order (e.g. numbered steps), otherwise false.

Take the sender into account. A request or reminder from a known person (a contact name rather than a bare phone number) is more likely a genuine task. Messages from unknown numbers, short codes, or businesses are usually notifications, marketing, or spam — treat those as tasks only when the action is unmistakable.

Write each title and item from the recipient's perspective, as a short imperative, and resolve the sender's first-person words ("me", "my", "I") to the sender's name — the sender is speaking, not the recipient. Examples: from Tom, "dance for me" -> "Dance for Tom"; from Alice, "call me tonight" -> "Call Alice tonight"; from Mum, "can you pick up my prescription" -> "Pick up Mum's prescription".

Resolve relative dates against today: ${today}. If no date is stated or clearly implied, leave "due" empty — do not guess.
Priority is "high" only for urgent or deadline-imminent items, "low" for someday/whenever items, otherwise "normal".

Message (from ${sender || 'unknown sender'}, via ${source || 'sms'}):
"""
${text}
"""`;
}

// Returns the parsed classification object { is_task, confidence, tasks }.
// Throws on missing key, HTTP error, or an unparseable reply; a reply that
// parses but has malformed fields gets TaskVerdict's defaults. `llm` is
// ctx.llm. The model defaults to GEMINI_MODEL; config can override it.
export async function classifyMessage(llm, envelope, { model } = {}) {
  return llm.generateObject({
    schema: TaskVerdict,
    prompt: buildPrompt(envelope),
    model,
    // temperature 0 makes classification deterministic — the same
    // message always gets the same verdict, so borderline imperatives
    // like "bring me dinner" stop flip-flopping between runs.
    temperature: 0,
  });
}

// ---- delivery ----

// "Jul 4 2026" / "14:32" in the configured timezone, matching the brief header.
function receivedParts(receivedAt, timeZone) {
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

// Anyone can text the owner, and the Task template places these values
// in HTML, so every value taken from a message is escaped first: a
// "<img src=...>" prints as those characters instead of making Satori
// fetch the URL. Escaping here, not in the template, covers the Task
// template every account already stores. The renderer turns the entities
// back into characters in text (render/render-core.js).
export { escapeHtml };

// envelope v1 = { text, sender?, source?, receivedAt? }; text is non-blank
// (the runner answers blank text itself). Returns the reply for the sender:
// { task: false, confidence } or { task: true, printed, jobs }. A throw
// fails the delivery: the runner records lastError and the sender gets 502.
export async function onMessage(envelope, { config, state, ctx }) {
  const { text, sender, source, receivedAt } = envelope;
  const cfg = { ...defaults.config, ...(config || {}) };
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

  let verdict;
  try {
    verdict = await classifyMessage(
      ctx.llm,
      { text: classifyText, sender, source, receivedAt },
      { model: cfg.geminiModel },
    );
  } catch (err) {
    if (!forced) throw err; // lastError shows the classifier's message
    ctx.log(`classify failed, printing anyway: ${err.message}`);
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
    return { state, reply: { task: false, confidence: verdict.confidence ?? 0 } };
  }

  // One slip per task: Gemini has already grouped related items together and
  // split unrelated tasks apart, so each entry prints on its own.
  const tpl = await ctx.getTemplate('Task');
  if (!tpl) throw new Error('Task template missing');
  const { date, time } = receivedParts(receivedAt, cfg.timezone);
  const printed = [];
  for (const t of tasks) {
    const title = t.title || text.slice(0, 80);
    const items = Array.isArray(t.items) ? t.items.filter(Boolean) : [];
    const data = {
      title: escapeHtml(title),
      items: items.map(escapeHtml),
      ordered: !!t.ordered,
      sender: escapeHtml(sender || 'unknown'),
      date,
      time,
      due: escapeHtml(t.due || ''),
      priority: escapeHtml(t.priority || 'normal'),
      quote: escapeHtml(t.quote || ''),
    };
    const job = await ctx.createJob({
      template: tpl.template,
      data,
      name: `Task: ${title}`,
      source: source || 'sms',
    });
    printed.push({ id: job.id, title });
  }

  return { state, reply: { task: true, printed: printed.length, jobs: printed } };
}
