// components/tape-events.js — pitch frames in, note events out. The
// canonical interface between detection and rendering: the tracker eats
// {tMs, freq, clarity} frames from the pitch worker and emits
// {type:'on', midi, tMs} / {type:'off', tMs}, so either side can be
// swapped without touching the other.
//
// The two requirements that pull in opposite directions (see the design
// notes): a long note under heavy duduk vibrato must not fragment, and a
// fast ornament run must not be swallowed by the same filtering. The
// mechanism is hysteresis around the CURRENT NOTE'S CENTER, not the
// running pitch: vibrato that stays within retrigCents never arms a
// change, an excursion beyond it must HOLD for changeHoldMs before the
// note switches — so a bend that starts and retreats (a common duduk
// ornament) never commits, while a genuine note-to-note bend commits as
// soon as the new pitch has held. Octave errors (the classic harmonic
// flip of autocorrelation trackers) must hold several times longer
// before they are believed. All thresholds are live-tunable sliders on
// the Tape page.

export const TRACKER_DEFAULTS = {
  clarityMin: 0.88, // frames below this confidence count as unvoiced
  freqMin: 70, // Hz — plausible pitch band (duduk in A is ~180-800)
  freqMax: 1200,
  onsetHoldMs: 50, // silence -> note: pitch must hold this long
  retrigCents: 60, // deviation from the note center that arms a change
  changeHoldMs: 80, // ...and must hold this long to commit
  offMs: 110, // unvoiced this long ends the note
  octaveHoldFactor: 3, // ±1-octave candidates hold changeHoldMs × this
};

const toMidiFloat = (f) => 69 + 12 * Math.log2(f / 440);

export function createNoteTracker(params) {
  let p = { ...TRACKER_DEFAULTS, ...params };
  let cur = null; // { midi }
  let cand = null; // { midi, sinceMs }
  let unvoicedSince = null; // first unvoiced frame while a note sounds

  // Feed one detector frame; returns the (possibly empty) list of events
  // it produced. freq may be null/0 for unvoiced frames.
  function push({ tMs, freq, clarity }) {
    const events = [];
    const voiced =
      !!freq &&
      clarity >= p.clarityMin &&
      freq >= p.freqMin &&
      freq <= p.freqMax;

    if (!voiced) {
      cand = null;
      if (cur) {
        if (unvoicedSince === null) unvoicedSince = tMs;
        if (tMs - unvoicedSince >= p.offMs) {
          events.push({ type: 'off', tMs });
          cur = null;
        }
      }
      return events;
    }
    unvoicedSince = null;

    const mf = toMidiFloat(freq);
    const nearest = Math.round(mf);

    if (!cur) {
      // onset from silence: the nearest semitone must be stable for
      // onsetHoldMs (a bend-in attack keeps resetting the candidate
      // until the pitch settles)
      if (cand && cand.midi === nearest) {
        if (tMs - cand.sinceMs >= p.onsetHoldMs) {
          events.push({ type: 'on', midi: nearest, tMs });
          cur = { midi: nearest };
          cand = null;
        }
      } else {
        cand = { midi: nearest, sinceMs: tMs };
      }
      return events;
    }

    // sounding: hysteresis vs the note center
    const devCents = (mf - cur.midi) * 100;
    if (Math.abs(devCents) <= p.retrigCents) {
      cand = null; // retreating bend / vibrato — never commits
      return events;
    }
    if (!cand || cand.midi !== nearest) {
      cand = { midi: nearest, sinceMs: tMs };
      return events;
    }
    const isOctave = Math.abs(nearest - cur.midi) === 12;
    const hold = p.changeHoldMs * (isOctave ? p.octaveHoldFactor : 1);
    if (tMs - cand.sinceMs >= hold) {
      events.push({ type: 'off', tMs });
      events.push({ type: 'on', midi: nearest, tMs });
      cur = { midi: nearest };
      cand = null;
    }
    return events;
  }

  function setParams(partial) {
    p = { ...p, ...partial };
  }

  // Flush a still-sounding note (end of session / clip).
  function finish(tMs) {
    if (!cur) return [];
    cur = null;
    return [{ type: 'off', tMs }];
  }

  return {
    push,
    setParams,
    finish,
    get params() {
      return p;
    },
    get sounding() {
      return cur ? cur.midi : null;
    },
  };
}
