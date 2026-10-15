// POST /api/slips/toggle?id=X&enabled=true|false — switch a system slip on
// or off (slips.setEnabled). Send the wanted state: a double click or a
// second tab then repeats the same choice instead of undoing it. Without
// a valid `enabled` the route flips the stored state (read with
// slips.get), for older callers. The click is the action (no Save);
// turning a scheduled slip on schedules its next run from now.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { systemSlip } from '@/app/_lib/slip-data';
import { slipsGet, slipsSetEnabled } from '@/lib/ops/slips.js';

export async function POST(req: Request) {
  const caller = await requestCaller(req); // null -> the op answers 401 'sign in required'
  const params = new URL(req.url).searchParams;
  const id = params.get('id') ?? '';
  const raw = params.get('enabled');
  const wanted = raw === 'true' ? true : raw === 'false' ? false : undefined;
  return json(async () => {
    let enabled = wanted;
    if (enabled === undefined) {
      const { record } = await slipsGet(caller, { id });
      enabled = !record?.enabled;
    }
    const pair = await slipsSetEnabled(caller, { id, enabled });
    return { slip: systemSlip(pair) };
  });
}
