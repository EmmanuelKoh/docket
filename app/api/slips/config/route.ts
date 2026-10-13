// POST /api/slips/config?id=X — save a system slip's schedule + config in
// one step (slips.saveConfig). The Slips form posts flat fields: sched_every,
// sched_at and sched_tz for the schedule, cfg_<key> for each config key;
// this maps them to { schedule, config }. Invalid input saves nothing and
// answers 400 with the error for the inline red line.

import { requestCaller } from '@/app/_lib/caller';
import { json } from '@/app/_lib/http';
import { systemSlip } from '@/app/_lib/slip-data';
import { slipsSaveConfig } from '@/lib/ops/slips.js';

const SCHEDULE_FIELDS = {
  sched_every: 'every',
  sched_at: 'at',
  sched_tz: 'timezone',
} as const;

// Fields left out of the form stay out of the input, so the op keeps
// their stored values.
function fromForm(body: Record<string, unknown>) {
  const schedule: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(SCHEDULE_FIELDS)) {
    if (body[field] !== undefined) schedule[key] = body[field];
  }
  const config: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body)) {
    if (field.startsWith('cfg_')) config[field.slice('cfg_'.length)] = value;
  }
  return {
    schedule: Object.keys(schedule).length ? schedule : undefined,
    config,
  };
}

export async function POST(req: Request) {
  const caller = await requestCaller(req); // null -> the op answers 401 'sign in required'
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return json(async () => ({
    slip: systemSlip(await slipsSaveConfig(caller, { id, ...fromForm(body) })),
  }));
}
