// scripts/tape-eval/marks.mjs — pass 3 of the Tape v2 pipeline:
// notation markings on top of the pass-1 skeleton and pass-2 ornaments
// (docs/tape-transcription-v2.md). Two marks, each from evidence the
// earlier passes deliberately left unused:
//
// - slide connectors: a note APPROACHED FROM BELOW — its first frames
//   sit about a semitone under the take's bend center (the sub-run-
//   length low stretches the tuning re-snap refuses to relabel are
//   exactly this approach material) — or DEPARTED INTO from above: the
//   previous note's closing frames sag toward it (sliding back down
//   off a slid-to top note). Rendered as a connector from the previous
//   note: diagonal between pitches, a dip scoop when the slide returns
//   to the same pitch (duduk E4-D#4-E4 figures)
// - ornament marks (the small backwards-"c" arc): EVERY ornamented
//   main note gets one — a detected ornament fragment attaches to the
//   main whose attack it sits nearest, and same-pitch re-strikes are
//   ornamented by definition (their ornament may be below the model's
//   floor). Ornaments never render as small notes on the staff
//   (maintainer's choice): main notes stay close together and the
//   activity reads as a glyph above the staff
//
// Precedence: an ornament mark suppresses the slide mark on the same
// note (one visual channel per attack).

import { ORNAMENT_DEFAULTS } from './ornaments.mjs';
import { SKELETON_DEFAULTS, bendCenter, meanBend } from './skeleton.mjs';

export const MARK_DEFAULTS = {
  slideGapSec: 0.25, // a slide needs the notes nearly touching (the
  // gap can hold a crest-dropped shred of the glide itself)
  graceNearSec: 0.25, // a shown grace this close to the attack owns it
  restrikeGapSec: 0.05, // same-pitch mains this close are a re-strike
  excMinSemis: 1.5, // fine-trace excursion: how far above the sounding
  // main a visit must reach (+1 is vibrato; ornaments visit neighbors)
  excMaxSemis: 6, // ...and no further (octave ghosts are artifacts)
  excMinFrames: 2, // consecutive frames — single-frame spikes are junk
  excClarityMin: 0.3, // the v1 detector must actually be confident
  excEnergyFrac: 0.1, // ...and the frame must carry real signal: this
  // fraction of the take's voiced-median energy (clarity is a ratio —
  // meaningless in a fading tail; measured junk sits at 0.01x, real
  // ornaments at 0.55x and up)
  excMergeGapSec: 0.06, // one gesture split across runs is one ornament
  excFarSec: 0.6, // an excursion further than this after its owner's
  // attack prints at its own moment instead (a mid-hold flick belongs
  // where it happened, not at an attack seconds earlier)
};

