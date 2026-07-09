// scripts/tape-eval/skeleton.mjs — pass 1 of the Tape v2 pipeline:
// reduce Basic Pitch's polyphonic note events to the MAIN MELODY
// skeleton (long confident notes and rests only; ornaments are pass 2).
//
// Rules, each earned against the fixture clips (docs/
// tape-transcription-v2.md):
// - merge same-pitch runs FIRST, gate on the merged note's PEAK
//   amplitude — a loud note's soft crescendo start belongs to it, and
//   chopping it fabricates a rest (and a breath mark on tape)
// - absorb short, WEAKER one-semitone-above crests into the adjacent
//   longer note: a sharp player's upward vibrato crosses Basic Pitch's
//   fixed A440 grid line and emits phantom neighbors; the amplitude
//   test protects real short notes, which are not weaker than their
//   surroundings
// - the melody register band is a per-instrument profile for now;
//   deriving it from the take is on the robustness checklist

export const SKELETON_DEFAULTS = {
  melodyLoMidi: 58, // A#3 — duduk-in-A profile
  melodyHiMidi: 80, // G#5
  candidateAmp: 0.3, // ignore Basic Pitch events below this outright
  peakAmp: 0.5, // a skeleton note's peak amplitude must reach this
  mergeGapSec: 0.15, // same-pitch segments this close are one note
  minLenSec: 0.12, // shorter notes belong to the ornament pass
  crestMaxSec: 0.3, // upward-crest absorption: max crest length
  crestReachSec: 0.25, // ...and max distance from the parent note
  restSec: 0.4, // gaps at least this long are rests
};

function mergeRuns(notes, gapSec) {
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last.midi === n.midi && n.t0 - last.t1 <= gapSec) {
      last.t1 = Math.max(last.t1, n.t1);
      last.amp = Math.max(last.amp, n.amp);
      last.parts += n.parts ?? 1;
    } else {
      out.push({ ...n, parts: n.parts ?? 1 });
    }
  }
  return out;
}

// notes: [{ t0, t1, midi, amp }] from transcribe() -> skeleton notes
// [{ t0, t1, midi, amp, parts }] (parts = articulation count, an input
// to the ornament pass)
export function skeletonize(notes, opts = {}) {
  const o = { ...SKELETON_DEFAULTS, ...opts };
  const mel = notes
    .filter(
      (n) =>
        n.midi >= o.melodyLoMidi &&
        n.midi <= o.melodyHiMidi &&
        n.amp >= o.candidateAmp,
    )
    .sort((a, b) => a.t0 - b.t0);

  let merged = mergeRuns(mel, o.mergeGapSec);

  // absorb upward crests (see header)
  for (let i = 0; i < merged.length; i++) {
    const n = merged[i];
    if (!n || n.t1 - n.t0 > o.crestMaxSec) continue;
    for (const j of [i - 1, i + 1]) {
      const nb = merged[j];
      if (
        nb &&
        nb.midi === n.midi - 1 &&
        nb.t1 - nb.t0 > n.t1 - n.t0 &&
        n.amp < nb.amp &&
        n.t0 <= nb.t1 + o.crestReachSec &&
        n.t1 >= nb.t0 - o.crestReachSec
      ) {
        // never drag a note's start backward: a crest BEFORE the note
        // is a scoop overshoot and is simply dropped
        if (n.t0 >= nb.t0) nb.t1 = Math.max(nb.t1, n.t1);
        nb.parts += n.parts;
        merged[i] = null;
        break;
      }
    }
  }
  merged = merged.filter(Boolean);

  // gate, then re-merge: dropping an interleaved ornament fragment can
  // leave two halves of one note adjacent again
  const gated = merged.filter(
    (n) => n.amp >= o.peakAmp && n.t1 - n.t0 >= o.minLenSec,
  );
  const skeleton = mergeRuns(gated, o.mergeGapSec);

  // sequentialize: Basic Pitch is polyphonic, so skeleton notes can
  // still overlap at the edges — a monophonic tape needs strict order
  // (the later note wins the contested span)
  for (let i = 1; i < skeleton.length; i++) {
    if (skeleton[i].t0 < skeleton[i - 1].t1) {
      skeleton[i - 1].t1 = skeleton[i].t0;
    }
  }
  return skeleton.filter((n) => n.t1 - n.t0 > 0.02);
}

// convenience: skeleton + rests as one printable sequence. Rests only
// BETWEEN notes — leading silence before the first note is not a rest.
export function skeletonSequence(skeleton, restSec = SKELETON_DEFAULTS.restSec) {
  const seq = [];
  let prev = null;
  for (const n of skeleton) {
    if (prev !== null && n.t0 - prev >= restSec) {
      seq.push({ rest: true, sec: n.t0 - prev });
    }
    seq.push(n);
    prev = n.t1;
  }
  return seq;
}
