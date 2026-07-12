// components/tape/persist.js — the Tape tool's client for the takes API
// (/api/tape/takes). Saving is two steps: the record + take document go
// up as JSON, then the audio WAV follows by whichever path the server
// answers for — 'client' (straight to Vercel Blob via a minted token;
// hosted takes exceed the platform request cap) or 'direct' (a PUT to
// our own route; the local JSON driver). Loading reverses it: record +
// document from the API, audio through /audio (which redirects or
// streams — the client never knows which driver is live).

async function jsonOrThrow(r) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `request failed (${r.status})`);
  return body;
}

export async function fetchTakes() {
  const { takes } = await jsonOrThrow(await fetch('/api/tape/takes'));
  return takes;
}

export async function saveTake({
  name,
  seconds,
  sampleRate,
  noteCount,
  settings,
  doc,
  wav,
  onStatus,
}) {
  onStatus?.('saving take…');
  const { take, audio } = await jsonOrThrow(
    await fetch('/api/tape/takes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        seconds,
        sampleRate,
        noteCount,
        settings,
        doc,
      }),
    }),
  );
  onStatus?.('uploading audio…');
  if (audio === 'client') {
    const { upload } = await import('@vercel/blob/client');
    const result = await upload(`tape/${take.ownerId}/${take.id}.wav`, wav, {
      access: 'public',
      handleUploadUrl: '/api/tape/takes/upload',
      contentType: 'audio/wav',
    });
    await jsonOrThrow(
      await fetch(`/api/tape/takes/${take.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: result.url }),
      }),
    );
  } else {
    await jsonOrThrow(
      await fetch(`/api/tape/takes/${take.id}/audio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      }),
    );
  }
  return take;
}

// update a saved take in place — document/settings/name only; the audio
// never changes after a decode, so nothing heavy moves
export async function updateTake(
  id,
  { name, noteCount, settings, doc, onStatus },
) {
  onStatus?.('saving take…');
  const { take } = await jsonOrThrow(
    await fetch(`/api/tape/takes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, noteCount, settings, doc }),
    }),
  );
  return take;
}

export async function loadTake(id) {
  const { take, settings, doc } = await jsonOrThrow(
    await fetch(`/api/tape/takes/${id}`),
  );
  if (!doc) throw new Error('take has no document');
  let audio = null;
  if (take.hasAudio) {
    const r = await fetch(`/api/tape/takes/${id}/audio`);
    if (r.ok) audio = await r.blob();
    // a missing recording degrades gracefully: the tape still renders,
    // edits, and prints — only playback and the pitch trace need audio
  }
  return { take, settings, doc, audio };
}

// deletes are soft: the record is tombstoned and hidden for 30 days
// before its payloads are purged — restoreTake undoes one
export async function deleteTake(id) {
  await jsonOrThrow(await fetch(`/api/tape/takes/${id}`, { method: 'DELETE' }));
}

export async function restoreTake(id) {
  const { take } = await jsonOrThrow(
    await fetch(`/api/tape/takes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    }),
  );
  return take;
}
