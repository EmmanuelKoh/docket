// Shared by the sandbox scripts: where the sandbox keeps its state, the
// environment that cuts it off from every real store and service, and a
// signed-in browser for screenshots and checks.

import fs from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
// Under data/, which git ignores. Deleted and made again on each fresh start.
export const STORE = path.join(REPO, 'data', 'sandbox');
export const STATE_FILE = path.join(STORE, 'sandbox.json');
export const LOG_FILE = path.join(STORE, 'server.log');

/** Everything that could reach a real database, store or API is blanked:
 *  an empty value wins over .env (dotenv and Next leave set keys alone). */
export function sandboxEnv({ base, secret }) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: '',
    PGLITE_DIR: path.join(STORE, 'pg'),
    DATA_DIR: STORE,
    STORE_DRIVER: 'json',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    KV_REST_API_URL: '',
    KV_REST_API_TOKEN: '',
    BLOB_READ_WRITE_TOKEN: '',
    GEMINI_API_KEY: '',
    DEVICE_TOKEN: '',
    OWNER_ID: '',
    PRINTER_IP: '',
    AUTH_SECRET: '',
    BETTER_AUTH_SECRETS: '',
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: base,
    SESSION_SECRET: '',
    PRINT_SERVER: '',
    VERCEL: '',
  };
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    console.error('No sandbox found. Start one with: npm run sandbox');
    process.exit(1);
  }
}

export function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Signs in through the app's own auth route; returns the cookie header. */
export async function signIn(state) {
  const r = await fetch(`${state.base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: state.base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: state.email, password: state.password }),
  });
  if (!r.ok) throw new Error(`sign in failed: ${r.status} ${await r.text()}`);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** A Chrome page signed in to the sandbox, in the given theme. */
export async function signedInPage(
  state,
  { width = 1440, height = 1000, dpr = 2, dark = false, signedIn = true } = {},
) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  if (signedIn) {
    const host = new URL(state.base).hostname;
    const cookie = state.cookie || (await signIn(state));
    await ctx.addCookies(
      cookie.split('; ').map((kv) => {
        const i = kv.indexOf('=');
        return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: host, path: '/' };
      }),
    );
  }
  await ctx.addInitScript((d) => {
    try {
      localStorage.setItem('docket-theme', d ? 'dark' : 'light');
    } catch {}
  }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  return { browser, page, errors };
}
