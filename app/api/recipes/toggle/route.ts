// POST /api/recipes/toggle?id=X — flip a system recipe's enabled state.
// The click is the action (no Save); setEnabled recomputes the next-due
// time and due-index itself (schedule-aware, from the scheduler redesign).

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getRecipe } from '@/app/_lib/recipe-data';
import { OWNER_ID } from '@/config.js';
import { getPlugin, setEnabled } from '@/lib/plugin-registry.js';

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('id') || '';
  const record = await getPlugin(OWNER_ID, id);
  if (!record) return Response.json({ error: 'not found' }, { status: 404 });

  await setEnabled(OWNER_ID, id, !record.enabled);
  return Response.json({ recipe: await getRecipe(id) });
}
