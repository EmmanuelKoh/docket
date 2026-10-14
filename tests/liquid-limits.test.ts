// tests/liquid-limits.test.ts — a template is account input, so one
// render is bounded (render/render-core.js LIQUID_LIMITS): its source
// length, the wall time of the fill (checked between tags), Liquid's
// allocation units (range sizes, arrays and strings that filters and
// captures build, and the property lookups a filter does per item), and the
// length of the filled-in HTML. A template past a limit fails fast with an
// error that names the limit, both where jobs render (renderToEscpos) and
// where the Studio previews (POST /preview, answered 400). Every reference
// template stays far inside each limit: it renders under limits 20 to
// 1,000 times tighter.

import fs from 'node:fs';
import path from 'node:path';
import { Liquid } from 'liquidjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as previewRoute } from '@/app/preview/route';
import {
  FILL_OUTPUT_LIMIT,
  fill,
  LIQUID_LIMITS,
  renderToEscpos,
} from '@/render/render-core.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/golden-escpos.test.ts does), so a developer's .env cannot change
// what renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/liquid-limits`;
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

vi.mock('@/lib/auth-server.js', () => import('./helpers/fake-auth'));

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const ROOT = path.resolve(__dirname, '..');

type RefTemplate = {
  name: string;
  template: string;
  data: Record<string, unknown>;
};

