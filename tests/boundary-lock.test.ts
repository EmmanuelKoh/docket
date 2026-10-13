// tests/boundary-lock.test.ts — biome overrides replace rule options
// instead of merging them, so the boundary lock (the import rules in
// biome.json) is written twice: once for app/** and components/**, once for
// the three files allowed to import lib/auth-server.js. The copies must
// match, or an edit to one leaves the other half of app/ unlocked while
// lint stays green. Then the lock itself, by running biome on probe files
// laid out like app/ and components/: relative plugin imports are caught
// (any plugin file, not a list of today's), better-auth's own plugins entry
// points are not, and require() is an error (noRestrictedImports never sees
// it).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/boundary-lock`;
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

type Pattern = { group: string[]; message: string };
type Options = { paths: Record<string, string>; patterns: Pattern[] };
type Override = {
  includes: string[];
  linter?: {
    rules?: { style?: { noRestrictedImports?: { options?: Options } } };
  };
};

const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'biome.json'), 'utf8'),
) as { overrides: Override[] };

function lockFor(includes: string[]): Options {
  const override = config.overrides.find(
    (o) => JSON.stringify(o.includes) === JSON.stringify(includes),
  );
  const options = override?.linter?.rules?.style?.noRestrictedImports?.options;
  if (!options) throw new Error(`no import lock for ${includes.join(', ')}`);
  return options;
}

const ui = lockFor(['app/**', 'components/**']);
const authFiles = lockFor([
  'app/_lib/dashboard-session.ts',
  'app/api/auth/**',
  'app/logout/route.ts',
]);
const isAuthGroup = (p: Pattern) => p.group.includes('@/lib/auth-server');

it('both overrides forbid the same packages', () => {
  expect(authFiles.paths).toEqual(ui.paths);
});

it('the auth files share every pattern group except the auth one', () => {
  expect(ui.patterns.filter(isAuthGroup)).toHaveLength(1);
  expect(authFiles.patterns.some(isAuthGroup)).toBe(false);
  expect(authFiles.patterns).toEqual(
    ui.patterns.filter((p) => !isAuthGroup(p)),
  );
});

it('the store group comes first in both', () => {
  expect(ui.patterns[0].group).toContain('@/lib/**');
  expect(authFiles.patterns[0]).toEqual(ui.patterns[0]);
});

// [probe file, import line, the rule that must flag it (null: clean)]
const STORE = 'lint/style/noRestrictedImports';
const COMMONJS = 'lint/style/noCommonJs';
const PROBES: Array<[string, string, string | null]> = [
  [
    'app/api/p1/route.ts',
    "import x from '../../../plugins/new-plugin.js';",
    STORE,
  ],
  ['app/api/p2/route.ts', "import x from '../../../plugins';", STORE],
  ['components/p3.tsx', "import x from '../plugins/message-ingest.js';", STORE],
  [
    'app/_lib/dashboard-session.ts',
    "import x from '../../plugins/index.js';",
    STORE,
  ],
  ['app/api/p4/route.ts', "import x from '@/plugins/index.js';", STORE],
  ['components/p5.ts', "import x from '@/lib/store.js';", STORE],
  ['components/p6.ts', "import x from 'better-auth/client/plugins';", null],
  ['app/api/p7/route.ts', "import x from 'better-auth/plugins';", null],
  ['app/api/p8/route.ts', "import x from 'better-auth/plugins/admin';", null],
  ['components/p9.ts', "import x from '@/lib/ops/jobs.js';", null],
  ['components/p10.ts', "const x = require('@/lib/store.js');", COMMONJS],
  [
    'app/_lib/dashboard-session.ts',
    "const x = require('@/lib/db.js');",
    COMMONJS,
  ],
];

it('biome flags exactly the forbidden imports and require()', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-lint-probe-'));
  try {
    fs.copyFileSync(
      path.join(ROOT, 'biome.json'),
      path.join(dir, 'biome.json'),
    );
    // One probe per file (two share dashboard-session.ts, one per line).
    const files = new Map<string, string[]>();
    for (const [file, line] of PROBES) {
      files.set(file, [...(files.get(file) || []), line]);
    }
    for (const [file, lines] of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      // x0, x1...: one binding per line, all exported (no unused imports).
      const named = lines.map((l, i) => l.replace(' x ', ` x${i} `));
      const names = lines.map((_, i) => `x${i}`).join(', ');
      fs.writeFileSync(
        path.join(dir, file),
        `${named.join('\n')}\nexport { ${names} };\n`,
      );
    }
    const run = spawnSync(
      path.join(ROOT, 'node_modules', '.bin', 'biome'),
      ['lint', '--reporter=json', '--max-diagnostics=none', '.'],
      { cwd: dir, encoding: 'utf8' },
    );
    const { diagnostics } = JSON.parse(run.stdout) as {
      diagnostics: {
        category: string;
        location: { path: string; start: { line: number } };
      }[];
    };
    const found = new Set(
      diagnostics
        .filter((d) => d.category === STORE || d.category === COMMONJS)
        .map(
          (d) => `${d.location.path}:${d.location.start.line} ${d.category}`,
        ),
    );
    const expected = new Set(
      PROBES.flatMap(([file, line, rule]) => {
        const at = (files.get(file) || []).indexOf(line) + 1;
        return rule ? [`${file}:${at} ${rule}`] : [];
      }),
    );
    expect(found).toEqual(expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// noCommonJs skips .cjs files by design: keep them out of the UI tree.
it('app/ and components/ hold no CommonJS files', () => {
  const cjs = ['app', 'components'].flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d), { recursive: true })
      .map(String)
      .filter((f) => /\.c[jt]s$/.test(f))
      .map((f) => `${d}/${f}`),
  );
  expect(cjs).toEqual([]);
});
