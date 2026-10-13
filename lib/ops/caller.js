// lib/ops/caller.js: who is calling, as a value. ownerId scopes every store call.
/**
 * @typedef {{ kind: 'user' | 'system' | 'token', id: string }
 *   | { kind: 'device', id: string, owners: string[] }} Actor
 * @typedef {{ ownerId: string | null, actor: Actor, role: 'admin' | 'user' | null,
 *   grants: string[] | null }} Caller
 */
// device: id = device row id ('legacy' for the dev DEVICE_TOKEN), owners = [primary, ...members]
// token:  id = '<moduleId>:<config key>' of the credential that matched
// grants: null = the actor's full rights; a list = only these op names ('read' = every readOnly op)
// Typed so app/ TypeScript sees a Caller (inferred JS literals widen to string).
/** @type {(identity: { userId: string, role: string }) => Caller} */
export const userCaller = ({ userId, role }) => ({ ownerId: userId,
  actor: { kind: 'user', id: userId }, role: role === 'admin' ? 'admin' : 'user', grants: null });
/** @type {(identity: { ownerId: string, deviceId: string, owners: string[] }) => Caller} */
export const deviceCaller = ({ ownerId, deviceId, owners }) =>
  ({ ownerId, actor: { kind: 'device', id: deviceId, owners }, role: null, grants: [] });
/** @param {string} ownerId @param {string} credentialId @param {string[]} grants @returns {Caller} */
export function tokenCaller(ownerId, credentialId, grants) {
  if (!grants?.length) throw new Error('tokenCaller: grants required'); // never full owner rights
  return { ownerId, actor: { kind: 'token', id: credentialId }, role: null, grants };
}
// Scripts: owner rights; only scripts/create-user.js passes { admin: true }.
/** @type {(ownerId?: string | null, id?: string, opts?: { admin?: boolean }) => Caller} */
export const systemCaller = (ownerId = null, id = 'cli', { admin = false } = {}) =>
  ({ ownerId, actor: { kind: 'system', id }, role: admin ? 'admin' : null, grants: null });