const REFERENCE = ['starter', 'wc', 'brief', 'photo', 'task'].flatMap((set) => {
  const file = path.join(ROOT, 'reference', `${set}-templates.json`);
  const list: RefTemplate[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return list.map((t) => [`${set}/${t.name}`, t] as const);
});

const wrap = (body: string) =>
  `<div style="display:flex;font-size:28px">${body}</div>`;

// Assigns v the seed doubled n times.
const double = (v: string, seed: string, n: number) =>
  `{% assign ${v} = "${seed}" %}{% for i in (1..${n}) %}{% assign ${v} = ${v} | append: ${v} %}{% endfor %}`;

// Each one trips exactly one limit. budgetMs is how long failing may take.
const PATHOLOGICAL = [
  {
    limit: 'parseLimit',
    template: wrap('x'.repeat(LIQUID_LIMITS.parseLimit)),
    message: /^template is longer than 100,000 characters/,
    budgetMs: 200,
  },
  {
    limit: 'renderLimit',
    // 9 million iterations: under the memory limit, past the time limit.
    template: wrap(
      '{% for a in (1..3000) %}{% for b in (1..3000) %}x{% endfor %}{% endfor %}',
    ),
    message: /^template took longer than 1,000 ms to fill, line:1, col:\d+/,
    budgetMs: LIQUID_LIMITS.renderLimit + 1500,
  },
  {
    limit: 'memoryLimit',
    template: wrap('{% for i in (1..1000000000) %}x{% endfor %}'),
    message:
      /^template built more than 10,000,000 items \(loop ranges, captures, filter results and per-item property lookups\), line:1, col:\d+/,
    budgetMs: 200,
  },
  {
    limit: 'memoryLimit',
    // Doubling a string: 10 characters to 10 billion in 30 appends.
    template: wrap(
      '{% assign s = "xxxxxxxxxx" %}{% for i in (1..30) %}{% assign s = s | append: s %}{% endfor %}{{ s | size }}',
    ),
    message: /^template built more than 10,000,000 items/,
    budgetMs: 200,
  },
  {
    limit: 'memoryLimit',
    // Doubling a capture: 36 characters to 300 million in 23 passes,
    // which Liquid alone does not count.
    template: wrap(
      '{% capture s %}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx{% endcapture %}{% for i in (1..23) %}{% capture s %}{{s}}{{s}}{% endcapture %}{% endfor %}{{ s }}',
    ),
    message:
      /^template built more than 10,000,000 items \(loop ranges, captures, filter results and per-item property lookups\), line:1, col:\d+/,
    budgetMs: 200,
  },
  {
    limit: 'memoryLimit',
    // A 1-million-character property path ("a.a.a...") read on each of
    // 2,048 items: 246 characters of source, and Liquid alone charges only
    // the item count, so map ran for minutes. sort, where, sum and the
    // rest walk the path the same way.
    template: wrap(
      `${double('p', 'a.', 19)}${double('s', 'x,', 11)}{% assign arr = s | split: "," %}{% assign r = arr | map: p %}{{ r | size }}`,
    ),
    message:
      /^template built more than 10,000,000 items \(loop ranges, captures, filter results and per-item property lookups\), line:1, col:\d+/,
    budgetMs: 200,
  },
  {
    limit: 'memoryLimit',
    // An _exp filter runs its expression once per item.
    template: wrap(
      `${double('s', 'x,', 11)}{% assign arr = s | split: "," %}{{ arr | where_exp: "i", "${'i.a.'.repeat(20_000)}b" | size }}`,
    ),
    message: /^template built more than 10,000,000 items/,
    budgetMs: 200,
  },
  {
    limit: 'output length',
    // Under the memory limit (5,000 range items, one 3,300-character
    // capture), but 16.5 million characters of output.
    template: wrap(
      `{% capture s %}${'<div style="display:flex">x</div>'.repeat(100)}{% endcapture %}{% for i in (1..5000) %}{{ s }}{% endfor %}`,
    ),
    message: /^template filled in to more than 5,000,000 characters/,
    budgetMs: 500,
  },
];

describe('Liquid limits', () => {
  it('are the values the reference templates were measured against', () => {
    expect(LIQUID_LIMITS).toEqual({
      parseLimit: 100_000,
      renderLimit: 1_000,
      memoryLimit: 10_000_000,
    });
    expect(FILL_OUTPUT_LIMIT).toBe(5_000_000);
  });

  it.each(REFERENCE)('%s renders far inside every limit', async (_, t) => {
    const tight = new Liquid({
      templates: Object.create(null),
      parseLimit: LIQUID_LIMITS.parseLimit / 20,
      renderLimit: LIQUID_LIMITS.renderLimit / 10,
      memoryLimit: LIQUID_LIMITS.memoryLimit / 1000,
    });
    const out = await tight.parseAndRender(t.template, t.data);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(FILL_OUTPUT_LIMIT / 1000);
  });

  it.each(
    PATHOLOGICAL.map((p) => [p.limit, p] as const),
  )('renderToEscpos fails fast past %s, naming the limit', async (_, {
    template,
    message,
    budgetMs,
  }) => {
    // fill alone fails first, so a regression fails here instead of
    // handing Satori a runaway page (its layout blocks, and the run hangs).
    await expect(fill(template, {})).rejects.toThrow(message);
    const started = performance.now();
    const err = await renderToEscpos(template, {}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(performance.now() - started).toBeLessThan(budgetMs);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(message);
  });

  it.each(
    PATHOLOGICAL.map((p) => [p.limit, p] as const),
  )('POST /preview answers 400 past %s, naming the limit', async (_, {
    template,
    message,
    budgetMs,
  }) => {
    await expect(fill(template, {})).rejects.toThrow(message);
    const started = performance.now();
    const res = await previewRoute(
      new Request('http://docket.test/preview', {
        method: 'POST',
        headers: { 'x-test-user': 'owner-liquid-limits:user' },
        body: JSON.stringify({ template, data: {} }),
      }),
    );
    expect(performance.now() - started).toBeLessThan(budgetMs);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(
      new RegExp(message.source.replace(/^\^/, '')),
    );
  });

  it('still renders after a template hit a limit', async () => {
    await expect(
      renderToEscpos(PATHOLOGICAL[2].template, {}),
    ).rejects.toThrow();
    const { bytes, height } = await renderToEscpos(
      wrap('{% for i in (1..3) %}{{ i }}{% endfor %} {{ who | upcase }}'),
      { who: 'milk' },
    );
    expect(bytes.length).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('charges per-item filters without changing what they return', async () => {
    const items = [
      { name: 'a', n: 3 },
      { name: 'b', n: 1 },
      { name: 'c', n: 2 },
    ];
    const out = await fill(
      [
        '{{ items | map: "name" | join: "," }}',
        '{{ items | sort: "n" | map: "name" | join: "," }}',
        '{{ items | sort_natural: "name" | map: "n" | join: "," }}',
        '{{ items | where: "n", 2 | map: "name" | join: "," }}',
        '{{ items | reject: "n", 2 | size }}',
        '{{ items | sum: "n" }}',
        '{{ items | group_by: "n" | size }}',
        '{{ items | has: "n", 1 }}',
        '{{ items | find: "n", 3 | map: "name" }}',
        '{{ items | find_index: "n", 2 }}',
        '{{ items | where_exp: "i", "i.n > 1" | size }}',
        '{{ items | reject_exp: "i", "i.n > 1" | size }}',
        '{{ items | group_by_exp: "i", "i.n" | size }}',
        '{{ items | has_exp: "i", "i.n == 2" }}',
        '{{ items | find_exp: "i", "i.n == 1" | map: "name" }}',
        '{{ items | find_index_exp: "i", "i.n == 1" }}',
      ].join(' '),
      { items },
    );
    expect(out).toBe('a,b,c b,c,a 3,1,2 c 2 6 3 true a 2 2 1 3 true b 1');
  });

  it('counts captures without breaking them', async () => {
    const out = await fill(
      '{% capture t %}Hello {{ who }}{% endcapture %}{% capture t %}{{ t }}!{% endcapture %}<b>{{ t }}</b>',
      { who: 'milk' },
    );
    expect(out).toBe('<b>Hello milk!</b>');
  });

  it("lets a Photo print's data: URI through at the request cap", async () => {
    const [photo] = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'reference', 'photo-templates.json'),
        'utf8',
      ),
    ) as RefTemplate[];
    // About 4.7 million characters: a 4.5 MiB request body, all image.
    const uri = `data:image/jpeg;base64,${'A'.repeat(4.5 * 1024 * 1024)}`;
    const out = await fill(photo.template, { ...photo.data, photo: uri });
    expect(out.length).toBeGreaterThan(uri.length);
    expect(out.length).toBeLessThan(FILL_OUTPUT_LIMIT);
  });
});
