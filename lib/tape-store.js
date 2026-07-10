// lib/tape-store.js — saved-takes storage facade for the Tape tool.
// A take = meta (name, duration, note count) + payload (the take document
// and control settings, JSON) + the recording (16-bit mono WAV, lossless
// on purpose: re-transcription must reproduce the saved tape exactly).
//
// Same interface, two drivers, selected by STORE_DRIVER:
//   json  — local dev fallback; payloads and WAVs as files in data/tape/
//   redis — meta in Upstash, payload + audio in Vercel Blob; the audio
//           WAV is uploaded straight from the browser (client upload)
// Callers never know which is active. All functions are async.

import { STORE_DRIVER } from '../config.js';

const impl = STORE_DRIVER === 'redis'
  ? await import('./stores/tape-redis.js')
  : await import('./stores/tape-json.js');

export const audioUploadMode = impl.audioUploadMode;
export const listTakes = impl.listTakes;
export const getTake = impl.getTake;
export const createTake = impl.createTake;
export const updateTake = impl.updateTake;
export const saveTakeAudio = impl.saveTakeAudio;
export const attachTakeAudio = impl.attachTakeAudio;
export const getTakePayload = impl.getTakePayload;
export const getTakeAudio = impl.getTakeAudio;
export const deleteTake = impl.deleteTake; // soft: tombstone, 30-day purge
export const restoreTake = impl.restoreTake;
