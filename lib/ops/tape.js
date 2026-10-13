// lib/ops/tape.js: the Tape tool's saved takes. A take is meta (name,
// length, note count) plus its document (the take document and control
// settings, JSON) and its recording (a lossless WAV). Saving is two
// steps: the record and document, then the audio by the path create
// answers ('client' = the browser uploads to Blob with a token from
// tape.authorizeUpload and attaches it; 'direct' = tape.putAudio, local
// dev). Deletes are 30-day tombstones (tape.restore undoes one);
// tape.purge removes the expired ones for real. Storage is
// lib/tape-store.js; printing a take is jobs.createRaw.
import { z } from 'zod';
import * as tapeStore from '../tape-store.js';
import { defineOperation, OpError } from './define.js';
import { Binary } from './schema.js';

// Take ids are server-minted UUIDs; anything else is no take of yours.
const SAFE_ID = /^[a-z0-9-]{8,64}$/i;
const takeId = z.string({ error: 'no such take' });
function checkId(id) {
  if (!SAFE_ID.test(id)) throw new OpError('not_found', 'no such take');
}

// Stay clear of the platform's ~4.5MB request cap; a take document is
// usually tens of KB.
const MAX_DOC = 4 * 1024 * 1024;
// 10-min cap at 22.05kHz 16-bit mono is about 26MB; generous headroom.
const MAX_WAV = 64 * 1024 * 1024;

const takeDoc = z.record(z.string(), z.unknown(), { error: 'doc required' });
const optional = t => t.optional().catch(undefined);

// The document and settings as stored, refused when too big to send.
function payloadOf(settings, doc) {
  const payload = { settings, doc };
  if (JSON.stringify(payload).length > MAX_DOC) throw new OpError('too_large', 'take too large to save');
  return payload;
}

// The store's refusals as op errors; anything else is a server error.
const REFUSED = {
  'no such take': 'not_found',
  'nothing to restore': 'not_found',
  'audio upload failed': 'invalid',
  "audio upload isn't available here": 'invalid',
};
async function refusals(work) {
  try {
    return await work();
  } catch (err) {
    const code = REFUSED[err?.message];
    throw code ? new OpError(code, err.message) : err;
  }
}

export const tapeList = defineOperation({
  name: 'tape.list',
  description: 'Your saved takes, newest first: name, length, sample rate, note count and whether audio is attached. Deleted takes are left out.',
  permission: 'owner',
  effects: ['db.read'],
  input: z.object({}),
  run: caller => tapeStore.listTakes(caller.ownerId),
});

export const tapePurge = defineOperation({
  name: 'tape.purge',
  description: 'Permanently remove takes deleted more than 30 days ago, with their documents and recordings.',
  permission: 'owner',
  effects: ['db.write', 'artifact.delete'],
  destructive: true,
  input: z.object({}),
  run: async caller => ({ purged: await tapeStore.purgeTakes(caller.ownerId) }),
});

export const tapeCreate = defineOperation({
  name: 'tape.create',
  description: "Save a new take: its meta, the take document and the control settings. audio says how its recording goes up next: 'client' (upload to Blob, then tape.attachAudio) or 'direct' (tape.putAudio).",
  permission: 'owner',
  effects: ['artifact.put', 'db.write'],
  input: z.object({
    name: optional(z.string()), // blank = 'Take'
    seconds: optional(z.coerce.number()),
    sampleRate: optional(z.coerce.number()),
    noteCount: optional(z.coerce.number()),
    settings: z.unknown().optional(),
    doc: takeDoc,
  }),
  async run(caller, { name, seconds, sampleRate, noteCount, settings, doc }) {
    const payload = payloadOf(settings, doc);
    const take = await tapeStore.createTake(caller.ownerId, {
      name: name?.trim() ? name.trim().slice(0, 80) : 'Take',
      seconds: seconds || 0,
      sampleRate: sampleRate || 22050,
      noteCount: noteCount || 0,
      payload,
    });
    return { take, audio: tapeStore.audioUploadMode() };
  },
});

export const tapeGet = defineOperation({
  name: 'tape.get',
  description: 'One saved take: its meta plus the stored take document and control settings.',
  permission: 'owner',
  effects: ['db.read', 'artifact.get'],
  input: z.object({ id: takeId }),
  async run(caller, { id }) {
    checkId(id);
    const take = await tapeStore.getTake(caller.ownerId, id);
    if (!take) throw new OpError('not_found', 'no such take');
    const payload = (await tapeStore.getTakePayload(caller.ownerId, id)) || {};
    return { take, ...payload };
  },
});

