// /api/users/invites — mint and revoke invite links (lib/ops/accounts.js).
// Admin only.
//   POST {email?}    mint a link; an email pins it to that address
//   DELETE ?token=   revoke a link

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { invitesCreate, invitesRevoke } from '@/lib/ops/accounts.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = await req.json().catch(() => null);
  return json(() => invitesCreate(caller, { email: body?.email }));
}

export async function DELETE(req: Request) {
  const caller = await requestCaller(req);
  const token = new URL(req.url).searchParams.get('token') ?? '';
  return json(() => invitesRevoke(caller, { token }));
}
