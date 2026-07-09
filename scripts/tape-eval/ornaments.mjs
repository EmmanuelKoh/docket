// scripts/tape-eval/ornaments.mjs — pass 2 of the Tape v2 pipeline:
// attribute the residual pitch activity around the pass-1 skeleton
// (docs/tape-transcription-v2.md). Residuals are the Basic Pitch note
// events the skeleton filtered out; here they become:
//
// - grace notes: brief confident neighbors near a main note, rendered
//   as small noteheads. Duduk graces are dips BELOW the note (any
//   depth) or upper neighbors at least 2 semitones up — a fragment
//   exactly 1 semitone up is an upward-vibrato crest crossing Basic
//   Pitch's grid line, never a played ornament
// - rearticulation splits: a main note re-struck after an ornament is
//   two main notes. The evidence is an ornament fragment OVERLAPPING
//   the main note's own segments around one of its internal boundaries
//   (the note keeps sounding under the ornament). Sequential flicks —
//   the note pauses, the ornament sounds, the note resumes — decorate
//   a single held note and do NOT split it (clip 1's held F#4)
//
// Rests and the skeleton itself stay pass-1 concerns; the scorer runs
// the split skeleton so double articulations are scoreable truth.

import { SKELETON_DEFAULTS, bendCenter, meanBend } from './skeleton.mjs';

// model onset strength at a note's start (max over +/-2 frames at its
// pitch bin) — a re-strike fires the onset head even when the note's
// pitch and amplitude are seamless. Shared by the Node transcriber and
// the browser engine, which both attach it as `onset` on note events.
export function onsetAt(onsets, startFrame, midi) {
  const bin = midi - 21; // onset matrix columns are piano keys A0..C8
  let on = 0;
  for (let d = -2; d <= 2; d++) {
    const row = onsets[startFrame + d];
    if (row) on = Math.max(on, row[bin]);
  }
  return on;
}

export const ORNAMENT_DEFAULTS = {
  graceMinAmp: 0.3, // residuals quieter than this are model noise
  graceMinSec: 0.05, // ...and shorter than this are below analysis
  graceMaxSec: 0.3, // longer residuals are reverb tails, not graces
  graceMaxSemisUp: 4, // ornaments use the next scale note or two
  graceReachSec: 0.3, // a grace belongs NEAR a main note, not silence
  splitWindowSec: 0.15, // ornament-to-boundary slack for a split (the
  // ornament's onset lags the re-strike by up to ~0.1s in the fixtures)
  splitOnsetMin: 0.7, // model onset strength that marks a re-strike...
  splitAmpJump: 0.1, // ...unless amplitude jumps too (crescendo swells
  // fire the onset head; true re-strikes are amplitude-flat)
};

