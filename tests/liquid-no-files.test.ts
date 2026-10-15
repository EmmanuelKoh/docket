// tests/liquid-no-files.test.ts — a template is account input, so Liquid
// must never read a file. render, include and layout fail whatever name
// they get (a repo file, a traversal, an absolute path, an Object
// prototype key), both where jobs render (renderToEscpos) and where the
// Studio previews (POST /preview, answered 400). A name fails with
// "Failed to lookup"; an empty, unset or missing one with "illegal file
// path" (the two errors docs/template-authoring.md lists). Neither the
// thrown error nor the response carries the file's contents.
// {% layout none %} names no file and still renders. Filters and ordinary
// templates still render; tests/golden-escpos.test.ts pins their bytes.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as previewRoute } from '@/app/preview/route';
import { renderToEscpos } from '@/render/render-core.js';

// PRINT_WIDTH and FONT_DIR forced to their defaults (as
// tests/golden-escpos.test.ts does), so a developer's .env cannot change
// what renders.
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/liquid-no-files`;
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

// Lines that appear only in the files the probes name.
const LEAKS = [
  ['LICENSE', 'Permission is hereby granted'],
  ['package.json', '"private": true'],
];

const wrap = (body: string) =>
  `<div style="display:flex;font-size:28px">${body}</div>`;

const PROBES = [
  "{% render 'package.json' %}",
  "{% include 'LICENSE' %}",
  "{% layout 'x' %}body",
  "{% layout 'LICENSE' %}body",
  "{% render '../docket/LICENSE' %}",
  "{% render './package.json' %}",
  "{% assign f = 'LICENSE' %}{% include f %}",
  "{% render '/etc/hosts' %}",
  "{% render 'constructor' %}",
  "{% include 'toString' %}",
  "{% layout '__proto__' %}body",
].map(wrap);

const noLeak = (text: string, probe: string) => {
  for (const [, leak] of LEAKS) expect(text, probe).not.toContain(leak);
};

describe('Liquid reads no files', () => {
  it('probes real files from the directory the default loader reads', () => {
    expect(process.cwd()).toBe(ROOT);
    for (const [file, leak] of LEAKS) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toContain(leak);
    }
  });

  it('renderToEscpos rejects render, include and layout without leaking', async () => {
    for (const probe of PROBES) {
      const err = await renderToEscpos(probe, {}).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, probe).toBeInstanceOf(Error);
      expect((err as Error).message, probe).toMatch(/Failed to lookup/);
      noLeak(String((err as Error).message), probe);
      noLeak(String((err as Error).stack), probe);
    }
  });

  it('POST /preview answers 400 without leaking', async () => {
    for (const probe of PROBES) {
      const res = await previewRoute(
        new Request('http://docket.test/preview', {
          method: 'POST',
          headers: { 'x-test-user': 'owner-liquid-files:user' },
          body: JSON.stringify({ template: probe, data: {} }),
        }),
      );
      expect(res.status, probe).toBe(400);
      expect(res.headers.get('content-type'), probe).toMatch(/json/);
      const body = await res.text();
      expect(body, probe).toMatch(/Failed to lookup/);
      noLeak(body, probe);
    }
  });

  it('an empty, unset or missing name fails with illegal file path', async () => {
    for (const probe of [
      "{% render '' %}",
      '{% include unset %}',
      "{% layout '' %}body",
      '{% render %}',
    ].map(wrap)) {
      const err = await renderToEscpos(probe, {}).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, probe).toBeInstanceOf(Error);
      expect((err as Error).message, probe).toMatch(/illegal file path/);
    }
  });

  it('{% layout none %} names no file and still renders', async () => {
    const { bytes, height } = await renderToEscpos(
      wrap('{% layout none %}{% block main %}plain{% endblock %}'),
      {},
    );
    expect(bytes.length).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('still renders filters and ordinary templates', async () => {
    const template = wrap(
      "{{ who | upcase }} {{ n | plus: 4 }} {{ missing | default: 'none' }}",
    );
    const { bytes, height } = await renderToEscpos(template, {
      who: 'milk',
      n: 3,
    });
    expect(bytes.length).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    const res = await previewRoute(
      new Request('http://docket.test/preview', {
        method: 'POST',
        headers: { 'x-test-user': 'owner-liquid-files:user' },
        body: JSON.stringify({ template, data: { who: 'milk', n: 3 } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});
