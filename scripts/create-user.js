#!/usr/bin/env node
// scripts/create-user.js — bootstrap an account without an invite, via
// the Better Auth admin API (server-side createUser skips the invite
// gate, which only guards /sign-up/email).
//
//   node scripts/create-user.js "Name" email password [role]
//
// role defaults to admin (the expected use is bootstrapping the first
// account). Local runs hit PGlite in data/pg (or DATABASE_URL from .env);
// for production, run with the production database:
//   DATABASE_URL="postgres://..." node scripts/create-user.js ...

import { getAuth } from '../lib/auth-server.js';

const [name, email, password, role = 'admin'] = process.argv.slice(2);

if (!name || !email || !password) {
  console.error('usage: node scripts/create-user.js "Name" email password [role]');
  process.exit(1);
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
} catch (err) {
  console.error('failed:', err.body?.message || err.message);
  process.exit(1);
}
