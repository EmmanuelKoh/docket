// tests/route-config.test.ts — route segment config stays in the route
// file, where Next.js reads it, when a route becomes a thin adapter over
// lib/. maxDuration = 60 covers renders and plugin runs; EXPECTED below
// lists every route that needs a segment config. And next.config.mjs's file
// tracing keys are picomatch globs: each must match the route it names,
// or the route deploys without the files (an unescaped [...all] is a
// character class that never matches).

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import nextConfig from '@/next.config.mjs';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/route-config`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const ROOT = path.resolve(__dirname, '..');
const MAX_DURATION = 'export const maxDuration = 60;';
const FORCE_DYNAMIC = "export const dynamic = 'force-dynamic';";

const EXPECTED: Array<[string, string]> = [
  ['app/tick/route.ts', MAX_DURATION],
  ['app/ingest/route.ts', MAX_DURATION],
  ['app/jobs/route.ts', MAX_DURATION],
  ['app/preview/route.ts', MAX_DURATION],
  ['app/api/templates/thumb/route.ts', MAX_DURATION],
  ['app/api/slips/print-test/route.ts', MAX_DURATION],
  ['app/next/route.ts', FORCE_DYNAMIC],
  ['app/(dashboard)/users/page.tsx', FORCE_DYNAMIC],
];

it.each(EXPECTED)('%s keeps `%s`', (file, line) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  expect(source.split('\n').map((l) => l.trim())).toContain(line);
});

// Next.js matches each key against the entry's app path, e.g.
// /app/slips/[slug] (node_modules/next/dist/build/collect-build-traces.js:
// picomatch with dot and contains, against normalizeAppPath of the entry).
const picomatch = createRequire(import.meta.url)(
  'next/dist/compiled/picomatch',
) as (glob: string, opts: object) => (s: string) => boolean;

it.each(
  Object.keys(nextConfig.outputFileTracingIncludes ?? {}),
)('tracing key %s matches the route it names', (key) => {
  const route = `/app${key.replace(/\\(.)/g, '$1')}`; // the key, unescaped
  expect(picomatch(key, { dot: true, contains: true })(route)).toBe(true);
});

// /tick runs due plugins and renders their jobs: it needs the fonts but
// never reads reference/ (registration and template seeding run on the
// Slips pages and /ingest, which do trace it).
it('traces fonts, not reference/, into /tick', () => {
  const includes = nextConfig.outputFileTracingIncludes ?? {};
  expect(includes['/tick']).toEqual(['./render/fonts/**']);
  for (const key of ['/ingest', '/slips', '/api/auth/\\[...all\\]']) {
    expect(includes[key]).toContain('./reference/**');
  }
});
