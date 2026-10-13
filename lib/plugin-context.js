// lib/plugin-context.js: ctx, the only surface a plugin module gets. No
// stores, no HTTP routes, no files. Built per owner and module by the tick
// (lib/ops/device-service.js#runDue) and by message delivery
// (lib/ops/messages.js).

import * as jobStore from './job-store.js';
import * as llm from './llm/index.js';
import * as store from './store.js';

export function makeCtx(ownerId, moduleId) {
  return {
    // source defaults to the module id; message-ingest passes the envelope's.
    createJob: ({ template, data, name, source }) =>
      jobStore.createJob(ownerId, { template, data, name, source: source || moduleId }),
    getTemplate: name => store.getTemplate(ownerId, name), // never seeds
    // Structured output from a Zod schema (lib/llm/index.js).
    llm: { generateObject: req => llm.generateObject(req) },
    log: msg => console.log(`  [${moduleId}] ${msg}`),
  };
}
