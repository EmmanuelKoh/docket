// POST /api/slips/toggle?id=X — flip a system slip's enabled state.
// The click is the action (no Save); setEnabled recomputes the next-due
// time and due-index itself (schedule-aware, from the scheduler redesign).

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { getSlip } from '@/app/_lib/slip-data';
import { getPlugin, setEnabled } from '@/lib/plugin-registry.js';

export async function POST(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('id') || '';
  const record = await getPlugin(owner, id);
  if (!record) return Response.json({ error: 'not found' }, { status: 404 });

  await setEnabled(owner, id, !record.enabled);
  return Response.json({ slip: await getSlip(owner, id) });
}
