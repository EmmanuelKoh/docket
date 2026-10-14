// app/nack/route.ts — POST /nack?job=ID
// Device-facing endpoint. Requeues a job after a failed print attempt:
// at the front, or at the back once it has failed 3 times. A job whose
// owner is no longer on the device answers 200 {gone: true}.

import { nack } from '@/lib/ops/device-service.js';
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
    return Response.json(await nack(caller, id));
  } catch (err) {
    return deviceErrorResponse(err);
  }
}
