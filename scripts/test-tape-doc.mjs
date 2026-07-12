// scripts/test-tape-doc.mjs — checks for the take document
// (components/tape/doc.mjs): derivation runs the real pass 1-3 modules
// on a tiny synthetic take, then the edit ops, undo/redo replay, and
// version snapshots are exercised. Run: node scripts/test-tape-doc.mjs

import assert from 'node:assert/strict';

import {
  applyEdit,
  createDoc,
  reDerive,
  redo,
  undo,
} from '../components/tape/doc.mjs';

// two clean, well-separated notes the skeleton pass keeps as-is
const NOTES = [
  { t0: 0.5, t1: 1.6, midi: 64, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
  { t0: 2.4, t1: 3.5, midi: 62, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
];

let doc = createDoc({ notes: NOTES, melodyFloorHz: 230, createdAt: 1 });
assert.equal(doc.timeline.length, 2, 'derivation keeps both notes');
assert.deepEqual(
  doc.timeline.map((e) => e.id),
  ['n0', 'n1'],
  'ids assigned in order',
);
assert.equal(doc.timeline[0].midi, 64);

// setPitch
doc = applyEdit(doc, { op: 'setPitch', id: 'n0', midi: 65 });
assert.equal(doc.timeline[0].midi, 65, 'setPitch applies');
assert.equal(doc.base[0].midi, 64, 'base is untouched');
assert.equal(doc.edits.length, 1);

// invalid op is not recorded
const same = applyEdit(doc, { op: 'setPitch', id: 'nope', midi: 60 });
assert.equal(same, doc, 'unknown id is a no-op and not recorded');

// split mints deterministic child ids
doc = applyEdit(doc, { op: 'split', id: 'n1', t: 3.0 });
assert.equal(doc.timeline.length, 3, 'split adds a note');
assert.deepEqual(
  doc.timeline.slice(1).map((e) => e.id),
  ['n1a', 'n1b'],
  'split ids are deterministic',
);
assert.equal(doc.timeline[1].t1, 3.0);
assert.equal(doc.timeline[2].t0, 3.0);

// join merges with the next main note
doc = applyEdit(doc, { op: 'join', id: 'n1a', t: undefined });
assert.equal(doc.timeline.length, 2, 'join removes the absorbed note');
assert.equal(doc.timeline[1].t1, 3.5, 'joined note spans both');

// undo/redo replays deterministically
const before = JSON.stringify(doc.timeline);
doc = undo(doc);
assert.equal(doc.timeline.length, 3, 'undo restores the split pair');
doc = redo(doc);
assert.equal(JSON.stringify(doc.timeline), before, 'redo reproduces exactly');

// toggle + remove
doc = applyEdit(doc, { op: 'toggleOrnament', id: 'n0' });
assert.equal(doc.timeline[0].ornament, true);
doc = applyEdit(doc, { op: 'remove', id: 'n0' });
assert.equal(doc.timeline.length, 1);

// re-derivation on an edited doc snapshots the edited state first
const editsBefore = doc.edits.length;
assert.ok(editsBefore > 0);
doc = reDerive(doc, { melodyFloorHz: 230, savedAt: 2 });
assert.equal(doc.versions.length, 1, 'reDerive snapshots an edited doc');
assert.equal(doc.versions[0].edits.length, editsBefore);
assert.equal(doc.edits.length, 0, 'edits cleared after re-derivation');
assert.equal(doc.timeline.length, 2, 'fresh derivation is back to base');

// re-derivation on a pristine doc does not snapshot
const pristine = reDerive(createDoc({ notes: NOTES, melodyFloorHz: 230 }), {
  melodyFloorHz: 240,
});
assert.equal(pristine.versions.length, 0, 'pristine reDerive: no snapshot');
assert.equal(pristine.decode.melodyFloorHz, 240);

// ---- the song layer (components/tape/song.mjs) ----
import {
  addCut,
  assembled,
  createSong,
  mainCount,
  phraseAt,
  phraseOfId,
  removeCut,
  songFromDoc,
  withPhrase,
} from '../components/tape/song.mjs';

// four notes, well separated, so cuts can land between them
const SONG_NOTES = [
  { t0: 0.5, t1: 1.6, midi: 64, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
  { t0: 2.4, t1: 3.5, midi: 62, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
  { t0: 5.0, t1: 6.1, midi: 60, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
  { t0: 7.0, t1: 8.1, midi: 59, amp: 0.8, bends: [0, 0, 0, 0], onset: 0.9 },
];

let song = createSong({ notes: SONG_NOTES, melodyFloorHz: 230, createdAt: 1 });
assert.equal(song.phrases.length, 1, 'a new song is one phrase');
assert.equal(mainCount(song), 4);
assert.ok(
  song.phrases[0].timeline[0].id.startsWith('q1.'),
  'phrase ids carry the uid prefix',
);

// cut at the third note's attack → two phrases of two notes
song = addCut(song, 5.0);
assert.equal(song.phrases.length, 2, 'cut splits into two phrases');
assert.deepEqual(song.cuts, [5.0]);
assert.equal(song.phrases[0].timeline.length, 2);
assert.equal(song.phrases[1].timeline.length, 2);
assert.equal(phraseAt(song, 4.9), 0);
assert.equal(phraseAt(song, 5.0), 1, 'a cut at t starts the new phrase');
assert.equal(assembled(song).length, 4, 'assembly stitches all phrases');
const p0id = song.phrases[0].timeline[0].id;
const p1id = song.phrases[1].timeline[0].id;
assert.notEqual(p0id, p1id, 'ids stay unique across phrases');
assert.equal(phraseOfId(song, p1id), 1, 'phraseOfId finds the owner');

// per-phrase edits stay isolated
song = withPhrase(
  song,
  1,
  applyEdit(song.phrases[1], { op: 'setPitch', id: p1id, midi: 61 }),
);
assert.equal(song.phrases[1].timeline[0].midi, 61);
assert.equal(song.phrases[0].edits.length, 0, 'phrase 0 untouched');
assert.equal(song.phrases[1].edits.length, 1);

// per-phrase floors: re-derive phrase 0 alone
song = withPhrase(song, 0, reDerive(song.phrases[0], { melodyFloorHz: 150 }));
assert.equal(song.phrases[0].decode.melodyFloorHz, 150);
assert.equal(song.phrases[1].decode.melodyFloorHz, 230, 'floors independent');
assert.equal(song.phrases[1].timeline[0].midi, 61, 'edit survives');

// removing the cut merges and snapshots the edited half
song = removeCut(song, 0, { savedAt: 9 });
assert.equal(song.phrases.length, 1, 'merge back to one phrase');
assert.deepEqual(song.cuts, []);
assert.equal(song.phrases[0].timeline.length, 4);
assert.equal(
  song.phrases[0].versions.length,
  1,
  'edited half snapshotted on merge',
);
assert.equal(song.phrases[0].versions[0].savedAt, 9);
assert.equal(
  song.phrases[0].decode.melodyFloorHz,
  150,
  'earlier phrase floor wins the merge',
);

// legacy single-doc takes adopt cleanly
const legacy = songFromDoc(createDoc({ notes: SONG_NOTES, melodyFloorHz: 230 }));
assert.equal(legacy.phrases.length, 1);
assert.equal(mainCount(legacy), 4);

console.log('tape-doc: all checks passed');
