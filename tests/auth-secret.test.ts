// tests/auth-secret.test.ts — the secret that signs session cookies
// (lib/auth-secret.js). A local run with no BETTER_AUTH_SECRET or
// SESSION_SECRET generates 32 random bytes once into DATA_DIR/auth-secret
// (mode 0600) and reuses them; a set secret wins and writes nothing. The
// real Better Auth instance then rejects a session cookie signed with
// Better Auth's public default secret, while the same forged cookie signed
// with the generated secret passes (the control that shows the forgery is
// well formed). AUTH_SECRET and BETTER_AUTH_SECRETS, which Better Auth
// reads itself, count as set: a local run then writes no file and Better
// Auth signs with them. A production build or a Vercel deploy generates
// nothing, and in production Better Auth still refuses to start with no
// secret. Temp dirs live under the vitest DATA_DIR, which
// vitest.config.ts removes when the run ends.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DATA_DIR } from '@/config.js';
import { resolveAuthSecret } from '@/lib/auth-secret.js';
import { getAuth } from '@/lib/auth-server.js';

// Blank secrets before config.js loads (dotenv never overrides a set
// variable, so a developer's .env cannot fill them in).
vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/auth-secret-test`;
  process.env.BETTER_AUTH_SECRET = '';
  process.env.SESSION_SECRET = '';
  process.env.AUTH_SECRET = '';
  process.env.BETTER_AUTH_SECRETS = '';
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
const SECRET_FILE = path.join(DATA_DIR, 'auth-secret');

function tempDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(DATA_DIR, 'tmp-'));
}

// --- forging a cookie-cache session, the way lib/auth-server.js's
// cookieCache (compact strategy) checks one: the session-token cookie is
// `token.base64(HMAC-SHA256)` and the session-data cookie carries an
// HMAC-SHA256 (base64url) over the session plus its expiry.

const hmac = (
  secret: string,
  value: string,
  encoding: 'base64' | 'base64url',
) => crypto.createHmac('sha256', secret).update(value).digest(encoding);

async function forgedAdminHeaders(secret: string) {
  const ctx = await (await getAuth()).$context;
  const now = Date.now();
  const token = 'forged-session-token';
  const at = new Date(now).toISOString();
  const sessionData = {
    session: {
      id: 'forged-session',
      token,
      userId: 'forged-user',
      expiresAt: new Date(now + 86_400_000).toISOString(),
      createdAt: at,
      updatedAt: at,
    },
    user: {
      id: 'forged-user',
      name: 'Forged',
      email: 'forged@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: at,
      updatedAt: at,
    },
    updatedAt: now,
    version: '1',
  };
  const expiresAt = now + 300_000;
  const signature = hmac(
    secret,
    JSON.stringify({ ...sessionData, expiresAt }),
    'base64url',
  );
  const data = Buffer.from(
    JSON.stringify({ session: sessionData, expiresAt, signature }),
  ).toString('base64url');
  const signedToken = `${token}.${hmac(secret, token, 'base64')}`;
  return new Headers({
    cookie: [
      `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signedToken)}`,
      `${ctx.authCookies.sessionData.name}=${data}`,
    ].join('; '),
  });
}

// What Better Auth signs with when it is given no secret at all.
async function betterAuthDefaultSecret() {
  const { betterAuth } = await import('better-auth');
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  const bare = betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    logger: { disabled: true },
  });
  return (await bare.$context).secret;
}

// Runs first: config.js reloads below would otherwise change what
// auth-server's own dynamic imports see.
describe('a local run with no secret set', () => {
  it('signs with a generated secret persisted in DATA_DIR/auth-secret', async () => {
    const ctx = await (await getAuth()).$context;
    const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    expect(ctx.secret).toBe(stored);
    expect(Buffer.from(stored, 'base64')).toHaveLength(32);
    expect(ctx.secret).not.toBe(await betterAuthDefaultSecret());
    if (process.platform !== 'win32') {
      expect(fs.statSync(SECRET_FILE).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects a session cookie signed with Better Auth's default secret", async () => {
    const auth = await getAuth();
    const defaultSecret = await betterAuthDefaultSecret();
    expect(defaultSecret).toBeTruthy();
    const session = await auth.api.getSession({
      headers: await forgedAdminHeaders(defaultSecret),
    });
    expect(session).toBeNull();
  });

  it('accepts the same forged cookie only with the generated secret (control)', async () => {
    const auth = await getAuth();
    const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    const session = await auth.api.getSession({
      headers: await forgedAdminHeaders(stored),
    });
    expect(session?.user).toMatchObject({ id: 'forged-user', role: 'admin' });
  });
});

describe('resolveAuthSecret', () => {
  it('generates 32 random bytes once and reuses them', () => {
    const dataDir = path.join(tempDir(), 'nested', 'data');
    const first = resolveAuthSecret({
      configured: '',
      devDefaults: true,
      dataDir,
    });
    const file = path.join(dataDir, 'auth-secret');
    expect(Buffer.from(first, 'base64')).toHaveLength(32);
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(first);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    const before = fs.readFileSync(file, 'utf8');
    expect(
      resolveAuthSecret({ configured: '', devDefaults: true, dataDir }),
    ).toBe(first);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.readdirSync(dataDir)).toEqual(['auth-secret']);
  });

  it('gives another data dir its own secret', () => {
    const a = resolveAuthSecret({
      configured: '',
      devDefaults: true,
      dataDir: tempDir(),
    });
    const b = resolveAuthSecret({
      configured: '',
      devDefaults: true,
      dataDir: tempDir(),
    });
    expect(a).not.toBe(b);
  });

  it('uses a configured secret and writes nothing', () => {
    const dataDir = tempDir();
    expect(
      resolveAuthSecret({
        configured: 'set-in-env',
        devDefaults: true,
        dataDir,
      }),
    ).toBe('set-in-env');
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });

  it('leaves a secret Better Auth reads itself to Better Auth and writes nothing', () => {
    const dataDir = tempDir();
    expect(
      resolveAuthSecret({
        configured: '',
        inBetterAuthEnv: true,
        devDefaults: true,
        dataDir,
      }),
    ).toBe('');
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });

  it('generates nothing outside local dev', () => {
    const dataDir = tempDir();
    expect(
      resolveAuthSecret({ configured: '', devDefaults: false, dataDir }),
    ).toBe('');
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });

  it('refuses a file with no usable secret instead of returning it', () => {
    const dataDir = tempDir();
    fs.writeFileSync(path.join(dataDir, 'auth-secret'), '\n');
    expect(() =>
      resolveAuthSecret({ configured: '', devDefaults: true, dataDir }),
    ).toThrow(/no usable secret/);
  });
});

describe('DEV_DEFAULTS in config.js', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    vi.stubEnv('DEVICE_TOKEN', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return import('@/config.js');
  }

  it('is on for a local run, with the dev-token default', async () => {
    const config = await load({ NODE_ENV: 'development', VERCEL: '' });
    expect(config.DEV_DEFAULTS).toBe(true);
    expect(config.DEVICE_TOKEN).toBe('dev-token');
  });

  it('is off in a production build', async () => {
    const config = await load({ NODE_ENV: 'production', VERCEL: '' });
    expect(config.DEV_DEFAULTS).toBe(false);
    expect(config.DEVICE_TOKEN).toBe('');
  });

  it('is off on Vercel', async () => {
    const config = await load({ NODE_ENV: 'development', VERCEL: '1' });
    expect(config.DEV_DEFAULTS).toBe(false);
    expect(config.DEVICE_TOKEN).toBe('');
  });

  it("sees a secret in Better Auth's own AUTH_SECRET or BETTER_AUTH_SECRETS", async () => {
    const none = await load({ AUTH_SECRET: '', BETTER_AUTH_SECRETS: '' });
    expect(none.AUTH_SECRET_IN_ENV).toBe(false);
    const single = await load({ AUTH_SECRET: 'x'.repeat(40) });
    expect(single.AUTH_SECRET_IN_ENV).toBe(true);
    const versioned = await load({
      BETTER_AUTH_SECRETS: `1:${'y'.repeat(40)}`,
    });
    expect(versioned.AUTH_SECRET_IN_ENV).toBe(true);
  });
});

// Runs lib/auth-server.js in a child process with a minimal env and a cwd
// with no .env, so nothing reaches a cloud store or a developer's secret.
function startAuth(dataDir: string, env: Record<string, string>) {
  const script = `
    const { getAuth } = await import(${JSON.stringify(
      pathToFileURL(path.join(ROOT, 'lib', 'auth-server.js')).href,
    )});
    try {
      const ctx = await (await getAuth()).$context;
      console.log('SECRET ' + ctx.secret);
    } catch (err) {
      console.log('REFUSED ' + err.message);
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dataDir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: '',
      PGLITE_DIR: 'memory://',
      DATA_DIR: dataDir,
      STORE_DRIVER: 'json',
      BETTER_AUTH_SECRET: '',
      SESSION_SECRET: '',
      AUTH_SECRET: '',
      BETTER_AUTH_SECRETS: '',
      VERCEL: '',
      ...env,
    },
  });
}

