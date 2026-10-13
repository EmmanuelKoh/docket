// lib/llm/gemini.js: Gemini generateContent over REST, no SDK (the same request
// the message classifier, now in plugins/message-ingest.js, sent before the seam).
import { GEMINI_API_KEY, GEMINI_MODEL } from '../../config.js';

// JSON Schema (from Zod) -> Gemini's Schema dialect ('OBJECT', 'STRING', ...).
// Throws at translation time on what Gemini's dialect would reject at call time.
export function toGeminiSchema(s) {
  if (!s.type || Array.isArray(s.type) || s.anyOf || s.oneOf || 'const' in s || s.$ref) {
    throw new Error('Gemini schema: unsupported construct (plain types only; see lib/llm/index.js)');
  }
  const out = { type: String(s.type).toUpperCase() };
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.enum) out.enum = s.enum;
  if (s.description) out.description = s.description;
  if (s.required?.length) out.required = s.required;
  return out;
}

// A hung call must fail inside the function limit (/ingest's maxDuration is
// 60s), so the caller's failure path runs: messages.deliver releases its
// duplicate claim and the sender's retry prints. The signal covers the body
// read too.
export const TIMEOUT_MS = 45_000;

export async function generateJson({ jsonSchema, prompt, model, temperature }) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: toGeminiSchema(jsonSchema) },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no candidate text');
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error(`Gemini timed out after ${TIMEOUT_MS / 1000}s`);
    throw err;
  }
}
