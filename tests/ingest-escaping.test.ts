// tests/ingest-escaping.test.ts — a forwarded text is stranger input, so
// message-ingest escapes every value it takes from a message (sender,
// classifier title, items, quote, due, priority, and the raw text a
// forced "task:" prints) before the Task template sees it. Markup in a
// message then prints as text: no element is made from it and Satori
// fetches nothing. The renderer decodes the escaped characters in text
// only, so "Milk & eggs" prints the same as before. The entities it
// decodes are exactly the ones docs/template-authoring.md lists.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { escapeHtml, onMessage } from '@/plugins/message-ingest.js';
import { unescapeHtml } from '@/render/escape-html.js';
import { fill, renderToEscpos, toElement } from '@/render/render-core.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/golden-escpos.test.ts does), so a developer's .env cannot change
// what renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ingest-escaping`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

// Every fetch the renderer makes lands here and fails.
const fetched: string[] = [];
beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    fetched.push(String(input));
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const TASK_TEMPLATE: string = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'reference', 'task-templates.json'),
    'utf8',
  ),
).find((t: { name: string }) => t.name === 'Task').template;

const IMG = '<img src="http://example.test/x">';
const DIV =
  '<div style="display:flex;background-image:url(http://example.test/bg)">hi</div>';

type Job = { template: string; data: Record<string, unknown>; name: string };

// onMessage with a classifier that answers `verdict` (or throws when it is
// an Error), recording each job it creates.
async function deliver(
  envelope: Record<string, unknown>,
  verdict: Record<string, unknown> | Error,
) {
  const jobs: Job[] = [];
  const ctx = {
    llm: {
      generateObject: async () => {
        if (verdict instanceof Error) throw verdict;
        return structuredClone(verdict);
      },
    },
    getTemplate: async () => ({ name: 'Task', template: TASK_TEMPLATE }),
    createJob: async (job: Job) => {
      jobs.push(job);
      return { id: `job-${jobs.length}` };
    },
    log: () => {},
  };
  const result = await onMessage(envelope, { config: {}, state: {}, ctx });
  return { result, jobs };
}

// Every element type and every text string in a Satori element tree.
type Node = { type?: string; props?: { children?: unknown } };
function walk(node: unknown, types: string[] = [], texts: string[] = []) {
  if (typeof node === 'string') texts.push(node);
  else if (Array.isArray(node)) for (const n of node) walk(n, types, texts);
  else if (node && typeof node === 'object') {
    const el = node as Node;
    if (el.type) types.push(el.type);
    walk(el.props?.children, types, texts);
  }
  return { types, texts };
}

const treeOf = async (job: Job) =>
  walk(toElement(await fill(job.template, job.data)));

const hostile = {
  is_task: true,
  confidence: 0.99,
  tasks: [
    {
      title: `Buy ${IMG}`,
      items: [IMG, DIV],
      ordered: false,
      due: `<b>2026-10-14</b>`,
      priority: `<i>high</i>`,
      quote: `"${DIV}" & 'more'`,
    },
  ],
};

