// components/tape/song.mjs — the song layer over the take document: one
// recording and one neural decode, split by CUTS into PHRASES, each of
// which is a full take document of its own (doc.mjs) — its own melody
// floor, derived timeline, edit log, undo/redo, and versions. A phrase
// behaves exactly like a standalone clip: detection rules never reach
// across a cut, and each phrase prints as its own receipt.
//
// Cuts are timestamps (seconds), snapped to note attacks by the caller.
// They live here — not in any phrase's edit log — because they anchor to
// time and must survive per-phrase re-derivation and save/load.
//
// Pure JS, no DOM — runs in the browser and in Node (see
// scripts/test-tape-doc.mjs). Everything returns a NEW song.
//
// Shape:
//   {
//     notes:    [...],   // the whole decode (floor-independent)
//     cuts:     [sec],   // sorted, each starting a new phrase
//     phrases:  [doc],   // length = cuts.length + 1, in time order
//     nextUid:  n,       // mints stable per-phrase id prefixes (q7.n3):
//                        // indexes shift when cuts change; uids never do
//     createdAt
//   }

import { createDoc, snapshotOf } from './doc.mjs';

const windowOf = (song, k) => [
  k === 0 ? -Infinity : song.cuts[k - 1],
  k >= song.cuts.length ? Infinity : song.cuts[k],
];

// a note belongs to the phrase containing its attack
const sliceNotes = (notes, [a, b]) =>
  notes.filter((n) => n.t0 >= a && n.t0 < b);

// fine-trace frames carry t in ms
export const sliceFrames = (frames, [a, b]) =>
  (frames ?? []).filter((f) => f.t >= a * 1000 && f.t < b * 1000);

// which phrase contains time t (a cut at exactly t starts a new phrase)
export function phraseAt(song, t) {
  let k = 0;
  while (k < song.cuts.length && song.cuts[k] <= t) k++;
  return k;
}

export function phraseWindow(song, k) {
  return windowOf(song, k);
}

function mintPhrase(song, win, { melodyFloorHz, fineFrames, createdAt, uid }) {
  return createDoc({
    notes: sliceNotes(song.notes, win),
    melodyFloorHz,
    fineFrames: sliceFrames(fineFrames, win),
    createdAt,
    idPrefix: `q${uid}.`,
  });
}

export function createSong({
  notes,
  melodyFloorHz,
  fineFrames = [],
  createdAt = 0,
}) {
  const song = { notes, cuts: [], phrases: [], nextUid: 2, createdAt };
  song.phrases = [
    mintPhrase(song, [-Infinity, Infinity], {
      melodyFloorHz,
      fineFrames,
      createdAt,
      uid: 1,
    }),
  ];
  return song;
}

// adopt a legacy single-take document (saved before phrases existed)
export function songFromDoc(doc) {
  return {
    notes: doc.decode.notes,
    cuts: [],
    phrases: [doc],
    nextUid: 2,
    createdAt: doc.createdAt ?? 0,
  };
}

// Split the phrase containing t at t. The two halves re-derive from
// their note slices (each phrase is a standalone clip, so boundary rules
// stop at the cut); an edited phrase is never silently discarded — its
// state snapshots into the first half's versions.
export function addCut(song, t, { fineFrames = [], savedAt = 0 } = {}) {
  if (!Number.isFinite(t) || song.cuts.includes(t)) return song;
  const k = phraseAt(song, t);
  const [a, b] = windowOf(song, k);
  if (!(t > a && t < b)) return song;
  const old = song.phrases[k];
  const floor = old.decode.melodyFloorHz;
  const opts = { melodyFloorHz: floor, fineFrames, createdAt: old.createdAt };
  let first = mintPhrase(song, [a, t], { ...opts, uid: song.nextUid });
  const second = mintPhrase(song, [t, b], { ...opts, uid: song.nextUid + 1 });
  const carried = old.edits.length
    ? [...old.versions, snapshotOf(old, savedAt)]
    : old.versions;
  if (carried.length) first = { ...first, versions: carried };
  return {
    ...song,
    cuts: [...song.cuts, t].sort((x, y) => x - y),
    phrases: [
      ...song.phrases.slice(0, k),
      first,
      second,
      ...song.phrases.slice(k + 1),
    ],
    nextUid: song.nextUid + 2,
  };
}

// Remove cut i, merging phrases i and i+1 into one re-derived phrase
// (the earlier phrase's floor wins). Edited halves snapshot first.
export function removeCut(song, i, { fineFrames = [], savedAt = 0 } = {}) {
  if (i < 0 || i >= song.cuts.length) return song;
  const left = song.phrases[i];
  const right = song.phrases[i + 1];
  const [a] = windowOf(song, i);
  const [, b] = windowOf(song, i + 1);
  let merged = mintPhrase(song, [a, b], {
    melodyFloorHz: left.decode.melodyFloorHz,
    fineFrames,
    createdAt: left.createdAt,
    uid: song.nextUid,
  });
  const carried = [
    ...left.versions,
    ...(left.edits.length ? [snapshotOf(left, savedAt)] : []),
    ...right.versions,
    ...(right.edits.length ? [snapshotOf(right, savedAt)] : []),
  ];
  if (carried.length) merged = { ...merged, versions: carried };
  return {
    ...song,
    cuts: song.cuts.filter((_, j) => j !== i),
    phrases: [
      ...song.phrases.slice(0, i),
      merged,
      ...song.phrases.slice(i + 2),
    ],
    nextUid: song.nextUid + 1,
  };
}

// swap one phrase (after a doc.mjs operation on it)
export function withPhrase(song, k, phrase) {
  const phrases = song.phrases.slice();
  phrases[k] = phrase;
  return { ...song, phrases };
}

// which phrase owns a timeline entry id (ids carry the phrase prefix)
export function phraseOfId(song, id) {
  return song.phrases.findIndex((p) => p.timeline.some((e) => e.id === id));
}

// the whole song's timeline, phrases stitched in time order
export function assembled(song) {
  return song.phrases.flatMap((p) => p.timeline);
}

export function mainCount(song) {
  return assembled(song).filter((e) => !e.mark).length;
}
