// lib/ops/identity.js: credentials to callers. With lib/auth-server.js, the
// only lib/ entry points app/_lib may call besides operations.
import crypto from 'node:crypto';
import { DEVICE_TOKEN, OWNER_ID } from '../../config.js';
import { resolveDeviceToken } from '../devices.js';
import { deviceCaller, tokenCaller } from './caller.js';

const same = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Store failures throw (the route answers 5xx); only an unknown or revoked token returns null (401).
export async function callerForDeviceToken(token) {
  if (DEVICE_TOKEN && same(token, DEVICE_TOKEN)) {
    return deviceCaller({ ownerId: OWNER_ID, deviceId: 'legacy', owners: [OWNER_ID] });
  }
  const identity = await resolveDeviceToken(token);
  return identity ? deviceCaller(identity) : null;
}

// A module credential declared in hooks.credentials (plugins/*.js), e.g. the
// ingest token. The caller gets only `grants`, never full owner rights.
/** @param {string} moduleId @param {string} key @param {string} token @param {string[]} grants */
export async function callerForCredential(moduleId, key, token, grants) {
  const { findOwnerByCredential } = await import('../plugin-registry.js'); // keeps /next lean
  const ownerId = await findOwnerByCredential(moduleId, key, token);
  return ownerId ? tokenCaller(ownerId, `${moduleId}:${key}`, grants) : null;
}
