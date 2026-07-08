// POST /api/slips/config?id=X — save a system slip's schedule + config
// in one step, ported from the /dashboard/plugins/config handler. One save
// updates everything: record, next-due time, due-index. Invalid input
// saves nothing and returns the error for the inline red line.

import {
  requestSessionValid,
  unauthorizedJson,
} from '@/app/_lib/dashboard-session';
import { getSlip, parseConfigField } from '@/app/_lib/slip-data';
import { OWNER_ID } from '@/config.js';
import { getPlugin, reschedule, upsertPlugin } from '@/lib/plugin-registry.js';
import { validateSchedule } from '@/lib/schedule.js';
import { PLUGINS } from '@/plugins/index.js';

type PluginModule = {
  id: string;
  passive?: boolean;
  defaults?: { config?: Record<string, unknown> };
};

export async function POST(req: Request) {
  if (!requestSessionValid(req)) return unauthorizedJson();

  const id = new URL(req.url).searchParams.get('id') || '';
  const record = await getPlugin(OWNER_ID, id);
  if (!record) return Response.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) || {};
  const module = (PLUGINS as PluginModule[]).find((m) => m.id === record.id);
  const passive = !!module?.passive;
  let error = '';

  // Schedule: type is fixed by the plugin (every vs at); the user edits
  // its values. Passive plugins have no schedule fields.
  let schedule = record.schedule || null;
  if (!passive) {
    const raw = record.schedule?.at
      ? { at: body.sched_at, timezone: body.sched_tz }
      : { every: body.sched_every };
    const v = validateSchedule(raw);
    if (v.error) error = `schedule: ${v.error} (not saved)`;
    else schedule = v.schedule;
  }

  const config = { ...(record.config || {}) };
  if (!error) {
    // Types come from the plugin's defaults.config (canonical), not the
    // stored value — a previously mistyped value must not weaken parsing.
    const defaultsCfg = module?.defaults?.config || {};
    for (const key of Object.keys(config)) {
      const raw = body[`cfg_${key}`];
      if (raw === undefined) continue; // field not submitted — keep as is
      const typeRef = key in defaultsCfg ? defaultsCfg[key] : config[key];
      const parsed = parseConfigField(typeRef, raw);
      if (parsed.error) {
        error = `${key} ${parsed.error} (not saved)`;
        break;
      }
      config[key] = parsed.value;
    }
  }

  if (error) return Response.json({ error }, { status: 400 });

  const updated = { ...record, schedule, config };
  // One save updates everything: record, next-due time, due-index.
  if (!passive && updated.enabled) reschedule(updated);
  await upsertPlugin(updated, { create: false });
  return Response.json({ slip: await getSlip(id) });
}
