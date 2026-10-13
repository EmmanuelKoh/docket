// app/_lib/caller.ts: the session as an operation Caller (lib/ops/caller.js).

import { cache } from 'react';
import { type Caller, userCaller } from '@/lib/ops/caller.js';
import {
  getSessionIdentity,
  requestSessionIdentity,
} from './dashboard-session';

// Pages and layouts: one session lookup per request, shared by layout and page.
export const getCaller = cache(async (): Promise<Caller | null> => {
  const identity = await getSessionIdentity();
  return identity ? userCaller(identity) : null;
});

// Route handlers get the Request directly.
export async function requestCaller(req: Request): Promise<Caller | null> {
  const identity = await requestSessionIdentity(req);
  return identity ? userCaller(identity) : null;
}
