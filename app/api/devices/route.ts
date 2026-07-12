// /api/devices — the owner's paired printers. GET lists, POST claims a
// printed pairing code (this is the moment a device gets an owner and a
// token), DELETE revokes one.

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { claimDevice, listDevices, revokeDevice } from '@/lib/devices.js';

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
  if (!claimed) {
    return Response.json(
      { error: 'no unexpired pairing with that code' },
      { status: 404 },
    );
  }
  return Response.json({ device: claimed });
}

export async function DELETE(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('id') || '';
  const ok = await revokeDevice(owner, id);
  if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
