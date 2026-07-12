// GET /api/queue — JSON for the Queue page's poll. The client polls every
// 3 seconds ONLY while the tab is visible (components/queue-list.tsx);
// hidden tabs must never keep hitting the store (docs/store-costs.md).

import { requestOwner, unauthorizedJson } from '@/app/_lib/dashboard-session';
import { queueData } from '@/app/_lib/queue-data';

export async function GET(req: Request) {
  const owner = await requestOwner(req);
  if (!owner) return unauthorizedJson();
  return Response.json(await queueData(owner));
}
