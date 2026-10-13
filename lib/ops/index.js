// lib/ops/index.js: every operation, for adapters that enumerate them (the registry
// test today). Routes and pages import the op module they use, never this file.
// Each new ops module adds its import and list entry; a new op in an existing module needs no edit.
import * as accounts from './accounts.js';
import * as jobs from './jobs.js';
import * as messages from './messages.js';
import * as printers from './printers.js';
import * as slips from './slips.js';
import * as tape from './tape.js';
import * as templates from './templates.js';

const all = [accounts, jobs, messages, printers, slips, tape, templates]
  .flatMap(m => Object.values(m)).filter(v => typeof v === 'function' && v.spec);
export const OPERATIONS = Object.freeze(Object.fromEntries(all.map(op => [op.spec.name, op])));
if (Object.keys(OPERATIONS).length !== all.length) throw new Error('duplicate operation name');
