// tests/llm/gemini.test.ts — the classifier on the LLM seam (now in
// plugins/message-ingest.js, called with ctx.llm) sends the same Gemini
// request it sent before the seam, gives up after 45 seconds, parses a
// malformed reply to its lenient defaults, and the Zod -> Gemini schema
// translation refuses what Gemini's dialect would reject.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toGeminiSchema } from '@/lib/llm/gemini.js';
import { generateObject } from '@/lib/llm/index.js';
import { classifyMessage as classify } from '@/plugins/message-ingest.js';

// Own DATA_DIR subfolder; a fake key and a fixed default model before
// config.js loads, so a developer's .env cannot change the request.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/llm-gemini`;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-test-model';
});

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Copied verbatim from lib/task-classifier.js:14-67 as it was before the
// seam (TASK_SCHEMA and RESPONSE_SCHEMA), key order included. That file is
// gone; its prompt and schema live in plugins/message-ingest.js.
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

const ENVELOPE = {
  text: 'pick up milk tomorrow',
  sender: 'Alice',
  source: 'sms',
  receivedAt: '2026-10-12T15:00:00Z',
};

// The plugin's classifier with the real seam as its ctx.llm.
const classifyMessage = (
  envelope: typeof ENVELOPE,
  opts: { model?: string } = {},
) => classify({ generateObject }, envelope, opts);

// A Gemini generateContent reply whose candidate text is `reply` as JSON.
function geminiReply(reply: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function stubGemini(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  });
  return calls;
}

describe('classifyMessage request', () => {
  it('sends the same URL, key header and body as before the seam', async () => {
    const calls = stubGemini(() =>
      geminiReply({ is_task: true, confidence: 0.9, tasks: [] }),
    );
    await classifyMessage(ENVELOPE);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'test-gemini-key',
    });

    const body = JSON.parse(String(init.body));
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain(
      'Resolve relative dates against today: 2026-10-12.',
    );
    expect(prompt).toContain(
      'Message (from Alice, via sms):\n"""\npick up milk tomorrow\n"""',
    );
    const expected = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    };
    expect(body).toEqual(expected);
    // Byte for byte, key order included.
    expect(init.body).toBe(JSON.stringify(expected));
  });

  it('a per-call model overrides GEMINI_MODEL in the URL', async () => {
    const calls = stubGemini(() =>
      geminiReply({ is_task: false, confidence: 0.9, tasks: [] }),
    );
    await classifyMessage(ENVELOPE, { model: 'gemini-other' });
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-other:generateContent',
    );
  });

  it('a non-2xx reply throws with the status', async () => {
    stubGemini(() => new Response('quota exceeded', { status: 429 }));
    await expect(classifyMessage(ENVELOPE)).rejects.toThrow(
      'Gemini 429: quota exceeded',
    );
  });

  it('gives up after 45 seconds with a plain error, so the caller fails inside the 60s function limit', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const calls = stubGemini(() =>
        geminiReply({ is_task: false, confidence: 0.9, tasks: [] }),
      );
      await classifyMessage(ENVELOPE);
      expect(timeout).toHaveBeenCalledWith(45_000);
      expect(calls[0].init.signal).toBe(timeout.mock.results[0].value);

      // What fetch throws when that signal fires.
      vi.stubGlobal('fetch', async () => {
        throw new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        );
      });
      await expect(classifyMessage(ENVELOPE)).rejects.toThrow(
        'Gemini timed out after 45s',
      );
    } finally {
      timeout.mockRestore();
    }
  });

  it('a reply that is not an object throws', async () => {
    stubGemini(() => geminiReply(null));
    await expect(classifyMessage(ENVELOPE)).rejects.toThrow(
      'model reply does not match the schema',
    );
  });
});

describe('classifyMessage reply parsing is lenient per field', () => {
  it('due: null drops due and keeps the task', async () => {
    stubGemini(() =>
      geminiReply({
        is_task: true,
        confidence: 0.9,
        tasks: [{ title: 'Pick up milk', due: null, priority: 'high' }],
      }),
    );
    const verdict = await classifyMessage(ENVELOPE);
    expect(verdict).toEqual({
      is_task: true,
      confidence: 0.9,
      tasks: [{ title: 'Pick up milk', priority: 'high' }],
    });
    expect(verdict.tasks[0].due).toBeUndefined();
  });

  it('a missing tasks array becomes []', async () => {
    stubGemini(() => geminiReply({ is_task: true, confidence: 0.9 }));
    expect(await classifyMessage(ENVELOPE)).toEqual({
      is_task: true,
      confidence: 0.9,
      tasks: [],
    });
  });

  it('a string confidence becomes 0', async () => {
    stubGemini(() =>
      geminiReply({
        is_task: true,
        confidence: '0.9',
        tasks: [{ title: 'Pick up milk' }],
      }),
    );
    expect(await classifyMessage(ENVELOPE)).toEqual({
      is_task: true,
      confidence: 0,
      tasks: [{ title: 'Pick up milk' }],
    });
  });
});

describe('toGeminiSchema', () => {
  const gemini = (schema: z.ZodType) =>
    toGeminiSchema(z.toJSONSchema(schema, { io: 'input' }));
  const unsupported = /unsupported construct/;

  it('throws on .nullable()', () => {
    expect(() => gemini(z.object({ due: z.string().nullable() }))).toThrow(
      unsupported,
    );
  });

  it('throws on a union', () => {
    expect(() =>
      gemini(z.object({ when: z.union([z.string(), z.number()]) })),
    ).toThrow(unsupported);
    expect(() =>
      gemini(
        z.union([
          z.object({ title: z.string() }),
          z.object({ items: z.array(z.string()) }),
        ]),
      ),
    ).toThrow(unsupported);
  });

  it('throws on a literal', () => {
    expect(() => gemini(z.object({ kind: z.literal('task') }))).toThrow(
      unsupported,
    );
  });
});
