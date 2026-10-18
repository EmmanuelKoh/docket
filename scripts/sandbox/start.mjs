// npm run sandbox: the dashboard on http://localhost:3400 with hot
// reload, against a throwaway local store in data/sandbox (PGlite and the
// json driver; no .env database, Redis, Blob or API key is used). A fresh
// start makes an admin and seeds templates, jobs, a paired printer and
// invites. A stand-in printer then polls like the ESP32 (/next every 5s,
// /tick every 30s), so the printer reads Online and jobs print.
//
//   npm run sandbox                 fresh store, printer prints
//   npm run sandbox -- --keep       keep the last store and sign-in
//   npm run sandbox -- --hold       printer stays online but holds jobs
//
// Next allows one `next dev` per folder: stop `npm run dev` first.
// Ctrl+C stops the server and the stand-in printer.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LOG_FILE, REPO, STORE, readState, sandboxEnv, writeState } from './lib.mjs';
import { seed } from './seed.mjs';

const args = process.argv.slice(2);
const keep = args.includes('--keep') && fs.existsSync(path.join(STORE, 'sandbox.json'));
const hold = args.includes('--hold');
const PORT = 3400;
const base = `http://localhost:${PORT}`;

let state;
if (keep) {
  state = readState();
} else {
  fs.rmSync(STORE, { recursive: true, force: true });
  fs.mkdirSync(STORE, { recursive: true });
  state = {
    base,
    store: STORE,
    email: 'sam@example.test',
    password: `sandbox-${crypto.randomBytes(6).toString('hex')}`,
    secret: crypto.randomBytes(32).toString('hex'),
  };
  // PGlite is single-process: make the admin before the server opens it.
  const made = spawnSync(
    process.execPath,
    ['scripts/create-user.js', 'Sam Rivera', state.email, 'admin', state.password],
    { cwd: REPO, env: sandboxEnv(state), encoding: 'utf8' },
  );
  if (made.status !== 0) {
    console.error(made.stdout + made.stderr);
    process.exit(1);
  }
  writeState(state);
}

const log = fs.openSync(LOG_FILE, keep ? 'a' : 'w');
const server = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)],
  { cwd: REPO, env: sandboxEnv(state), stdio: ['ignore', log, log], detached: true },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    process.kill(-server.pid, 'SIGTERM'); // the server's whole process group
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
server.on('exit', (code) => {
  if (stopping) return;
  const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-15).join('\n');
  console.error(`The server stopped (exit ${code}). From ${path.relative(REPO, LOG_FILE)}:\n${tail}`);
  process.exit(1);
});

console.log(`Starting the sandbox server (log: ${path.relative(REPO, LOG_FILE)})`);
let ready = false;
for (let i = 0; i < 360 && !ready; i++) {
  try {
    ready = (await fetch(`${base}/login`, { redirect: 'manual' })).status < 500;
  } catch {}
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  console.error('The server did not answer within 3 minutes.');
  stop(1);
}

if (!keep) {
  console.log('Seeding templates, jobs, a printer and invites');
  Object.assign(state, await seed(state));
  writeState(state);
}

console.log(`
  Sandbox  ${base}
  Sign in  ${state.email}
           ${state.password}
  Kit      ${base}/kit
  Compare  ${base}/compare?page=/kit
  Printer  ${hold ? 'online, holding jobs (--hold)' : 'online, printing'}

Ctrl+C stops it.`);

// The stand-in printer, on the ESP32's cadence. It acks a job three
// seconds after it takes it, so Printing shows for a moment.
const device = { Authorization: `Bearer ${state.deviceToken}` };
let busy = false;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    if (hold) {
      await fetch(`${base}/tick`, { method: 'POST', headers: device });
      return;
    }
    const r = await fetch(`${base}/next`, { headers: device });
    await r.arrayBuffer();
    const id = r.status === 200 ? r.headers.get('x-job-id') : null;
    if (id) {
      await new Promise((res) => setTimeout(res, 3000));
      await fetch(`${base}/ack?job=${encodeURIComponent(id)}`, { method: 'POST', headers: device });
    }
  } catch {}
  busy = false;
}
async function tick() {
  try {
    await fetch(`${base}/tick`, { method: 'POST', headers: device });
  } catch {}
}
await poll();
await tick();
setInterval(poll, hold ? 30_000 : 5_000);
if (!hold) setInterval(tick, 30_000);
