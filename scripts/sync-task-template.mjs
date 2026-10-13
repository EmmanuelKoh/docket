// scripts/sync-task-template.mjs — re-apply the Task template from
// reference/task-templates.json to the configured owner (OWNER_ID) through
// the templates.save operation. Templates seed only when missing, so after
// changing the reference file this is how an already-seeded account picks
// up the new version. Idempotent — safe to re-run.
//
// config.js loads .env, and .env may point DATABASE_URL at production, so a
// bare run can write to production. Name the database and the account
// (OWNER_ID is the account's user id; unset, it falls back to 'default',
// which no account has, and the save still succeeds):
//   DATABASE_URL= OWNER_ID=<user id> node scripts/sync-task-template.mjs                  # local PGlite
//   DATABASE_URL="postgres://..." OWNER_ID=<user id> node scripts/sync-task-template.mjs  # production Neon
// (An empty DATABASE_URL wins over .env: dotenv never overrides a set
// variable.)
//
// For a hosted account you can instead open the Task template in the
// Studio and Save it (the same operation), which needs no local
// credentials.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_ID } from '../config.js';
import { systemCaller } from '../lib/ops/caller.js';
import { templatesSave } from '../lib/ops/templates.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, '..', 'reference', 'task-templates.json');
const [task] = JSON.parse(fs.readFileSync(file, 'utf-8'));

try {
  const caller = systemCaller(OWNER_ID, 'cli:sync-task-template');
  await templatesSave(caller, { name: task.name, template: task.template, data: task.data });
  console.log(`synced "${task.name}" template for owner "${OWNER_ID}"`);
  // The open PGlite handle keeps the event loop alive; exit explicitly.
  process.exit(0);
} catch (err) {
  console.error(`failed: ${err.message} (owner "${OWNER_ID}")`);
  process.exit(1);
}
