// app/ack/route.ts — POST /ack?job=ID
// Device-facing endpoint. Marks a job as done after a successful print.
// A job whose owner is no longer on the device answers 200 {gone: true}
// and changes nothing, which ends the firmware's ack retry.

import { ack } from '@/lib/ops/device-service.js';
import {
  deviceCaller,
  deviceErrorResponse,
  unauthorized,
} from '../_lib/device-auth';

export async function POST(req: Request) {
  try {
    const caller = await deviceCaller(req);
    if (!caller) return unauthorized();
    const id = new URL(req.url).searchParams.get('job');
    return Response.json(await ack(caller, id));
  } catch (err) {
    return deviceErrorResponse(err);
  }
}
