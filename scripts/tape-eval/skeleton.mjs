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
// - rescue short dips BETWEEN two segments of the same higher pitch
//   (E4 D#4 E4): dropping the dip fuses its neighbors into one long
//   wrong note, double damage. Exception: a dip right after a LONG
//   hold is an ornamented rearticulation (pass 2), not a melody note —
//   duduk ornaments before a re-struck note dip below it briefly
// - drop reverb tails: the previous note's reverb rings under the next
//   note's start and Basic Pitch reports it as a weaker second note of
//   the old pitch; "later note wins" would hand it the contested span
// - tuning re-snap (robustness item 5): Basic Pitch's grid is fixed at
//   A440 but the player runs sharp with per-take drift, so a note
//   played sharp of the grid line (D#4 with upward vibrato) is labeled
//   as its upper neighbor (E4). Estimate the take's own bend center,
//   then re-snap DOWN only SUSTAINED runs sitting about a semitone
//   below it: short low stretches are slides into a note, and very
//   deep sags are reverb decays — neither is a mislabeled note

export const SKELETON_DEFAULTS = {
  melodyLoMidi: 58, // A#3 — duduk-in-A profile
  melodyHiMidi: 80, // G#5
  candidateAmp: 0.3, // ignore Basic Pitch events below this outright
  peakAmp: 0.5, // a skeleton note's peak amplitude must reach this
  mergeGapSec: 0.15, // same-pitch segments this close are one note
  minLenSec: 0.12, // shorter notes belong to the ornament pass
  crestMaxSec: 0.3, // upward-crest absorption: max crest length (the
  // bend test below is the primary discriminator; this cap keeps long
  // between-pitch notes — slid-into targets — out of its reach)
  crestReachSec: 0.25, // ...and max distance from the parent note
  restSec: 0.4, // gaps at least this long are rests
  rescueDipSemis: 2, // alternation rescue: max dip below the neighbors
  rescueGapSec: 0.1, // ...max gap to each same-pitch neighbor
  longHoldSec: 0.8, // a hold this long makes a following dip pass-2
  resnapLowBins: 1.25, // re-snap: how far under the take's bend center
  // a segment must sit to count as "low" (bins are 1/3 semitone)
  resnapMaxBins: 2.5, // ...deeper than this is a reverb sag, not a note
  resnapRunSec: 0.3, // ...low run must sustain this long to re-snap
  // (a note-length run; shorter low stretches are approach slides or
  // brief slid-to visits of the note above, which keep their label)
};

// tuning re-snap (see header). notes must be time-sorted; returns a new
// array, re-labeling sustained low runs one semitone down. The take's
// bend center is the duration-weighted median of per-segment mean bends
// over melody-band material.
export const meanBend = (n) =>
  n.bends?.length ? n.bends.reduce((a, x) => a + x, 0) / n.bends.length : null;

// the take's own intonation center, in bend bins: duration-weighted
// median of per-segment mean bends over melody-band material. Null when
// the take carries no bend data.
export function bendCenter(notes, o) {
  const ranked = notes
    .filter(
      (n) =>
        n.midi >= o.melodyLoMidi &&
        n.midi <= o.melodyHiMidi &&
        n.amp >= o.candidateAmp &&
        meanBend(n) !== null,
    )
    .map((n) => ({ dur: n.t1 - n.t0, mean: meanBend(n) }))
    .sort((a, b) => a.mean - b.mean);
  if (!ranked.length) return null;
  const half = ranked.reduce((a, s) => a + s.dur, 0) / 2;
  let acc = 0;
  for (const s of ranked) {
    acc += s.dur;
    if (acc >= half) return s.mean;
  }
  return ranked[ranked.length - 1].mean;
}

