// lib/task-classifier.js — "what tasks does this message contain?"
// One Gemini generateContent call with a response schema, so the reply is
// guaranteed to parse into { is_task, confidence, tasks: [...] }. Plain
// fetch against the REST API — no SDK dependency.
//
// A single message can produce more than one slip: Gemini groups related
// actions or items onto one task (a shopping list, the steps of a routine)
// and splits unrelated tasks into separate ones. Each task becomes its own
// printed slip. Channel-agnostic on purpose: SMS today, Slack/email
// adapters later all call classifyMessage() with the same envelope.

import { GEMINI_API_KEY, GEMINI_MODEL } from '../config.js';

const TASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: {
      type: 'STRING',
      description:
        'Heading for this slip: a short imperative for a single action ("Renew car insurance"), or a name for a group of related items ("Grocery list", "Before leaving").',
    },
    items: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description:
        'The related sub-items or steps that belong on this one slip, each a short phrase. Leave empty for a single-action task.',
    },
    ordered: {
      type: 'BOOLEAN',
      description:
        'True ONLY when the items must be done in sequence (steps); false for an unordered list such as shopping.',
    },
    due: {
      type: 'STRING',
      description:
        'Due date as YYYY-MM-DD if stated or clearly implied for this task, else empty.',
    },
    priority: { type: 'STRING', enum: ['low', 'normal', 'high'] },
    quote: {
      type: 'STRING',
      description:
        'The exact phrase from the message that makes this a task. Empty if none.',
    },
  },
  required: ['title'],
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_task: {
      type: 'BOOLEAN',
      description: 'True if the message contains at least one task.',
    },
    confidence: {
      type: 'NUMBER',
      description: '0-1 confidence that this classification is correct.',
    },
    tasks: {
      type: 'ARRAY',
      items: TASK_SCHEMA,
      description:
        'One entry per distinct task. Related actions or items are grouped into a single entry (with its items filled in); unrelated tasks are separate entries. Empty when is_task is false.',
    },
  },
  required: ['is_task', 'confidence', 'tasks'],
};

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
// Throws on missing key, HTTP error, or an unparseable reply — callers
// decide whether that fails the request or degrades gracefully. The model
// defaults to GEMINI_MODEL but callers can override it per call.
export async function classifyMessage(envelope, { model } = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(envelope) }] }],
      generationConfig: {
        // temperature 0 makes classification deterministic — the same
        // message always gets the same verdict, so borderline imperatives
        // like "bring me dinner" stop flip-flopping between runs.
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no candidate text');
  return JSON.parse(text);
}
