// tests/repo-hygiene.test.ts — the env contract and the tracked tree stay
// honest. .env.example lists every environment variable the code reads,
// and every variable it assigns is one the code reads. config.js exports
// only settings something imports. reference/ holds only the template
// sets that seeding reads (the prototype files are gone), and scratch
// output and the private jobs/ folder stay out of git.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as config from '@/config.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/repo-hygiene`;
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
const SOURCE_DIRS = [
  'app',
  'components',
  'lib',
  'plugins',
  'render',
  'scripts',
  'agent',
  'transport',
  'db',
];
const SOURCE_FILES = [
  'config.js',
  'middleware.ts',
  'next.config.mjs',
  'drizzle.config.ts',
];
const CODE = /\.(js|mjs|cjs|ts|tsx)$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return CODE.test(e.name) ? [p] : [];
  });
}

// Every non-test source file, as [repo-relative path, text].
const sources: Array<[string, string]> = [
  ...SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
  ...SOURCE_FILES.map((f) => path.join(ROOT, f)),
].map((p) => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);

const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

function envReads(): Map<string, string> {
  const reads = new Map<string, string>(); // name -> first file reading it
  const pattern =
    /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;
  for (const [file, text] of sources) {
    for (const m of text.matchAll(pattern)) {
      const name = m[1] ?? m[2];
      if (!reads.has(name)) reads.set(name, file);
    }
  }
  return reads;
}

describe('.env.example', () => {
  const reads = envReads();

  it('finds the variables the code reads', () => {
    // A sanity floor: the scan sees config.js, the agents and the eval.
    for (const name of ['DATABASE_URL', 'PRINT_SERVER', 'TAPE_DETUNE']) {
      expect(reads.has(name)).toBe(true);
    }
  });

  it.each([...reads.entries()])('mentions %s (read in %s)', (name) => {
    expect(envExample).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('assigns only variables the code reads', () => {
    const assigned = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
      (m) => m[1],
    );
    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.filter((name) => !reads.has(name))).toEqual([]);
  });

  it('no longer carries the dead INGEST_TIMEZONE', () => {
    expect(envExample).not.toMatch(/\bINGEST_TIMEZONE\b/);
  });
});

describe('config.js', () => {
  it('drops the dead exports', () => {
    expect(config).not.toHaveProperty('INGEST_TIMEZONE');
    expect(config).not.toHaveProperty('POLL_INTERVAL');
  });

  it.each(Object.keys(config))('export %s is imported somewhere', (name) => {
    const users = sources.filter(
      ([file, text]) =>
        file !== 'config.js' &&
        /config\.js['"]/.test(text) &&
        new RegExp(`\\b${name}\\b`).test(text),
    );
    expect(users.map(([file]) => file)).not.toEqual([]);
  });
});

describe('tracked tree', () => {
  it('reference/ holds only the template sets seeding reads', () => {
    // Dotfiles such as .DS_Store (Finder writes one) are not tracked.
    const files = fs
      .readdirSync(path.join(ROOT, 'reference'))
      .filter((f) => !f.startsWith('.'))
      .sort();
    expect(files).toEqual([
      'brief-templates.json',
      'photo-templates.json',
      'starter-templates.json',
      'task-templates.json',
      'wc-templates.json',
    ]);
  });

  it('ignores tmp/ and the whole jobs/ folder', () => {
    const lines = fs
      .readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(lines).toContain('tmp/');
    expect(lines).toContain('jobs/');
    // No placeholder rules that would let a file under jobs/ back in.
    expect(lines.filter((l) => /^!?jobs\/./.test(l))).toEqual([]);
  });

  it('has no htmx-era mockups, and no doc points at them', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'mockups'))).toBe(false);
    const docs = ['README.md', 'CONTRIBUTING.md', 'CLAUDE.md'].concat(
      fs
        .readdirSync(path.join(ROOT, 'docs'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join('docs', f)),
    );
    for (const doc of docs) {
      expect(fs.readFileSync(path.join(ROOT, doc), 'utf8')).not.toMatch(
        /mockups?\b/i,
      );
    }
  });
});