function resnapSharpRuns(notes, o) {
  const stats = notes.map((n) => ({
    n,
    dur: n.t1 - n.t0,
    mean: meanBend(n),
    inBand:
      n.midi >= o.melodyLoMidi &&
      n.midi <= o.melodyHiMidi &&
      n.amp >= o.candidateAmp,
  }));
  const center = bendCenter(notes, o);
  if (center === null) return notes;

  // walk same-pitch runs; a maximal group of consecutive low segments
  // re-snaps when it is not too deep overall and either sustains
  // note-length (resnapRunSec) or — for SHORT runs down to minLenSec —
  // would surface a DISTINCT hidden note: a quick sharp-played D#4
  // between E4s (maintainer-confirmed on the pitch trace). A short low
  // run ADJOINING material of its flip target is that lower note's own
  // crest or slide instead (the slid-to G4 sits low over its F#4
  // neighbors and must keep its label), so it does not flip
  const out = notes.map((n) => ({ ...n }));
  let group = [];
  const flush = () => {
    const dur = group.reduce((a, i) => a + stats[i].dur, 0);
    const mean =
      group.reduce((a, i) => a + stats[i].mean * stats[i].dur, 0) / (dur || 1);
    if (dur >= o.minLenSec - 1e-3 && mean >= center - o.resnapMaxBins) {
      const first = stats[group[0]].n;
      const last = stats[group[group.length - 1]].n;
      const target = first.midi - 1;
      const adjoinsTarget = notes.some(
        (n) =>
          n.midi === target &&
          n.amp >= o.candidateAmp &&
          (Math.abs(n.t1 - first.t0) <= 0.15 ||
            Math.abs(n.t0 - last.t1) <= 0.15),
      );
      // a short run must also be COHERENT — every frame in the tight
      // low band. A hidden sharp-played note sits steadily just under
      // the line (min bend 0 measured on all confirmed cases); reverb-
      // contaminated material spikes far deeper on single frames
      const coherent = group.every((i) =>
        stats[i].n.bends.every((b) => b >= center - o.resnapMaxBins),
      );
      if (dur >= o.resnapRunSec || (!adjoinsTarget && coherent)) {
        for (const i of group) out[i].midi -= 1;
      }
    }
    group = [];
  };
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const low = s.inBand && s.mean !== null && s.mean <= center - o.resnapLowBins;
    if (low) {
      const last = group[group.length - 1];
      const sameRun =
        last !== undefined &&
        stats[last].n.midi === s.n.midi &&
        s.n.t0 - stats[last].n.t1 <= o.mergeGapSec;
      if (!sameRun) flush();
      group.push(i);
    }
  }
  flush();
  return out;
}

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
  const sorted = [...notes].sort((a, b) => a.t0 - b.t0);
  const mel = resnapSharpRuns(sorted, o)
    .filter(
      (n) =>
        n.midi >= o.melodyLoMidi &&
        n.midi <= o.melodyHiMidi &&
        n.amp >= o.candidateAmp,
    )
    .sort((a, b) => a.t0 - b.t0);

  let merged = mergeRuns(mel, o.mergeGapSec);

  // absorb upward crests (see header). A crest is the LOWER note's own
  // material — its bends sit low against the take's center — and it is
  // WEAKER than the note it decorates (the amp test in the loop below).
  // Together those separate a held note's sharp sag (long, weak, low:
  // absorbed) from a deliberately slid-to upper note (strong as its
  // neighbors: kept, whatever its bends — a covered-fingering G4 sits
  // below its grid line for its whole duration). Length is only the
  // fallback when the take carries no bend data
  const center = bendCenter(sorted, o);
  const crestish = (n) => {
    const mean = meanBend(n);
    if (mean === null || center === null) return n.t1 - n.t0 <= o.crestMaxSec;
    return mean <= center - o.resnapLowBins;
  };
  for (let i = 0; i < merged.length; i++) {
    const n = merged[i];
    if (!n || !crestish(n)) continue;
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
        // a crest AFTER the note extends its tail. A crest BEFORE it is
        // the attack's own scoop/sag ONLY when it abuts the onset — the
        // note then starts there; a fragment separated by a gap is an
        // ornament flick and is simply dropped (dragging a start across
        // a gap eats the previous note's territory)
        if (n.t0 >= nb.t0) nb.t1 = Math.max(nb.t1, n.t1);
        else if (nb.t0 - n.t1 <= 0.05) nb.t0 = Math.min(nb.t0, n.t0);
        nb.parts += n.parts;
        merged[i] = null;
        break;
      }
    }
  }
  merged = merged.filter(Boolean);

  // alternation rescue (see header): a gate-failing dip flanked by the
  // same higher pitch is a played note — unless the preceding neighbor
  // is a long hold, which makes it a rearticulation ornament
  const rescued = new Set();
  for (let i = 1; i < merged.length - 1; i++) {
    const n = merged[i];
    const prev = merged[i - 1];
    const next = merged[i + 1];
    if (
      prev.midi === next.midi &&
      n.midi < prev.midi &&
      prev.midi - n.midi <= o.rescueDipSemis &&
      n.t0 - prev.t1 <= o.rescueGapSec &&
      next.t0 - n.t1 <= o.rescueGapSec &&
      prev.t1 - prev.t0 < o.longHoldSec
    ) {
      rescued.add(n);
    }
  }

  // gate, then re-merge: dropping an interleaved ornament fragment can
  // leave two halves of one note adjacent again
  const gated = merged.filter(
    (n) =>
      rescued.has(n) ||
      // small epsilons: Basic Pitch times are frame-quantized and a
      // 0.1199s note must not lose to a 0.12 threshold
      (n.amp >= o.peakAmp - 1e-6 && n.t1 - n.t0 >= o.minLenSec - 1e-3),
  );
  const skeleton = mergeRuns(gated, o.mergeGapSec);

  // reverb-tail drop (see header): a weaker note that starts while its
  // predecessor sounds and repeats the pitch heard just before that
  // predecessor is the old note's reverb, not a new note
  for (let i = 2; i < skeleton.length; i++) {
    const n = skeleton[i];
    const prev = skeleton[i - 1];
    if (
      n &&
      prev &&
      n.t0 < prev.t1 &&
      n.amp < prev.amp &&
      n.midi === skeleton[i - 2]?.midi
    ) {
      skeleton[i - 1] = { ...prev, parts: prev.parts + n.parts };
      skeleton.splice(i, 1);
      i--;
    }
  }

  // sequentialize: Basic Pitch is polyphonic, so skeleton notes can
  // still overlap at the edges — a monophonic tape needs strict order
  // (the later note wins the contested span). A note truncated DOWN TO
  // A SLIVER was never a melody note: it is a sustained under-voice —
  // the opening note's resonance ringing for seconds beneath the
  // melody — surfacing wherever the melody breathes. Drop it entirely,
  // then re-merge the pieces the drops re-expose
  const truncated = new Set();
  for (let i = 1; i < skeleton.length; i++) {
    if (skeleton[i].t0 < skeleton[i - 1].t1) {
      skeleton[i - 1].t1 = skeleton[i].t0;
      truncated.add(skeleton[i - 1]);
    }
  }
  return mergeRuns(
    skeleton.filter(
      // 0.01 of slack: a real note whose head is squeezed to exactly
      // minLenSec by a neighbor must not die to frame quantization
      (n) => n.t1 - n.t0 > (truncated.has(n) ? o.minLenSec - 0.01 : 0.02),
    ),
    o.mergeGapSec,
  );
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
