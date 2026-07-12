#!/usr/bin/env node
// scripts/create-user.js — bootstrap an account without an invite, via
// the Better Auth admin API (server-side createUser skips the invite
// gate, which only guards /sign-up/email).
//
//   node scripts/create-user.js "Name" email [role]
//
// Prompts for the password with hidden input, so it never lands in shell
// history. (Passing it as a fourth argument still works for scripted use:
//   node scripts/create-user.js "Name" email admin thepassword )
//
// role defaults to admin (the expected use is bootstrapping the first
// account). Local runs hit PGlite in data/pg (or DATABASE_URL from .env);
// for production, run with the production database:
//   DATABASE_URL="postgres://..." node scripts/create-user.js ...

import { getAuth } from '../lib/auth-server.js';

const [name, email, role = 'admin', passwordArg] = process.argv.slice(2);

if (!name || !email) {
  console.error('usage: node scripts/create-user.js "Name" email [role]');
  process.exit(1);
}

// Read a line from the terminal without echoing the keystrokes.
function promptHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let value = '';
    const onData = ch => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

let password = passwordArg;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('no terminal to prompt on — pass the password as the fourth argument');
    process.exit(1);
  }
  password = await promptHidden(`password for ${email}: `);
  const confirm = await promptHidden('again to confirm: ');
  if (password !== confirm) {
    console.error('passwords do not match');
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(1);
}

const auth = await getAuth();
try {
  const res = await auth.api.createUser({
    body: { name, email, password, role },
  });
  console.log(`created ${role} account ${res.user.id} for ${email}`);
  // The open PGlite handle keeps the event loop alive; exit explicitly.
  process.exit(0);
} catch (err) {
  console.error('failed:', err.body?.message || err.message);
  process.exit(1);
}
