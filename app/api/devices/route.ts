// /api/devices — the owner's paired printers.
//   GET             list own + shared-with-me devices
//   POST {code}     enter a code: a PAIRING code claims ownership of a new
//                   device; a SHARE code joins someone else's as a member
//   PATCH {id}      mint a share code for a device you own (shown in the
//                   dashboard, single-use, 15 minutes)
//   DELETE ?id=     revoke a device you own
//   DELETE ?id=&leave        leave a device shared with you
//   DELETE ?id=&member=<id>  remove a member from a device you own

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import {
  claimDevice,
  joinDevice,
  leaveDevice,
  listDevices,
  mintShareCode,
  removeMember,
  revokeDevice,
} from '@/lib/devices.js';

export async function GET(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  return Response.json({ devices: await listDevices(owner) });
}

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const body = await req.json().catch(() => ({}));
  const code =
    typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const name = typeof body.name === 'string' ? body.name : '';
  if (!code) return Response.json({ error: 'code required' }, { status: 400 });

  const claimed = await claimDevice(owner, code, name);
  if (claimed) return Response.json({ device: claimed });

  const joined = await joinDevice(owner, code);
  if (joined) return Response.json({ device: joined, joined: true });

  return Response.json(
    { error: 'no unexpired pairing or share code matches' },
    { status: 404 },
  );
}

export async function PATCH(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  const share = await mintShareCode(owner, id);
  if (!share) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(share);
}

export async function DELETE(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const params = new URL(req.url).searchParams;
  const id = params.get('id') || '';
  const member = params.get('member');
  const leave = params.has('leave');

  const ok = member
    ? await removeMember(owner, id, member)
    : leave
      ? await leaveDevice(owner, id)
      : await revokeDevice(owner, id);
  if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
