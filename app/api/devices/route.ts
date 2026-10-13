// /api/devices — the owner's paired printers (lib/ops/printers.js).
//   GET             list own + shared-with-me devices
//   POST {code}     enter a code: a PAIRING code claims ownership of a new
//                   device; a SHARE code joins someone else's as a member
//   PATCH {id}      mint a share code for a device you own (shown in the
//                   dashboard, single-use, 15 minutes)
//   DELETE ?id=     revoke a device you own
//   DELETE ?id=&leave        leave a device shared with you
//   DELETE ?id=&member=<id>  remove a member from a device you own

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import {
  printersEnterCode,
  printersLeave,
  printersList,
  printersRemoveMember,
  printersRevoke,
  printersShare,
} from '@/lib/ops/printers.js';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  return json(async () => ({ devices: await printersList(caller) }));
}

export async function POST(req: Request) {
  const caller = await requestCaller(req);
  const body = await req.json().catch(() => null);
  return json(() =>
    printersEnterCode(caller, { code: body?.code, name: body?.name }),
  );
}

export async function PATCH(req: Request) {
  const caller = await requestCaller(req);
  const body = await req.json().catch(() => null);
  return json(() => printersShare(caller, { id: body?.id }));
}

export async function DELETE(req: Request) {
  const caller = await requestCaller(req);
  const params = new URL(req.url).searchParams;
  const id = params.get('id') ?? '';
  const member = params.get('member');
  return json(() =>
    member
      ? printersRemoveMember(caller, { id, member })
      : params.has('leave')
        ? printersLeave(caller, { id })
        : printersRevoke(caller, { id }),
  );
}
