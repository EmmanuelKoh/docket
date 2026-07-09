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
// - ornament squiggles: a same-pitch re-strike whose pre-strike
//   ornament was too quiet or too ambiguous to render as a grace note
//   (onset-head evidence only, or a suppressed junk fragment). The
//   squiggle says "ornamented re-strike, details unclear" — visible
//   uncertainty instead of a confidently wrong note. A re-strike WITH
//   a shown grace needs no squiggle: the grace is the notation
//
// Precedence: a squiggle suppresses the slide mark on the same note
// (one visual channel per attack); grace notes coexist with slides.

import { ORNAMENT_DEFAULTS } from './ornaments.mjs';
import { SKELETON_DEFAULTS, bendCenter, meanBend } from './skeleton.mjs';

export const MARK_DEFAULTS = {
  slideGapSec: 0.25, // a slide needs the notes nearly touching (the
  // gap can hold a crest-dropped shred of the glide itself)
  graceNearSec: 0.25, // a shown grace this close to the attack owns it
  restrikeGapSec: 0.05, // same-pitch mains this close are a re-strike
};

// rawNotes: full Basic Pitch output; decorated: decorate()'s result.
// Returns a new render timeline with { slide, ornament } flags on the
// main-note events that earn them.
export function annotate(rawNotes, decorated, opts = {}) {
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

  const marks = new Map(); // main-note t0 -> { slide, ornament }
  for (let i = 1; i < skeleton.length; i++) {
    const b = skeleton[i];
    const a = skeleton[i - 1];
    const graceNear = graces.some(
      (g) => g.t0 >= b.t0 - o.graceNearSec && g.t0 <= b.t0 + 0.15,
    );
    const restrike =
      b.midi === a.midi && b.t0 - a.t1 <= o.restrikeGapSec;
    const ornament = restrike && !graceNear;
    let slide = false;
    if (!ornament && b.t0 - a.t1 <= o.slideGapSec) {
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

  return timeline.map((e) => {
    const m = !e.grace && marks.get(e.t0);
    return m ? { ...e, ...m } : e;
  });
}
