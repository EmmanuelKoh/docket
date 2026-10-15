// GET /api/queue: JSON for the Queue page's poll. The client polls ONLY
// while the tab is visible, on the eased cadence (3s while active, 30s
// after two idle minutes, paused after thirty; components/queue-list.tsx);
// hidden tabs must never keep hitting the store (docs/store-costs.md).

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { queueData } from '@/app/_lib/queue-data';
import { requestTimeZone } from '@/app/_lib/time';

export async function GET(req: Request) {
  const caller = await requestCaller(req);
  return json(() => queueData(caller, requestTimeZone(req)));
}
