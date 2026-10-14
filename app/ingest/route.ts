// app/ingest/route.ts — POST /ingest
// Receives messages forwarded from a phone and hands each to the
// message-ingest module (messages.deliver -> onMessage in
// plugins/message-ingest.js), which asks Gemini for the tasks in it and
// prints a slip for each.
//
// Auth: each owner's message-ingest config carries its own ingestToken (a
// hooks.credentials key, minted at registration, visible and editable on
// the Slips page), as a Bearer header or ?token=. The token both
// authenticates the sender and routes the message to its owner, and grants
// messages.deliver only. It resolves from a kv mirror; Postgres answers
// only on a mirror miss, and a token it did not know is refused from
// memory for the next minute (lib/plugin-registry.js
// findOwnerByCredential). A token no config could hold (over 128
// characters, spaces, non-ASCII) is refused before any lookup.
//
// Each warm instance looks up at most 30 tokens a minute that it does not
// already know (lib/ops/identity.js); past that /ingest answers 429 with
// Retry-After, and the forwarder retries on its next scan.
//
// Statuses the forwarder sees: 401 bad token, 429 too many unknown
// tokens, 400 no text, 200 handled (blank text answers
// { skipped: 'empty' }, a message already handled in the last 15 minutes
// { duplicate: true }), 409 the same message is still being handled, 502
// handling failed. It retries anything but a 2xx on its next scan.

import { errorResponse, json } from '@/app/_lib/http';
import { callerForCredential } from '@/lib/ops/identity.js';
import { messagesDeliver } from '@/lib/ops/messages.js';

export const maxDuration = 60;

export async function POST(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : new URL(req.url).searchParams.get('token') || '';
  let caller: Awaited<ReturnType<typeof callerForCredential>> = null;
  try {
    caller = token
      ? await callerForCredential('message-ingest', 'ingestToken', token, [
          'messages.deliver',
        ])
      : null;
  } catch (err) {
    // OpError 'busy' answers 429; a store failure stays a bare 500.
    if ((err as { name?: string })?.name === 'OpError')
      return errorResponse(err);
    throw err;
  }
  if (!caller) {
    return Response.json(
      { error: 'missing or invalid ingest token' },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const envelope = body && typeof body === 'object' ? body : {};
  return json(() =>
    messagesDeliver(caller, { moduleId: 'message-ingest', envelope }),
  );
}