// rawNotes: full Basic Pitch output; skeleton: skeletonize() result.
// Returns { skeleton, graces, timeline }: skeleton with rearticulation
// splits applied; graces as [{t0,t1,midi}]; timeline as a render-ready
// monophonic event list [{t0,t1,midi,grace}] with graces cut into the
// main notes they interrupt.
export function decorate(rawNotes, skeleton, opts = {}) {
  const o = { ...SKELETON_DEFAULTS, ...ORNAMENT_DEFAULTS, ...opts };
  const sorted = [...rawNotes].sort((a, b) => a.t0 - b.t0);

  const mainsNear = (n) =>
    skeleton.filter(
      (m) => n.t1 >= m.t0 - o.graceReachSec && n.t0 <= m.t1 + o.graceReachSec,
    );

  // a residual is ornament-shaped relative to a nearby main note when
  // it dips below it or sits 2..graceMaxSemisUp above it
  const ornamental = (n, m) =>
    n.midi < m.midi ||
    (n.midi >= m.midi + 2 && n.midi <= m.midi + o.graceMaxSemisUp);

  const graces = [];
  for (const n of sorted) {
    if (
      n.amp < o.graceMinAmp ||
      n.t1 - n.t0 < o.graceMinSec ||
      n.t1 - n.t0 > o.graceMaxSec ||
      n.midi < o.melodyLoMidi ||
      n.midi > o.melodyHiMidi
    ) {
      continue;
    }
    // skip anything the skeleton already owns (same pitch, overlapping)
    if (skeleton.some((m) => m.midi === n.midi && n.t0 < m.t1 && n.t1 > m.t0)) {
      continue;
    }
    // ornamental relative to ANY nearby main note: a fragment can sit
    // level with the previous note yet decorate the next one
    if (mainsNear(n).some((m) => ornamental(n, m))) {
      graces.push({ t0: n.t0, t1: n.t1, midi: n.midi, bends: n.bends });
    }
  }

  // rearticulation splits: for each main note, cut at internal segment
  // boundaries (its own pitch's raw segments) where the player
  // re-struck. Two independent kinds of evidence, each earned from a
  // fixture the other misses:
  // - an overlapping upper ornament bridging the boundary (the ornament
  //   before the re-struck note; audible mixes). Each ornament marks
  //   ONE re-strike, at the boundary nearest its onset — a fragment
  //   spanning two close boundaries must not cut twice
  // - the model's own onset head firing at the boundary WITHOUT an
  //   amplitude jump (quiet-ornament mixes where no residual note
  //   survives; crescendo swells also fire it but jump in amplitude)
  const split = [];
  for (const m of skeleton) {
    const segs = sorted.filter(
      (n) => n.midi === m.midi && n.t0 < m.t1 && n.t1 > m.t0,
    );
    const inGuard = (b) => b - m.t0 >= o.minLenSec && m.t1 - b >= o.minLenSec;
    const bounds = segs
      .slice(1)
      .map((n) => n.t0)
      .filter(inGuard);
    const cuts = new Set();
    for (let i = 1; i < segs.length; i++) {
      if (
        inGuard(segs[i].t0) &&
        (segs[i].onset ?? 0) >= o.splitOnsetMin &&
        segs[i].amp <= segs[i - 1].amp + o.splitAmpJump
      ) {
        cuts.add(segs[i].t0);
      }
    }
    for (const g of graces) {
      if (g.midi < m.midi + 2) continue;
      if (!(g.t0 < m.t1 && g.t1 > m.t0)) continue;
      // an ornament that ends ON another main note's attack is that
      // note's lead-in, not evidence that THIS note was re-struck
      if (
        skeleton.some((m2) => m2 !== m && Math.abs(g.t1 - m2.t0) <= 0.03)
      ) {
        continue;
      }
      let best = null;
      for (const b of bounds) {
        if (best === null || Math.abs(g.t0 - b) < Math.abs(g.t0 - best)) best = b;
      }
      if (
        best !== null &&
        g.t0 <= best + o.splitWindowSec &&
        g.t1 >= best - o.splitWindowSec
      ) {
        cuts.add(best);
      }
    }
    let t0 = m.t0;
    for (const c of [...cuts].sort((a, b) => a - b)) {
      split.push({ ...m, t0, t1: c });
      t0 = c;
    }
    split.push({ ...m, t0 });
  }

  // correct grace pitches from their own bends (AFTER split detection,
  // which needs the raw grid-line labels): a sharp player's F#4 flick
  // is labeled G4 by the A440 grid — the sustained-run re-snap can't
  // reach fragments this short, so snap each grace down by its own mean
  // bend relative to the take's center. Downward only (the sharp-side
  // error mode); a corrected grace the skeleton owns, or that lands in
  // the +1-semitone vibrato zone of every nearby main, is dropped
  const center = bendCenter(sorted, o);
  const shown = [];
  for (const g of graces) {
    const mean = center !== null ? meanBend(g) : null;
    // bends sagging deeper than the re-snap's own artifact bound mark
    // reverb junk — don't display it as a chromatic grace
    if (mean !== null && mean < center - o.resnapMaxBins) continue;
    const semis = mean !== null ? Math.round((mean - center) / 3) : 0;
    const midi = semis < 0 ? g.midi + Math.max(semis, -1) : g.midi;
    const c = { t0: g.t0, t1: g.t1, midi };
    // a grace matching an ADJACENT main note's pitch is that note's own
    // tail or vibrato fragment, not an ornament — suppress it
    if (
      skeleton.some(
        (m) =>
          m.midi === midi &&
          g.t0 < m.t1 + o.mergeGapSec &&
          g.t1 > m.t0 - o.mergeGapSec,
      )
    ) {
      continue;
    }
    if (mainsNear(c).some((m) => ornamental(c, m))) shown.push(c);
  }

  // render timeline: monophonic — a grace interrupts the main note it
  // rides on (the tape has one lane; the hold resumes after)
  const timeline = [];
  for (const m of split) timeline.push({ t0: m.t0, t1: m.t1, midi: m.midi, grace: false });
  for (const g of shown) {
    const i = timeline.findIndex((e) => !e.grace && g.t0 < e.t1 && g.t1 > e.t0);
    if (i >= 0) {
      const e = timeline[i];
      const parts = [];
      if (g.t0 - e.t0 > 0.02) parts.push({ ...e, t1: g.t0 });
      parts.push({ t0: g.t0, t1: Math.min(g.t1, e.t1), midi: g.midi, grace: true });
      if (e.t1 - g.t1 > 0.02) parts.push({ ...e, t0: g.t1 });
      timeline.splice(i, 1, ...parts);
    } else {
      timeline.push({ t0: g.t0, t1: g.t1, midi: g.midi, grace: true });
    }
  }
  timeline.sort((a, b) => a.t0 - b.t0);
  // strict monophony after grace insertion
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].t0 < timeline[i - 1].t1) timeline[i - 1].t1 = timeline[i].t0;
  }

  return {
    skeleton: split,
    graces: shown,
    timeline: timeline.filter((e) => e.t1 - e.t0 > 0.02),
  };
}
