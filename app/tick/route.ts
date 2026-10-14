// app/tick/route.ts — POST /tick
// The heartbeat endpoint. Plugins never run on a server timer: each
// paired device POSTs here every TICK_MS, and this handler runs
// whichever of its owners' plugins are due. The run loop, the idle tick
// flag and its safety window live in lib/ops/device-service.js#runDue
// (docs/store-costs.md has the cost math).

import { runDue } from '@/lib/ops/device-service.js';
import {
  deviceCaller,
  deviceErrorResponse,
  unauthorized,
} from '../_lib/device-auth';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const caller = await deviceCaller(req);
    if (!caller) return unauthorized();
    return Response.json(await runDue(caller));
  } catch (err) {
    return deviceErrorResponse(err);
  }
}