// The session is tied to the take, so a save rewrites it in place; the
// recording never changes after its decode and is left alone.
export const tapeUpdate = defineOperation({
  name: 'tape.update',
  description: "Save a take again in place: new document and settings, and optionally a new name and note count. The recording is unchanged.",
  permission: 'owner',
  effects: ['artifact.put', 'artifact.delete', 'db.write'],
  input: z.object({
    id: takeId,
    name: optional(z.string()),
    noteCount: optional(z.coerce.number()),
    settings: z.unknown().optional(),
    doc: takeDoc,
  }),
  async run(caller, { id, name, noteCount, settings, doc }) {
    checkId(id);
    const payload = payloadOf(settings, doc);
    const take = await refusals(() => tapeStore.updateTake(caller.ownerId, id, { name, noteCount, payload }));
    return { take };
  },
});

export const tapeRestore = defineOperation({
  name: 'tape.restore',
  description: 'Undo a delete: bring back a take deleted within the last 30 days.',
  permission: 'owner',
  effects: ['db.write'],
  input: z.object({ id: takeId }),
  async run(caller, { id }) {
    checkId(id);
    return { take: await refusals(() => tapeStore.restoreTake(caller.ownerId, id)) };
  },
});

// Hosted: after the browser's client upload. The store accepts only an
// object it issued under tape/{owner}/{id}.
export const tapeAttachAudio = defineOperation({
  name: 'tape.attachAudio',
  description: "Attach a take's recording after a client upload to Blob, by the uploaded object's URL. Only a URL under this take's own path is accepted.",
  permission: 'owner',
  effects: ['artifact.delete', 'db.write'],
  input: z.object({ id: takeId, audioUrl: z.string({ error: 'audio upload failed' }) }),
  async run(caller, { id, audioUrl }) {
    checkId(id);
    return { take: await refusals(() => tapeStore.attachTakeAudio(caller.ownerId, id, audioUrl)) };
  },
});

// Hosted: the check behind a client-upload token (the route runs Vercel's
// handleUpload protocol and calls this from onBeforeGenerateToken).
export const tapeAuthorizeUpload = defineOperation({
  name: 'tape.authorizeUpload',
  description: "Allow a browser upload of a recording to Blob under your own tape/ path. Returns the upload's constraints.",
  permission: 'owner',
  effects: ['artifact.put'],
  input: z.object({ pathname: z.string({ error: 'unexpected upload path' }) }),
  async run(caller, { pathname }) {
    if (tapeStore.audioUploadMode() !== 'client') throw new OpError('invalid', "audio upload isn't available here");
    if (!pathname.startsWith(`tape/${caller.ownerId}/`)) throw new OpError('invalid', 'unexpected upload path');
    return { allowedContentTypes: ['audio/wav', 'audio/x-wav'], addRandomSuffix: true };
  },
});

// Local dev: the WAV is the request body (no platform request cap).
export const tapePutAudio = defineOperation({
  name: 'tape.putAudio',
  description: "Store a take's recording (a WAV, up to 64MB) directly. Only where uploads are 'direct' (local); hosted uploads use tape.attachAudio.",
  permission: 'owner',
  effects: ['artifact.put', 'db.write'],
  input: z.object({ id: takeId, audio: Binary }),
  async run(caller, { id, audio }) {
    if (tapeStore.audioUploadMode() !== 'direct') throw new OpError('invalid', 'audio upload failed');
    checkId(id);
    if (audio.body.length > MAX_WAV) throw new OpError('too_large', 'audio too large');
    return { take: await refusals(() => tapeStore.saveTakeAudio(caller.ownerId, id, audio.body)) };
  },
});

// A store with public URLs (Blob) answers its URL, which the route
// redirects to; local answers the bytes, which the route streams.
export const tapeGetAudio = defineOperation({
  name: 'tape.getAudio',
  description: "A take's recording (WAV): its public URL where the store serves one, else the bytes.",
  permission: 'owner',
  effects: ['db.read', 'artifact.get'],
  input: z.object({ id: takeId }),
  output: z.union([z.object({ url: z.string() }), z.object({ audio: Binary })]),
  async run(caller, { id }) {
    checkId(id);
    const found = await tapeStore.getTakeAudio(caller.ownerId, id);
    if (found?.url) return { url: found.url };
    if (found?.buffer) return { audio: { contentType: 'audio/wav', body: found.buffer } };
    throw new OpError('not_found', 'no audio for this take');
  },
});

export const tapeDelete = defineOperation({
  name: 'tape.delete',
  description: 'Delete a take. It is hidden at once and removed for good after 30 days; tape.restore undoes it until then.',
  permission: 'owner',
  effects: ['db.write'],
  input: z.object({ id: takeId }),
  async run(caller, { id }) {
    checkId(id);
    await tapeStore.deleteTake(caller.ownerId, id);
    return { ok: true };
  },
});