describe('message-ingest escapes message text', () => {
  it('escapes every message-derived field; the job name stays raw', async () => {
    const { jobs } = await deliver(
      { text: 'whatever', sender: `Eve ${IMG}`, source: 'sms' },
      hostile,
    );
    expect(jobs).toHaveLength(1);
    const { data, name } = jobs[0];
    const t = hostile.tasks[0];
    expect(data).toMatchObject({
      title: escapeHtml(t.title),
      items: t.items.map(escapeHtml),
      sender: escapeHtml(`Eve ${IMG}`),
      due: escapeHtml(t.due),
      priority: escapeHtml(t.priority),
      quote: escapeHtml(t.quote),
    });
    for (const v of [data.title, data.sender, data.due, data.quote]) {
      expect(v).not.toMatch(/[<>"']/);
    }
    // The dashboard shows the name as text (React escapes it).
    expect(name).toBe(`Task: ${t.title}`);
  });

  it('markup in a message renders as text, with no element made from it', async () => {
    const { jobs } = await deliver(
      { text: 'whatever', sender: `Eve ${IMG}` },
      hostile,
    );
    const { types, texts } = await treeOf(jobs[0]);
    expect(types).not.toContain('img');
    expect(types.filter((x) => x !== 'div')).toEqual([]);
    const t = hostile.tasks[0];
    for (const s of [t.title, IMG, DIV, `Eve ${IMG}`, t.due]) {
      expect(texts).toContain(s);
    }
    expect(texts).toContain(`“${t.quote}”`);
  });

  it('the renderer never calls fetch for it', async () => {
    const { jobs } = await deliver(
      { text: 'whatever', sender: `Eve ${IMG}` },
      hostile,
    );
    fetched.length = 0;
    const { bytes, height } = await renderToEscpos(
      jobs[0].template,
      jobs[0].data,
    );
    expect(bytes.length).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(fetched).toEqual([]);
  });

  it('a forced task: with the classifier down prints its raw text as text', async () => {
    const { result, jobs } = await deliver(
      { text: `task: ${IMG} ${DIV}`, sender: 'Bob' },
      new Error('classifier down'),
    );
    expect(result.reply).toMatchObject({ task: true, printed: 1 });
    expect(jobs[0].data.title).toBe(escapeHtml(`${IMG} ${DIV}`));
    const { types, texts } = await treeOf(jobs[0]);
    expect(types).not.toContain('img');
    expect(texts).toContain(`${IMG} ${DIV}`);
    fetched.length = 0;
    await renderToEscpos(jobs[0].template, jobs[0].data);
    expect(fetched).toEqual([]);
  });

  it('the same values unescaped would have made elements (the hazard this guards)', async () => {
    const { jobs } = await deliver(
      { text: 'whatever', sender: 'Eve' },
      hostile,
    );
    const raw = { ...jobs[0].data, title: IMG, items: [DIV] };
    const { types } = walk(toElement(await fill(TASK_TEMPLATE, raw)));
    expect(types).toContain('img');
  });
});

describe('the renderer decodes escaped text', () => {
  const one = async (value: string) =>
    walk(
      toElement(
        await fill('<div style="display:flex">{{ v }}</div>', { v: value }),
      ),
    ).texts;

  it('prints exactly what was escaped, including text that looks escaped', async () => {
    for (const s of [
      'Milk & eggs',
      'Tom &amp; Jerry',
      '&lt;b&gt; stays',
      `5 > 3 < 4 "q" 'a'`,
      '&#39; and &nbsp;',
    ]) {
      expect(await one(escapeHtml(s))).toEqual([s]);
    }
  });

  it("decodes Liquid's escape filter output too", async () => {
    const texts = walk(
      toElement(
        await fill('<div style="display:flex">{{ v | escape }}</div>', {
          v: `<a href="x">'it'</a> & co`,
        }),
      ),
    ).texts;
    expect(texts).toEqual([`<a href="x">'it'</a> & co`]);
  });

  it('leaves other entities as typed', async () => {
    const texts = walk(
      toElement('<div style="display:flex">a&nbsp;b &#8226; &copy;</div>'),
    ).texts;
    expect(texts).toEqual(['a&nbsp;b &#8226; &copy;']);
  });

  it('decodes exactly the entities docs/template-authoring.md lists', () => {
    const doc = fs.readFileSync(
      path.join(__dirname, '..', 'docs', 'template-authoring.md'),
      'utf8',
    );
    const list = doc
      .split('these entities print as the character they stand for:')[1]
      .split('\n\n')[1];
    const documented = [...list.matchAll(/`(&[^`]+;)`/g)].map((m) => m[1]);
    expect(documented).toHaveLength(15);

    // Every named, decimal and hex entity for code points below 256, as
    // the doc writes them (lowercase), plus zero-padded forms.
    const candidates = ['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp', 'copy']
      .map((n) => `&${n};`)
      .concat(
        Array.from({ length: 256 }, (_, i) => [
          `&#${i};`,
          `&#0${i};`,
          `&#x${i.toString(16)};`,
          `&#x0${i.toString(16)};`,
        ]).flat(),
      );
    const decoded = candidates.filter((e) => unescapeHtml(e) !== e);
    expect(new Set(decoded)).toEqual(new Set(documented));
    for (const e of documented) {
      expect('"&\'<>').toContain(unescapeHtml(e));
      // "in any letter case"
      expect(unescapeHtml(e.toUpperCase())).toBe(unescapeHtml(e));
    }
  });

  it('escaped plain text prints the same bytes as before escaping', async () => {
    const template = '<div style="display:flex;font-size:28px">{{ v }}</div>';
    const plain = await renderToEscpos(template, { v: 'Milk & eggs, 2 > 1' });
    const escaped = await renderToEscpos(template, {
      v: escapeHtml('Milk & eggs, 2 > 1'),
    });
    expect(Buffer.from(escaped.bytes).equals(Buffer.from(plain.bytes))).toBe(
      true,
    );
  });
});
