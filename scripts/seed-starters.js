#!/usr/bin/env node
// scripts/seed-starters.js — one-off (delete it after it has run once on
// production): give the starter templates to every account that has no
// template rows. Template reads used to seed them on first access; new
// accounts now get them from the sign-up hook (lib/auth-server.js), so this
// covers accounts created before that which never opened a page that listed
// templates. Idempotent: an account with any template is skipped.
//
// config.js loads .env, and .env may point DATABASE_URL at production, so a
// bare `node scripts/seed-starters.js` can write to production. Name the
// database every time:
//   DATABASE_URL= node scripts/seed-starters.js                    # local PGlite in data/pg
//   DATABASE_URL="postgres://..." node scripts/seed-starters.js    # production Neon
// (An empty DATABASE_URL wins over .env: dotenv never overrides a set
// variable.) Stop the dev server before a local run: PGlite is
// single-process.

import { seedStarterTemplates, usersWithoutTemplates } from '../lib/store.js';

try {
  const ids = await usersWithoutTemplates();
  let seeded = 0;
  for (const id of ids) {
    const n = await seedStarterTemplates(id);
    if (n) seeded++;
    console.log(`${id}: ${n} starter template${n === 1 ? '' : 's'}`);
  }
  console.log(`${seeded} of ${ids.length} account${ids.length === 1 ? '' : 's'} without templates seeded`);
  // The open PGlite handle keeps the event loop alive; exit explicitly.
  process.exit(0);
} catch (err) {
  console.error('failed:', err.message);
  process.exit(1);
}
