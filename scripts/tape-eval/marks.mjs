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
  excSplitInSec: 0.05, // an excursion past a note's attack by this...
  excSplitTailSec: 0.3, // ...with this much note still to come after
  // it is an ornamented RE-STRIKE: the note splits there. A flick with
  // little note left after it is a transition ornament and only
  // decorates (maintainer-confirmed on both shapes)
};

// rawNotes: full Basic Pitch output; decorated: decorate()'s result;
// fine: optional v1 fine-cents trace frames [{ t (ms), freq, clarity }]
// — brief upper-neighbor excursions in them mark ornaments the neural
// model misses entirely (its contour barely registers quiet flicks
// under a sustained note; the v1 detector resolves them plainly), and
// an excursion deep inside a note SPLITS it (ornamented re-strike).
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
  const { graces } = decorated;
  let { skeleton } = decorated;

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
        const mf = 69 + 12 * Math.log2(f.freq / 440);
        if (run) {
          run.t1 = tSec;
          run.n++;
          run.midiSum += mf;
        } else {
          run = { t0: tSec, t1: tSec, n: 1, midiSum: mf };
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
        excursions[i - 1].midiSum += excursions[i].midiSum;
        excursions.splice(i, 1);
      }
    }
    for (const x of excursions) x.pitch = x.midiSum / x.n;
  }

  // re-strike heads pass 1 dropped: a same-pitch fragment ending right
  // at a main note's start, with ornament activity between them, is
  // the FIRST strike of a quick double — too short for the length gate
  // on its own, real in context (maintainer-confirmed on the trace)
  {
    const events = [...graces, ...excursions];
    const revived = [];
    for (const m of skeleton) {
      const r = sorted.find(
        (n) =>
          n.midi === m.midi &&
          n.amp >= o.candidateAmp &&
          n.t1 - n.t0 >= 0.05 &&
          n.t1 <= m.t0 + 1e-9 &&
          m.t0 - n.t1 <= o.graceNearSec &&
          !skeleton.some(
            (s) => n.t0 < s.t1 - 0.02 && n.t1 > s.t0 + 0.02,
          ),
      );
      if (!r) continue;
      const orn = events.some(
        (g) => g.t1 >= r.t1 - 0.05 && g.t0 <= m.t0 + 0.05,
      );
      // the head must be substantially its own note: a shred that is
      // mostly covered BY the ornament is transition material wrapped
      // around the flick, not a first strike (measured: real head 20%
      // covered, transition shred 78%)
      const covered = events.reduce(
        (a, g) =>
          a + Math.max(0, Math.min(g.t1, r.t1) - Math.max(g.t0, r.t0)),
        0,
      );
      if (orn && covered <= 0.5 * (r.t1 - r.t0)) {
        revived.push({ ...m, t0: r.t0, t1: Math.min(r.t1, m.t0) });
      }
    }
    if (revived.length) {
      skeleton = [...skeleton, ...revived].sort((a, b) => a.t0 - b.t0);
    }
  }

  // bridge revival: a gate-failed candidate that exactly fills a short
  // gap between two mains, CONFIRMED by the fine trace holding its
  // pitch through the gap, is a real melody note that landed a hair
  // under the amplitude gate — revive it. The fine-trace agreement is
  // what makes this evidence rather than gate-lowering
  if (fine.length) {
    const revived = [];
    const bySt = [...skeleton].sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < bySt.length; i++) {
      const a = bySt[i - 1];
      const b = bySt[i];
      const gap = b.t0 - a.t1;
      if (gap < o.minLenSec || gap > o.restSec) continue;
      const cand = sorted.find(
        (n) =>
          n.midi >= o.melodyLoMidi &&
          n.midi <= o.melodyHiMidi &&
          n.amp >= o.candidateAmp &&
          // the candidate must BE the gap's note — starting at it, not
          // an under-voice passing through from long before
          n.t0 >= a.t1 - 0.05 &&
          n.t0 <= a.t1 + 0.05 &&
          n.t1 >= b.t0 - 0.05,
      );
      if (!cand) continue;
      // test the MIDDLE of the gap: its edges are the glides into and
      // out of the soft note (a slid chain's note fails whole-gap
      // agreement precisely because it is slid)
      const lo = a.t1 + 0.2 * gap;
      const hi = b.t0 - 0.2 * gap;
      const span = fine.filter((f) => f.t / 1000 >= lo && f.t / 1000 <= hi);
      // octave-tolerant: a SOFT note's fundamental loses to its second
      // harmonic and the fine trace tracks an octave up — the neural
      // candidate anchors the true octave, the trace confirms the
      // pitch class holds through the gap
      const agree = span.filter((f) => {
        if (!f.freq) return false;
        const d = Math.abs(69 + 12 * Math.log2(f.freq / 440) - cand.midi);
        return d <= 0.7 || Math.abs(d - 12) <= 0.7;
      });
      if (span.length >= 3 && agree.length >= span.length * 0.5) {
        revived.push({ midi: cand.midi, t0: a.t1, t1: b.t0 });
      }
    }
    if (revived.length) {
      skeleton = [...skeleton, ...revived].sort((a, b) => a.t0 - b.t0);
    }
  }

  // ornamented re-strikes revealed by in-note excursions: an excursion
  // past a note's attack with substantial note remaining after it
  // re-strikes the note there — the note splits around the ornament.
  // (A flick with little note left is a transition ornament: no split.)
  {
    const split = [];
    for (const m of skeleton) {
      const cuts = excursions
        .filter(
          (x) =>
            x.t0 - m.t0 >= o.excSplitInSec &&
            x.t1 < m.t1 &&
            m.t1 - x.t1 >= o.excSplitTailSec,
        )
        .sort((a, b) => a.t0 - b.t0);
      let t0 = m.t0;
      for (const x of cuts) {
        if (x.t0 - t0 <= 0) continue;
        split.push({ ...m, t0, t1: x.t0 });
        t0 = x.t1;
      }
      split.push({ ...m, t0 });
    }
    skeleton = split;
  }
  // per-note vibrato width: the spread of its bends (p90 - p10, in
  // bins). Wobble-merged notes carry their full re-expressed bend
  // history, so a wide vibrato measures wide here
  const vibratoSpread = (m) => {
    const b = (m.bends ?? []).slice().sort((x, y) => x - y);
    if (b.length < 8) return 0;
    return b[Math.floor(b.length * 0.9)] - b[Math.floor(b.length * 0.1)];
  };
  const WIDE = 2; // bins — wide vibrato straddles a grid line

  // junction merge, vibrato-gated (maintainer: "it's because the
  // vibrato is wide"): a same-pitch junction INSIDE wide vibrato is
  // the vibrato pulsing the onset head, not a re-strike — clean-
  // context doubles (tight bends) keep their junctions
  {
    const merged = [];
    for (const m of skeleton) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.midi === m.midi &&
        m.t0 - last.t1 <= o.restrikeGapSec &&
        (vibratoSpread(last) >= WIDE || vibratoSpread(m) >= WIDE)
      ) {
        last.t1 = m.t1;
        last.bends = [...(last.bends ?? []), ...(m.bends ?? [])];
      } else {
        merged.push({ ...m });
      }
    }
    skeleton = merged;
  }

  const timeline = skeleton.map((m) => ({
    t0: m.t0,
    t1: m.t1,
    midi: m.midi,
    grace: false,
  }));

  // validate excursions against the FINAL skeleton (detection ran
  // before revivals could exist):
  // - material at the sounding note's own pitch is that note's body,
  //   not an ornament — UNLESS it ends at the attack of a
  //   different-pitch main sitting excMinSemis below it, in which case
  //   it is that note's lead-in ornament (the C#4 flicker before a B3)
  // - a run ending exactly at a different-pitch attack with its pitch
  //   strictly BETWEEN the flanking notes is the transition glide
  //   itself, not an ornament
  {
    const noteAt = (t) => skeleton.find((m) => t >= m.t0 && t <= m.t1);
    const valid = [];
    for (const x of excursions) {
      // hold-mask lag tail: a TINY run at the PREVIOUS note's pitch,
      // starting right where that note ended — the detector's hold
      // mask leaking over the next note's start, not an ornament
      const prevMain = skeleton
        .filter((m) => m.t1 <= x.t0 + 0.01 && x.t0 - m.t1 <= 0.1)
        .pop();
      if (
        x.n <= 3 &&
        prevMain &&
        Math.abs(x.pitch - prevMain.midi) <= 0.7
      ) {
        continue;
      }
      // onset smear (the tail rule's mirror): a run AT the NEXT note's
      // pitch, reaching its start — the fine trace hears the note
      // before the neural boundary does; a note's own attack is not an
      // ornament
      const smearInto = skeleton.find(
        (m) =>
          m.t0 >= x.t0 - 0.01 &&
          m.t0 - x.t1 <= 0.1 &&
          Math.abs(x.pitch - m.midi) <= 0.7,
      );
      if (smearInto) continue;
      // lead-in: the run pours into (and may overlap the start of) a
      // different-pitch main sitting excMinSemis below it — that
      // note's pre-strike ornament
      const leadInto = skeleton.find(
        (m) =>
          m.t0 >= x.t0 &&
          m.t0 - x.t1 <= 0.05 &&
          x.pitch - m.midi >= o.excMinSemis,
      );
      const at = noteAt((x.t0 + x.t1) / 2);
      if (at && x.pitch - at.midi < o.excMinSemis) {
        if (leadInto) {
          x.forceOwner = leadInto.t0;
          valid.push(x);
        }
        continue;
      }
      // an excursion in a note's final moments, pouring into the next
      // attack, decorates the NEXT note — not the note it technically
      // overlaps (the C#4's last flicker is the B3's ornament)
      if (leadInto && at && at.t1 - x.t1 <= 0.1 && leadInto.t0 !== at.t0) {
        x.forceOwner = leadInto.t0;
        valid.push(x);
        continue;
      }
      // release wobble: an excursion in a note's dying moments with NO
      // note following is the fade-out, not an ornament
      if (
        at &&
        at.t1 - x.t1 <= 0.1 &&
        !skeleton.some(
          (m) => m.t0 >= x.t1 && m.t0 - x.t1 <= o.graceNearSec,
        )
      ) {
        continue;
      }
      const next = skeleton.find((m) => Math.abs(m.t0 - x.t1) <= 0.05);
      const prev = skeleton
        .filter((m) => m.t1 <= x.t1 + 0.01 && m.t1 >= x.t0 - 0.2)
        .pop();
      if (next && prev && prev.midi !== next.midi) {
        const lo = Math.min(prev.midi, next.midi) + 0.5;
        const hi = Math.max(prev.midi, next.midi) - 0.5;
        if (x.pitch > lo && x.pitch < hi) continue;
      }
      valid.push(x);
    }
    excursions.length = 0;
    excursions.push(...valid);
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
    if (g.forceOwner !== undefined) {
      owned.add(g.forceOwner);
      continue;
    }
    // a grace now covered by a same-pitch main (bridge revival turned
    // the fragment INTO that note) is the note itself, not its ornament
    if (
      !g.exc &&
      skeleton.some((m) => m.midi === g.midi && g.t0 < m.t1 && g.t1 > m.t0)
    ) {
      continue;
    }
    // a grace whose ABSOLUTE pitch sits within the note it overlaps —
    // when that note's vibrato is WIDE — is the vibrato's lower lobe,
    // not an ornament. (In tight-vibrato context the same shape is a
    // real rearticulation dip and stays.)
    if (!g.exc && meanBend(g) !== null) {
      const abs = g.midi + meanBend(g) / 3;
      if (
        skeleton.some(
          (m) =>
            g.t0 < m.t1 &&
            g.t1 > m.t0 &&
            Math.abs(abs - m.midi) <= 0.7 &&
            vibratoSpread(m) >= WIDE,
        )
      ) {
        continue;
      }
    }
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
    let slide = false;
    if (a !== undefined && !restrike && b.t0 - a.t1 <= o.slideGapSec) {
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
    // a slid attack is its own notation — the arc marks only
    // re-strikes and ornamented attacks that were NOT slid into
    const ornament = restrike || (owned.has(b.t0) && !slide);
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
