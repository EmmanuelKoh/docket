// lib/auth-secret.js: the secret that signs Better Auth's session cookies.
//
// BETTER_AUTH_SECRET (or SESSION_SECRET) wins when set. AUTH_SECRET or
// BETTER_AUTH_SECRETS, which Better Auth reads from the environment
// itself, also count as set: then nothing is generated or passed, and
// Better Auth signs with them. With none set, Better Auth falls back to a
// default secret that is public in its source and accepts it outside
// production, so anyone could forge an admin session cookie for a dev
// server reachable on the LAN. A local run (DEV_DEFAULTS in config.js)
// makes 32 random bytes instead, once, and keeps them in
// DATA_DIR/auth-secret (mode 0600). Every later start reads the same
// file, so sessions survive restarts; deleting it signs everyone out.
//
// A production build or a Vercel deploy gets no generated secret: with
// none set, Better Auth throws "You are using the default secret" on the
// first auth request, so a deploy without a secret fails loudly instead of
// signing with a public one.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Better Auth warns below 32 characters. A shorter file was not written
// here, and an empty one must never reach Better Auth (it would fall back
// to the default secret).
const MIN_LENGTH = 32;

// The secret to pass to betterAuth(), or '' to leave Better Auth to its
// own handling: it reads AUTH_SECRET and BETTER_AUTH_SECRETS itself
// (inBetterAuthEnv says one is set), and fails in production with none.
export function resolveAuthSecret({ configured, inBetterAuthEnv = false, devDefaults, dataDir }) {
  if (configured) return configured;
  if (inBetterAuthEnv || !devDefaults) return '';
  return localSecret(path.join(dataDir, 'auth-secret'));
}

// The file's secret, or null when there is no file.
function readSecret(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const secret = text.trim();
  if (secret.length < MIN_LENGTH) {
    throw new Error(
      `${file} holds no usable secret; delete it and restart to generate a new one`,
    );
  }
  return secret;
}

function localSecret(file) {
  const existing = readSecret(file);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written whole under a temporary name, then linked into place. The
  // link fails when the file exists, so if the dev server and a script
  // start at once, one secret wins, both use it, and no reader ever sees
  // a half-written file.
  const secret = crypto.randomBytes(32).toString('base64');
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${secret}\n`, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    console.log(`[auth] generated a local session secret in ${file}`);
    return secret;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const winner = readSecret(file);
  if (!winner) throw new Error(`${file} disappeared while it was being created`);
  return winner;
}
