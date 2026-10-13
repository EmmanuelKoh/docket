// lib/ops/messages.js: push delivery. An inbound message (envelope v1) goes
// to a module's onMessage with the owner's record config, state and a ctx,
// the way the tick hands run() its record. The runner keeps the record's
// lastRunAt/lastError so the Slips page shows the last message or failure.
// /ingest is this op for message-ingest, called with its ingestToken.
import crypto from 'node:crypto';
import { z } from 'zod';
import { findModule, takesMessages } from '../../plugins/index.js';
import * as kv from '../kv.js';
import { makeCtx } from '../plugin-context.js';
import * as registry from '../plugin-registry.js';
import { ensureRegistered, seedTemplates } from '../plugin-setup.js';
import { defineOperation, JOB_CREATE, OpError } from './define.js';

// Duplicates print once. A sender resends a message it got no 2xx for (the
// phone forwarder after its 15s read timeout, while the classifier is
// still running, or after a lost reply), so before the handler runs each
// delivery claims sha256(owner|source|sender|text) in kv
// (rp:{owner}:seen:{moduleId}:{sha256}): a copy that finds the claim
// pending answers 409 (the forwarder retries on its next scan), one that
// finds it done answers { duplicate: true }. A failed delivery releases
// the claim, so the sender's retry runs again. A delivery killed at the
// function limit (maxDuration 60s in app/ingest/route.ts) cannot release
// it, so pending lasts just past that limit; done lasts 15 minutes.
const PENDING_SECONDS = 90;
const SEEN_SECONDS = 15 * 60;
const seenName = (owner, moduleId, { source, sender, text }) => {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify([owner, source ?? '', sender ?? '', text]))
    .digest('hex');
  return `seen:${moduleId}:${hash}`;
};

// The module's handler with the record's config and state; the record keeps
// lastRunAt and lastError. Any failure becomes `unavailable` (502).
async function handle(module, envelope, record, owner) {
  const now = new Date().toISOString();
  try {
    const { state, reply } = await module.onMessage(envelope, {
      config: record.config || {}, state: record.state || {}, ctx: makeCtx(owner, module.id),
    });
    Object.assign(record, { state, lastRunAt: now, lastError: null, lastErrorAt: null });
    await registry.upsertPlugin(record, { create: false });
    return reply ?? {}; // a handler with nothing to say still answers JSON
  } catch (err) {
    // The sender gets 502 and retries; the slip shows the cause.
    console.error(`[${module.id}] onMessage failed: ${err.message}`);
    Object.assign(record, { lastRunAt: now, lastError: err.message, lastErrorAt: now });
    await registry.upsertPlugin(record, { create: false }).catch(() => {});
    throw new OpError('unavailable', 'message handling failed');
  }
}

export const messagesDeliver = defineOperation({
  name: 'messages.deliver',
  description: "Hand an inbound message (v1 envelope) to a module's onMessage. The same message (owner, source, sender, text) again within 15 minutes answers { duplicate: true }, or conflict while the first copy is still being handled.",
  permission: 'owner',
  effects: ['kv.write', 'llm', 'render', ...JOB_CREATE],
  input: z.object({
    moduleId: z.string(),
    envelope: z.object({
      text: z.string({ error: 'text is required' }),
      sender: z.string().optional().catch(undefined),
      source: z.string().optional().catch(undefined),
      receivedAt: z.string().optional().catch(undefined),
    }),
  }),
  async run(caller, { moduleId, envelope }) {
    if (!envelope.text.trim()) return { skipped: 'empty' }; // 200: a 400 stalls the forwarder (MessageScanner.kt:84-87)
    // A module credential delivers only to its own module.
    if (caller.actor.kind === 'token' && !caller.actor.id.startsWith(`${moduleId}:`)) {
      throw new OpError('forbidden', 'token not valid here');
    }
    const module = findModule(moduleId);
    if (!module || !takesMessages(module)) throw new OpError('not_found', 'no such message handler');
    const owner = caller.ownerId;
    let record = await registry.getPlugin(owner, moduleId);
    if (!record) { // Redis lost it: restore config and credentials from Postgres truth (audit M2.L8)
      await ensureRegistered(owner, { force: true });
      record = await registry.getPlugin(owner, moduleId);
    }
    // Off switch: accept the message but do nothing (no LLM call, no print).
    if (!record?.enabled) return { skipped: 'disabled' };

    const seen = seenName(owner, moduleId, envelope);
    if (!(await kv.claim(owner, seen, 'pending', PENDING_SECONDS))) {
      if ((await kv.get(owner, seen)) === 'done') return { duplicate: true };
      throw new OpError('conflict', 'this message is already being handled');
    }
    let reply;
    try {
      await seedTemplates(owner, module.templates || []);
      reply = await handle(module, envelope, record, owner);
    } catch (err) {
      // Left pending, the claim would turn the retry away until it expires.
      await kv.del(owner, seen).catch(e => console.error(`[${moduleId}] releasing the duplicate claim failed: ${e.message}`));
      throw err;
    }
    // Handled: a resent copy now answers { duplicate: true }. If this write
    // fails the claim stays pending (409s) for its 90 seconds, and only a
    // copy resent after that (this reply lost too) prints again.
    await kv.set(owner, seen, 'done', { ttlSeconds: SEEN_SECONDS })
      .catch(e => console.error(`[${moduleId}] marking the message done failed: ${e.message}`));
    return reply;
  },
});
