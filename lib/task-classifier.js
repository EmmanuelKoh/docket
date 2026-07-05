// lib/task-classifier.js — "does this message contain a task?"
// One Gemini generateContent call with a response schema, so the reply is
// guaranteed to parse into { is_task, title, due, priority, quote,
// confidence }. Plain fetch against the REST API — no SDK dependency.
//
// Channel-agnostic on purpose: SMS today, Slack/email adapters later all
// call classifyMessage() with the same normalized envelope.

import { GEMINI_API_KEY, GEMINI_MODEL } from '../config.js';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_task: { type: 'BOOLEAN', description: 'True only if the message asks the recipient to do something or records a commitment they must act on.' },
    title: { type: 'STRING', description: 'Short imperative task title, e.g. "Renew car insurance". Empty if not a task.' },
    due: { type: 'STRING', description: 'Due date as YYYY-MM-DD if one is stated or clearly implied, else empty.' },
    priority: { type: 'STRING', enum: ['low', 'normal', 'high'] },
    quote: { type: 'STRING', description: 'The exact phrase from the message that makes it a task. Empty if not a task.' },
    confidence: { type: 'NUMBER', description: '0-1 confidence that this classification is correct.' },
  },
  required: ['is_task', 'confidence'],
};

function buildPrompt({ text, sender, source, receivedAt }) {
  const today = (receivedAt ? new Date(receivedAt) : new Date()).toISOString().slice(0, 10);
  return `You triage incoming personal messages for the recipient and decide whether each one contains a task — something the recipient must do or act on.

Count as tasks: direct requests or commands addressed to the recipient — including short imperatives with no deadline ("bring me dinner", "call me back", "pick up milk") — reminders with an action ("insurance is due next week"), commitments the recipient made ("you said you'd bring the cables"), appointments requiring preparation. A message that tells the recipient to do something is a task even when it is brief and has no date.
Do NOT count: pure FYIs, greetings, marketing/OTP/notification spam, questions answerable with a quick reply and no follow-up action, delivery status updates.

Resolve relative dates against today: ${today}. If no date is stated or clearly implied, leave "due" empty — do not guess.
Priority is "high" only for urgent or deadline-imminent items, "low" for someday/whenever items, otherwise "normal".

Message (from ${sender || 'unknown sender'}, via ${source || 'sms'}):
"""
${text}
"""`;
}

// Returns the parsed classification object. Throws on missing key, HTTP
// error, or an unparseable reply — callers decide whether that fails the
// request or degrades gracefully.
export async function classifyMessage(envelope) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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
