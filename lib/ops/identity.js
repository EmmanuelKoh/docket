// lib/ops/identity.js: credentials to callers. With lib/auth-server.js, the
// only lib/ entry points app/_lib may call besides operations.
import crypto from 'node:crypto';
import { DEVICE_TOKEN, OWNER_ID } from '../../config.js';
import { resolveDeviceToken } from '../devices.js';
import { deviceCaller, tokenCaller } from './caller.js';
import { OpError } from './define.js';

const same = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Unknown-token floods. A well-shaped token that no memory cache knows
// costs Redis and Postgres reads (docs/store-costs.md), and anyone can
// send one, so each warm instance allows at most 30 such lookups a minute
// for device tokens and 30 for module credentials. Past that the lookup is
// refused with OpError 'busy' (the route answers 503 or 429 with
// Retry-After) and retried later. A token that has resolved on this
// instance before never spends the budget, even after its cache entry
// expires (lib/devices.js and lib/plugin-registry.js keep those), so a
// flood never takes a printer that this instance has served offline.
export const UNKNOWN_LOOKUPS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

function lookupBudget() {
  let windowStart = 0;
  let used = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= WINDOW_MS) {
      windowStart = now;
      used = 0;
    }
    if (used < UNKNOWN_LOOKUPS_PER_MINUTE) {
      used++;
      return;
    }
    throw Object.assign(new OpError('busy', 'too many unknown tokens; retry later'), {
      retryAfter: Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000)),
    });
  };
}
const deviceLookups = lookupBudget();
const credentialLookups = lookupBudget();

// Store failures throw (the route answers 5xx); only an unknown or revoked
// token returns null (401). Over the lookup budget: OpError 'busy'.
// The dev DEVICE_TOKEN is matched first: resolveDeviceToken refuses any
// token not shaped like a minted one before touching a store.
export async function callerForDeviceToken(token) {
  if (DEVICE_TOKEN && same(token, DEVICE_TOKEN)) {
    return deviceCaller({ ownerId: OWNER_ID, deviceId: 'legacy', owners: [OWNER_ID] });
  }
  const identity = await resolveDeviceToken(token, { beforeLookup: deviceLookups });
  return identity ? deviceCaller(identity) : null;
}

// A module credential declared in hooks.credentials (plugins/*.js), e.g. the
// ingest token. The caller gets only `grants`, never full owner rights.
/** @param {string} moduleId @param {string} key @param {string} token @param {string[]} grants */
export async function callerForCredential(moduleId, key, token, grants) {
  const { findOwnerByCredential } = await import('../plugin-registry.js'); // keeps /next lean
  const ownerId = await findOwnerByCredential(moduleId, key, token, {
    beforeLookup: credentialLookups,
  });
  return ownerId ? tokenCaller(ownerId, `${moduleId}:${key}`, grants) : null;
}
