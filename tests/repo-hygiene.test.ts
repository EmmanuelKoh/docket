// tests/repo-hygiene.test.ts — the env contract and the tracked tree stay
// honest. .env.example lists every environment variable the code reads,
// and every variable it assigns is one the code reads. config.js exports
// only settings something imports. reference/ holds only the template
// sets that seeding reads (the prototype files are gone), and scratch
// output, the private repo-root jobs/ folder (not app/jobs/), every .env
// file but .env.example and the Vercel CLI link stay out of git. Every
// vendored font, model and binary has its license beside it and an entry
// in THIRD_PARTY_NOTICES.md, and the README's first-deploy steps name
// scripts and settings that exist. package.json pins no Node version, so
// Vercel keeps the one its project settings name.

import { spawnSync } from 'node:child_process';
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

  const ignoreLines = () =>
    fs
      .readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());

  it('ignores tmp/ and the whole repo-root jobs/ folder', () => {
    const lines = ignoreLines();
    expect(lines).toContain('tmp/');
    // Anchored: an unanchored jobs/ also ignores app/jobs/ and
    // app/api/jobs/, so a new route file there would never be committed.
    expect(lines).toContain('/jobs/');
    expect(lines).not.toContain('jobs/');
    // No placeholder rules that would let a file under jobs/ back in.
    expect(lines.filter((l) => /^!?\/?jobs\/./.test(l))).toEqual([]);
  });

  // A copy with no .git (a source tarball) has no git to ask.
  const inGit =
    spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT })
      .status === 0;

  it.skipIf(!inGit)('git ignores only the repo-root jobs/ folder', () => {
    // --no-index tests the patterns, so tracked and missing files count.
    const ignored = (file: string) =>
      spawnSync('git', ['check-ignore', '--no-index', '-q', file], {
        cwd: ROOT,
      }).status;
    expect(ignored('jobs/receipt.png')).toBe(0);
    expect(ignored('jobs/sub/receipt.png')).toBe(0);
    for (const file of [
      'app/jobs/route.ts',
      'app/jobs/new-route.ts',
      'app/api/jobs/cancel/route.ts',
      'app/api/jobs/new/route.ts',
    ]) {
      expect(ignored(file), file).toBe(1);
    }
  });

  it('ignores every .env file but .env.example, and the Vercel link', () => {
    const lines = ignoreLines();
    expect(lines).toContain('.env*');
    expect(lines).toContain('.vercel/');
    // .env.example is the only env file let back in, after the .env* rule.
    expect(
      lines.filter((l) => l.startsWith('!') && l.includes('.env')),
    ).toEqual(['!.env.example']);
    expect(lines.indexOf('!.env.example')).toBeGreaterThan(
      lines.indexOf('.env*'),
    );
    expect(
      lines.filter((l) => l.startsWith('!') && l.includes('.vercel')),
    ).toEqual([]);
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

describe('third-party files', () => {
  const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const notices = read('THIRD_PARTY_NOTICES.md');

  // Fonts, models and binaries in the folders that ship to the server or
  // the browser. Each came from another project.
  const SHIPPED = ['render', 'public', 'app', 'components'];
  const ASSET = /\.(ttf|otf|woff2?|wasm|bin|onnx|tflite)$/;
  function assets(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return assets(p);
      return ASSET.test(e.name) ? [path.relative(ROOT, p)] : [];
    });
  }
  const found = SHIPPED.flatMap((d) => assets(path.join(ROOT, d))).sort();

  it('finds the vendored fonts, model and binaries', () => {
    expect(found).toEqual(
      expect.arrayContaining([
        'render/fonts/DejaVuSans.ttf',
        'public/basic-pitch/group1-shard1of1.bin',
        'public/tf-wasm/tfjs-backend-wasm.wasm',
        'public/tf-wasm/tfjs-backend-wasm-simd.wasm',
      ]),
    );
  });

  it.each(found)('%s has a LICENSE beside it and a notice', (file) => {
    expect(fs.existsSync(path.join(ROOT, path.dirname(file), 'LICENSE'))).toBe(
      true,
    );
    expect(notices).toContain(`\`${file}\``);
  });

  it('ships the DejaVu license with the fonts', () => {
    const text = read('render/fonts/LICENSE');
    expect(text).toContain('Copyright (c) 2003 by Bitstream, Inc.');
    expect(text).toContain('Copyright (c) 2006 by Tavmjong Bah.');
  });

  it('ships Apache-2.0 and the statically linked BSD notices with tf-wasm', () => {
    const text = read('public/tf-wasm/LICENSE');
    expect(text).toContain('Version 2.0, January 2004');
    expect(text).toContain('Copyright 2022 Google LLC. All Rights Reserved.');
    // XNNPACK (BSD-3-Clause), then pthreadpool (BSD-2-Clause).
    expect(text).toContain('For XNNPACK software');
    expect(text).toContain(
      'Copyright (c) 2015-2017 Georgia Institute of Technology',
    );
    expect(text.indexOf('For XNNPACK software')).toBeGreaterThan(
      text.indexOf('Version 2.0, January 2004'),
    );
  });

  it('names the other linked code tf-wasm includes, without claiming a complete list', () => {
    const text = read('public/tf-wasm/LICENSE');
    const preamble = text.split('\n\n\n')[0];
    expect(preamble).toContain(
      'include code\nfrom at least the projects below',
    );
    expect(preamble).not.toMatch(/contain code\s+from (two|three|four)/);
    // FXdiv, then Emscripten's runtime, musl and the LLVM libraries.
    for (const notice of [
      'Copyright (c) 2016-2017 Marat Dukhan',
      'Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.',
      'Copyright © 2005-2020 Rich Felker, et al.',
      'The LLVM Project is under the Apache License v2.0 with LLVM Exceptions:',
      // libc++abi's and compiler-rt's own texts, not a note on how they differ.
      'The libc++abi library is dual licensed under both the University of Illinois',
      'The compiler_rt library is dual licensed under both the University of Illinois',
      'Copyright (c) 2009-2015 by the contributors listed in CREDITS.TXT',
      // FP16.
      'Copyright (c) 2017 Georgia Institute of Technology\nCopyright 2019 Google LLC',
    ]) {
      expect(text).toContain(notice);
    }
    expect(notices).toContain('FP16 (<https://github.com/Maratyszcza/FP16>)');
    expect(notices).toContain(
      'include code from at least these other projects',
    );
    expect(notices).not.toMatch(/all three licenses/);
  });

  it('lists the copied code with its license text', () => {
    expect(notices).toContain('`components/tape-renderer.js`');
    expect(notices).toContain('`scripts/tape-glyphs/gen-glyphs.mjs`');
    expect(notices).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(notices).toContain('`components/ui/*.tsx`');
    expect(notices).toContain('Copyright (c) 2023 shadcn');
  });

  it('links only to files that exist', () => {
    const links = [...notices.matchAll(/\]\(([^)#:]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((l) => !fs.existsSync(path.join(ROOT, l)))).toEqual([]);
  });

  it('README carves the third-party files out of the MIT line', () => {
    const license = read('README.md').split('\n## License\n')[1];
    expect(license).toContain(
      '[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)',
    );
  });
});

describe('README first deploy', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  it('names the scripts and firmware settings that exist', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    expect(readme).toContain('npm run db:migrate');
    expect(pkg.scripts['db:migrate']).toBeTruthy();
    expect(readme).toContain('node scripts/create-user.js');
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'create-user.js'))).toBe(
      true,
    );
    const secrets = fs.readFileSync(
      path.join(ROOT, 'firmware', 'docket-agent', 'secrets.h.example'),
      'utf8',
    );
    for (const name of ['SECRET_SERVER_URL', 'SECRET_DEVICE_TOKEN']) {
      expect(readme).toContain(`\`${name}\``);
      expect(secrets).toMatch(new RegExp(`#define ${name}\\b`));
    }
  });

  it('states the Node version without pinning one for Vercel', () => {
    // An engines range would let Vercel pick a newer major on its own;
    // the Node version is set in the Vercel project's settings instead.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    expect(pkg).not.toHaveProperty('engines');
    const lock = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'),
    );
    expect(lock.packages['']).not.toHaveProperty('engines');
    expect(fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim()).toBe(
      '22',
    );
    // vite needs 22.12 or later.
    expect(readme).toContain('Node 22.12 or later');
    expect(readme).toContain('Node.js Version to 22.x');
    expect(
      fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8'),
    ).toContain('Node 22.12 or later');
  });

  it('asks for a Blob store with public access', () => {
    expect(readme).toMatch(/Blob store with public access/);
  });
});
