// components/tape/doc.mjs — the take document: the editable score that
// sits between the neural decode and the renderer. The decode passes
// (scripts/tape-eval/) turn raw model notes into an interpreted timeline;
// this module makes that timeline a first-class object the user can edit
// (Phase 2 UI) and later save (Phase 3), instead of something that only
// exists for a moment inside a render call.
//
// Pure JS, no DOM — runs in the browser and in Node (see
// scripts/test-tape-doc.mjs). All functions return a NEW doc; nothing
// mutates, which is what makes undo/redo a replay and versions cheap.
//
// Shape:
//   {
//     decode:    { notes, melodyFloorHz },  // raw model notes + floor used
//     base:      [...],  // derived timeline, ids assigned, never edited
//     edits:     [op],   // applied operations, oldest first
//     redoStack: [op],   // undone operations awaiting redo
//     timeline:  [...],  // base with edits applied — the printable truth
//     versions:  [...],  // snapshots (freeze-on-edit recovery, Phase 2+)
//     createdAt: ms epoch
//   }
//
// Timeline entries are what annotate() emits, plus an id: main notes
// { id, t0, t1, midi, grace?, slide?, ornament? } and time-anchored
// ornament marks { id, mark: true, t0 }. Ids are assigned per derivation
// (n0, n1, ...); a split mints deterministic child ids (n3a, n3b) so
// replaying an edit history always reproduces the same timeline.

import { annotate } from '../../scripts/tape-eval/marks.mjs';
import { decorate } from '../../scripts/tape-eval/ornaments.mjs';
import { skeletonize } from '../../scripts/tape-eval/skeleton.mjs';

export const floorToMidi = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));

// Run the full pass 1-3 pipeline — the SAME modules the eval corpus
// scores, so the browser and the harness can never disagree.
function deriveBase(notes, melodyFloorHz, fineFrames) {
  const opts = { melodyLoMidi: floorToMidi(melodyFloorHz) };
  const skeleton = skeletonize(notes, opts);
  const decorated = decorate(notes, skeleton, opts);
  const timeline = annotate(notes, decorated, opts, fineFrames ?? []);
  return timeline.map((e, i) => ({ ...e, id: `n${i}` }));
}

// Pass-1-only view (the "Main notes only" toggle): derived on demand,
// never edited — editing always happens on the full timeline.
export function skeletonOf(doc) {
  const opts = { melodyLoMidi: floorToMidi(doc.decode.melodyFloorHz) };
  return skeletonize(doc.decode.notes, opts);
}

export function createDoc({
  notes,
  melodyFloorHz,
  fineFrames = [],
  createdAt = 0,
}) {
  const base = deriveBase(notes, melodyFloorHz, fineFrames);
  return {
    decode: { notes, melodyFloorHz },
    base,
    edits: [],
    redoStack: [],
    timeline: base,
    versions: [],
    createdAt,
  };
}

// ---- edit operations ----
// Each op is a plain object: { op: 'setPitch'|'setTimes'|'remove'|
// 'toggleOrnament'|'toggleSlide'|'join'|'split', id, ...args }.
// An op that doesn't apply (unknown id, wrong target kind, out-of-range
// split) returns the timeline unchanged, and applyEdit refuses to record
// it — the history only ever holds ops that did something.

function applyOp(timeline, op) {
  const i = timeline.findIndex((e) => e.id === op.id);
  if (i < 0) return timeline;
  const e = timeline[i];
  const replaceAt = (entry) => [
    ...timeline.slice(0, i),
    entry,
    ...timeline.slice(i + 1),
  ];
  switch (op.op) {
    case 'setPitch':
      if (e.mark || !Number.isInteger(op.midi)) return timeline;
      return replaceAt({ ...e, midi: op.midi });
    case 'setTimes': {
      // nudge a note's boundaries (marks only carry t0)
      const t0 = op.t0 ?? e.t0;
      const t1 = e.mark ? undefined : (op.t1 ?? e.t1);
      if (!e.mark && !(t0 < t1)) return timeline;
      return replaceAt(e.mark ? { ...e, t0 } : { ...e, t0, t1 });
    }
    case 'remove':
      return timeline.filter((_, j) => j !== i);
    case 'toggleOrnament':
      if (e.mark) return timeline;
      return replaceAt({ ...e, ornament: !e.ornament });
    case 'toggleSlide':
      if (e.mark) return timeline;
      return replaceAt({ ...e, slide: !e.slide });
    case 'join': {
      // merge this note with the NEXT main note; ornament marks that
      // sat between them decorated the junction being erased, so they
      // are dropped
      if (e.mark) return timeline;
      let j = i + 1;
      while (j < timeline.length && timeline[j].mark) j++;
      if (j >= timeline.length) return timeline;
      const merged = { ...e, t1: timeline[j].t1 };
      return [...timeline.slice(0, i), merged, ...timeline.slice(j + 1)];
    }
    case 'split': {
      if (e.mark || !(op.t > e.t0 && op.t < e.t1)) return timeline;
      const a = { ...e, id: `${e.id}a`, t1: op.t };
      // the second half is a plain re-strike: attack marks stay with
      // the first half
      const b = {
        ...e,
        id: `${e.id}b`,
        t0: op.t,
        grace: false,
        slide: false,
        ornament: false,
      };
      return [...timeline.slice(0, i), a, b, ...timeline.slice(i + 1)];
    }
    default:
      return timeline;
  }
}

export function applyEdit(doc, op) {
  const timeline = applyOp(doc.timeline, op);
  if (timeline === doc.timeline) return doc; // op did nothing — not recorded
  return { ...doc, timeline, edits: [...doc.edits, op], redoStack: [] };
}

const replay = (base, ops) => ops.reduce(applyOp, base);

export function undo(doc) {
  if (!doc.edits.length) return doc;
  const edits = doc.edits.slice(0, -1);
  return {
    ...doc,
    edits,
    timeline: replay(doc.base, edits),
    redoStack: [...doc.redoStack, doc.edits[doc.edits.length - 1]],
  };
}

export function redo(doc) {
  if (!doc.redoStack.length) return doc;
  const op = doc.redoStack[doc.redoStack.length - 1];
  return {
    ...doc,
    timeline: applyOp(doc.timeline, op),
    edits: [...doc.edits, op],
    redoStack: doc.redoStack.slice(0, -1),
  };
}

// Re-run derivation (the melody floor moved, or the fine-trace backfill
// finished and brought new ornament evidence). Re-derivation replaces
// the timeline wholesale, so if the doc has edits the current state is
// snapshotted first — the edited tape is always recoverable
// (freeze-on-edit: the UI is expected to warn before calling this on an
// edited doc, but the data is safe either way).
export function reDerive(
  doc,
  {
    melodyFloorHz = doc.decode.melodyFloorHz,
    fineFrames = [],
    savedAt = 0,
  } = {},
) {
  const versions = doc.edits.length
    ? [
        ...doc.versions,
        {
          savedAt,
          melodyFloorHz: doc.decode.melodyFloorHz,
          timeline: doc.timeline,
          edits: doc.edits,
        },
      ]
    : doc.versions;
  const base = deriveBase(doc.decode.notes, melodyFloorHz, fineFrames);
  return {
    ...doc,
    decode: { ...doc.decode, melodyFloorHz },
    base,
    edits: [],
    redoStack: [],
    timeline: base,
    versions,
  };
}
