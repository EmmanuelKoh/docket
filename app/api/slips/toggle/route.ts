// POST /api/slips/toggle?id=X — flip a system slip's enabled state: read
// it (slips.get), then pass the opposite to slips.setEnabled. The click is
// the action (no Save); turning a scheduled slip on schedules its next run
// from now.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { systemSlip } from '@/app/_lib/slip-data';
import { slipsGet, slipsSetEnabled } from '@/lib/ops/slips.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req); // null -> the op answers 401 'sign in required'
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return json(async () => {
    const { record } = await slipsGet(caller, { id });
    const pair = await slipsSetEnabled(caller, {
      id,
      enabled: !record?.enabled,
    });
    return { slip: systemSlip(pair) };
  });
}
