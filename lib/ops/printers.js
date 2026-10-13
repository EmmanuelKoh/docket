// lib/ops/printers.js: the Printer page's operations. Pairing and sharing
// live in lib/devices.js (codes, tokens, the token mirror); these ops scope
// them to the caller, dispatch a typed code (pairing claims, share joins),
// and return dates as ISO strings. The device side of pairing is
// lib/ops/device-service.js#pair.
import { z } from 'zod';
import * as presence from '../device-presence.js';
import * as devices from '../devices.js';
import { defineOperation, OpError } from './define.js';

const deviceId = z.string({ error: 'id required' }).min(1, { error: 'id required' });
const iso = d => (d ? d.toISOString() : null);

// listDevices rows as JSON. Only owned rows carry shareCodeExpiresAt and
// hardwareId; keep member rows' keys as they are.
const listed = rows => rows.map(d => ({
  ...d,
  pairedAt: iso(d.pairedAt),
  ...('shareCodeExpiresAt' in d ? { shareCodeExpiresAt: iso(d.shareCodeExpiresAt) } : {}),
}));

export const printersList = defineOperation({
  name: 'printers.list',
  description: 'List the printers you own (with members and any live share code) and the ones shared with you.',
  permission: 'owner',
  effects: ['db.read'],
  input: z.object({}),
  run: async caller => listed(await devices.listDevices(caller.ownerId)),
});

export const printersStatus = defineOperation({
  name: 'printers.status',
  description: "Whether your printer is online: its last contact, and seen within 90 seconds. A member reads the shared printer's heartbeat.",
  permission: 'owner',
  effects: ['db.read', 'kv.read'],
  input: z.object({}),
  run: caller => presence.printerPresence(caller.ownerId),
});

// The Printer page: both of the above from one device listing.
export const printersOverview = defineOperation({
  name: 'printers.overview',
  description: 'Your printers (as printers.list) and whether the one you print to is online (as printers.status), in one call.',
  permission: 'owner',
  effects: ['db.read', 'kv.read'],
  input: z.object({}),
  async run(caller) {
    const rows = await devices.listDevices(caller.ownerId);
    return { devices: listed(rows), status: await presence.printerPresence(caller.ownerId, rows) };
  },
});

// A pairing code from a printer paired to another account: only its owner
// can re-pair it, until they revoke it (lib/devices.js claimDevice).
const TAKEN = 'This printer belongs to another account. Its owner can remove it on their Printer page.';

export const printersEnterCode = defineOperation({
  name: 'printers.enterCode',
  description: "Enter a code: a printed pairing code claims the new printer as yours (a printer paired to another account is refused until its owner revokes it); a share code joins someone else's printer as a member.",
  permission: 'owner',
  effects: ['db.write', 'kv.write'],
  input: z.object({
    code: z.string({ error: 'code required' }).trim().toUpperCase().min(1, { error: 'code required' }),
    name: z.string().optional().catch(undefined), // pairing only; blank = 'printer'
  }),
  async run(caller, { code, name }) {
    const claimed = await devices.claimDevice(caller.ownerId, code, name);
    if (claimed && 'taken' in claimed) throw new OpError('conflict', TAKEN);
    if (claimed) return { device: claimed };
    const joined = await devices.joinDevice(caller.ownerId, code);
    if (joined) return { device: joined, joined: true };
    throw new OpError('not_found', 'code not recognized or expired');
  },
});

export const printersShare = defineOperation({
  name: 'printers.share',
  description: 'Mint a single-use share code (15 minutes) for a printer you own; another account enters it to join.',
  permission: 'owner',
  effects: ['db.write'],
  input: z.object({ id: deviceId }),
  async run(caller, { id }) {
    const share = await devices.mintShareCode(caller.ownerId, id);
    if (!share) throw new OpError('not_found', 'not found');
    return share;
  },
});

export const printersLeave = defineOperation({
  name: 'printers.leave',
  description: 'Leave a printer shared with you: it stops printing your jobs and running your slips.',
  permission: 'owner',
  effects: ['db.write', 'kv.write'],
  destructive: true,
  input: z.object({ id: deviceId }),
  async run(caller, { id }) {
    if (!(await devices.leaveDevice(caller.ownerId, id))) throw new OpError('not_found', 'not found');
    return { ok: true };
  },
});

export const printersRemoveMember = defineOperation({
  name: 'printers.removeMember',
  description: 'Remove a member from a printer you own.',
  permission: 'owner',
  effects: ['db.write', 'kv.write'],
  destructive: true,
  input: z.object({ id: deviceId, member: z.string({ error: 'member required' }).min(1, { error: 'member required' }) }),
  async run(caller, { id, member }) {
    if (!(await devices.removeMember(caller.ownerId, id, member))) throw new OpError('not_found', 'not found');
    return { ok: true };
  },
});

export const printersRevoke = defineOperation({
  name: 'printers.revoke',
  description: 'Revoke a printer you own: its token stops working and it must be paired again.',
  permission: 'owner',
  effects: ['db.write', 'kv.write'],
  destructive: true,
  input: z.object({ id: deviceId }),
  async run(caller, { id }) {
    if (!(await devices.revokeDevice(caller.ownerId, id))) throw new OpError('not_found', 'not found');
    return { ok: true };
  },
});