describe("a local run with Better Auth's own secret variables", () => {
  const set = crypto.randomBytes(32).toString('base64');

  it('signs with AUTH_SECRET and writes no secret file', () => {
    const dataDir = tempDir();
    const run = startAuth(dataDir, {
      NODE_ENV: 'development',
      AUTH_SECRET: set,
    });
    expect(run.stderr).not.toMatch(/Cannot find|SyntaxError/);
    expect(run.stdout).toContain(`SECRET ${set}\n`);
    expect(fs.existsSync(path.join(dataDir, 'auth-secret'))).toBe(false);
  });

  it('signs with the current BETTER_AUTH_SECRETS entry and writes no secret file', () => {
    const dataDir = tempDir();
    const old = crypto.randomBytes(32).toString('base64');
    const run = startAuth(dataDir, {
      NODE_ENV: 'development',
      BETTER_AUTH_SECRETS: `2:${set},1:${old}`,
    });
    expect(run.stderr).not.toMatch(/Cannot find|SyntaxError/);
    expect(run.stdout).toContain(`SECRET ${set}\n`);
    expect(fs.existsSync(path.join(dataDir, 'auth-secret'))).toBe(false);
  });
});

describe('a production build with no secret set', () => {
  it('still refuses to start, and writes no secret file', () => {
    const dataDir = tempDir();
    const run = startAuth(dataDir, { NODE_ENV: 'production' });
    expect(run.stderr).not.toMatch(/Cannot find|SyntaxError/);
    expect(run.stdout).toMatch(/REFUSED .*default secret/);
    expect(fs.existsSync(path.join(dataDir, 'auth-secret'))).toBe(false);
  });
});
