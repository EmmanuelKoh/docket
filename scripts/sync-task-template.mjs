// scripts/sync-task-template.mjs — re-apply the Task template from
// reference/task-templates.json into the active store (json or redis, per
// STORE_DRIVER). Templates seed only when missing, so after changing the
// reference file this is how an already-seeded store picks up the new
// version. Idempotent — safe to re-run.
//
//   node scripts/sync-task-template.mjs                 # local json store
//   STORE_DRIVER=redis node scripts/sync-task-template.mjs   # a redis store
//
// For a hosted store you can instead open the Task template in the Studio
// and Save it (that writes through the same store), which needs no local
// credentials.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveTemplate } from '../lib/store.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, '..', 'reference', 'task-templates.json');
const [task] = JSON.parse(fs.readFileSync(file, 'utf-8'));

await saveTemplate(task);
console.log(
  `synced "${task.name}" template into the ${process.env.STORE_DRIVER || 'json'} store`,
);