// rawNotes: full Basic Pitch output; decorated: decorate()'s result;
// fine: optional v1 fine-cents trace frames [{ t (ms), freq, clarity }]
// — brief upper-neighbor excursions in them mark ornaments the neural
// model misses entirely (its contour barely registers quiet flicks
// under a sustained note; the v1 detector resolves them plainly).
// Returns a new render timeline with { slide, ornament } flags on the
// main-note events that earn them.
export function annotate(rawNotes, decorated, opts = {}, fine = []) {
  const o = {
    ...SKELETON_DEFAULTS,
    ...ORNAMENT_DEFAULTS,
    ...MARK_DEFAULTS,
    ...opts,
  };
  const sorted = [...rawNotes].sort((a, b) => a.t0 - b.t0);
  const center = bendCenter(sorted, o);
  const { skeleton, graces, timeline } = decorated;

  // mean bend of the note's first (or last) underlying segment, read in
  // the note's FINAL pitch frame: a re-snapped note's raw bends are
  // labeled one semitone up, so they read 3 bins higher after the drop
  const edgeMean = (m, edge) => {
    if (center === null) return null;
    let seg = null;
    const at = edge === 'start' ? m.t0 : m.t1;
    for (const n of sorted) {
      if (n.midi !== m.midi && n.midi !== m.midi + 1) continue;
      if (n.t1 <= m.t0 || n.t0 >= m.t1) continue;
      const d = Math.abs((edge === 'start' ? n.t0 : n.t1) - at);
      if (seg === null || d < seg.d) seg = { n, d };
    }
    const mean = seg ? meanBend(seg.n) : null;
    return mean === null ? null : mean + 3 * (seg.n.midi - m.midi);
  };

  // fine-trace ornament excursions: runs of consecutive fine frames
  // reaching an upper neighbor of the sounding main note
  const excursions = [];
  {
    // energy floor relative to the take's voiced material — clarity
    // alone certifies junk in fading tails
    const voiced = fine
      .filter((f) => f.freq && f.clarity >= 0.5 && f.energy !== undefined)
      .map((f) => f.energy)
      .sort((a, b) => a - b);
    const eFloor = voiced.length
      ? o.excEnergyFrac * voiced[Math.floor(voiced.length / 2)]
      : 0;
    const mainAt = (t) =>
      skeleton.find((m) => t >= m.t0 && t <= m.t1) ||
      skeleton.find((m) => m.t0 >= t && m.t0 - t <= o.graceNearSec);
    let run = null;
    const flush = () => {
      if (run && run.n >= o.excMinFrames) excursions.push(run);
      run = null;
    };
    for (const f of fine) {
      const tSec = f.t / 1000;
      let up = false;
      if (
        f.freq &&
        f.clarity >= o.excClarityMin &&
        (f.energy === undefined || f.energy >= eFloor)
      ) {
        const m = mainAt(tSec);
        if (m) {
          const d = 69 + 12 * Math.log2(f.freq / 440) - m.midi;
          up = d >= o.excMinSemis && d <= o.excMaxSemis;
        }
      }
      if (up) {
        if (run) {
          run.t1 = tSec;
          run.n++;
        } else {
          run = { t0: tSec, t1: tSec, n: 1 };
        }
      } else {
        flush();
      }
    }
    flush();
    // one physical gesture often splits across runs (a frame of the
    // main note pokes through mid-flick): merge near-adjacent runs
    for (let i = excursions.length - 1; i > 0; i--) {
      if (excursions[i].t0 - excursions[i - 1].t1 <= o.excMergeGapSec) {
        excursions[i - 1].t1 = excursions[i].t1;
        excursions[i - 1].n += excursions[i].n;
        excursions.splice(i, 1);
      }
    }
  }

  // every detected ornament (pass-2 residual or fine-trace excursion)
  // marks a main note with the ornament glyph — attached to the main
  // whose ATTACK it sits nearest, among the mains it overlaps or leads
  // into (the duduk convention: the ornament belongs to the note it
  // prepares). An excursion far into a long hold instead becomes a
  // TIME-ANCHORED mark: the arc prints where the flick happened, not
  // at an attack seconds earlier
  const owned = new Set();
  const timed = [];
  for (const g of [
    ...graces,
    ...excursions.map((x) => ({ ...x, exc: true })),
  ]) {
    let bestAny = null;
    let bestOverlap = null;
    for (const m of skeleton) {
      const overlaps = g.t0 < m.t1 && g.t1 > m.t0;
      const leadsIn = m.t0 - g.t1 >= -0.05 && m.t0 - g.t1 <= o.graceNearSec;
      if (!overlaps && !leadsIn) continue;
      const d = Math.abs(g.t0 - m.t0);
      if (bestAny === null || d < bestAny.d) bestAny = { m, d };
      if (overlaps && (bestOverlap === null || d < bestOverlap.d)) {
        bestOverlap = { m, d };
      }
    }
    // a fine-trace excursion is heard WHILE a note sounds — it belongs
    // to that note, not to whichever attack happens to be nearer
    const best = g.exc ? (bestOverlap ?? bestAny) : bestAny;
    if (!best) continue;
    if (g.t0 - best.m.t0 > o.excFarSec) timed.push(g);
    else owned.add(best.m.t0);
  }

  const marks = new Map(); // main-note t0 -> { slide, ornament }
  for (let i = 0; i < skeleton.length; i++) {
    const b = skeleton[i];
    const a = skeleton[i - 1];
    const restrike =
      a !== undefined && b.midi === a.midi && b.t0 - a.t1 <= o.restrikeGapSec;
    const ornament = restrike || owned.has(b.t0);
    let slide = false;
    if (a !== undefined && !ornament && b.t0 - a.t1 <= o.slideGapSec) {
      // approach glide: this note's opening frames sit low (slid into
      // from below) — or departure glide: the PREVIOUS note's closing
      // frames sag toward this one (slid out of, e.g. back down off a
      // slid-to top note)
      const am = edgeMean(b, 'start');
      const dm = b.midi < a.midi ? edgeMean(a, 'end') : null;
      if (
        (am !== null && am <= center - o.resnapLowBins) ||
        (dm !== null && dm <= center - o.resnapLowBins)
      ) {
        slide = true;
      }
    }
    if (slide || ornament) marks.set(b.t0, { slide, ornament });
  }

  const flagged = timeline.map((e) => {
    const m = !e.grace && marks.get(e.t0);
    return m ? { ...e, ...m } : e;
  });
  const timedEvents = timed.map((x) => ({
    t0: x.t0,
    t1: x.t0,
    midi: 0,
    grace: false,
    mark: true,
  }));
  return [...flagged, ...timedEvents].sort((a, b) => a.t0 - b.t0);
}
