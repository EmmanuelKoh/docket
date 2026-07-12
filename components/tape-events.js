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
  clarityMin: 0.5, // frames below this confidence count as unvoiced
  // (tuned on a real dam+melody clip: melody scores ~0.5-0.8 over a
  // drone, dam residue ~0.2-0.4; clean solo tone ~0.9)
  freqMin: 70, // Hz — plausible pitch band (duduk in A is ~180-800)
  freqMax: 1200,
  onsetHoldMs: 50, // silence -> note: pitch must hold this long
  retrigCents: 60, // deviation from the note center that arms a change
  changeHoldMs: 80, // ...and must hold this long to commit (glides)
  changeFastMs: 30, // hold for JUMP-entered candidates (ornaments, runs)
  jumpCents: 60, // per-frame pitch step that separates a jump (an
  // ornament or run: the new pitch arrives between two frames) from a
  // glide (vibrato and bends move ~10-20 cents/frame) — this is the
  // vibrato-vs-ornament discrimination
  restFrac: 0.18, // frame energy below this × the recent voiced level
  // is a rest, whatever residual pitch is detectable (0 disables)
  tuningCents: 0, // player's offset from A440 — a duduk running +40
  // cents sharp puts its E on the E/F rounding boundary; recentering
  // makes snapping stable (read the offset off the pitch trace)
  ornamentCents: 45, // a brief excursion at least this deep that RETURNS
  // becomes a neighbor-note ornament: duduk grace notes are often played
  // as fast dips that never fully arrive at the neighbor's pitch (the
  // fixture clip's D#4 bottoms out ~65 cents below E4). 0 disables.
  // The threshold ADAPTS per note: it can never be less than ~2.2x the
  // note's own measured vibrato envelope, so a wide-vibrato held note
  // doesn't shed false grace notes.
  ornamentMaxMs: 250, // excursions longer than this are bends/changes,
  // handled by the candidate machinery instead. Ornament events are
  // emitted BACKDATED to the excursion's true start with its true span
  // (the engine renders ~300ms behind analysis to allow exactly this),
  // so a slide to the neighbor gets its fair share of tape.
  ornamentLockoutMs: 120, // no ornaments this soon after a note starts:
  // an attack scoop overshooting the target is not a grace note
  ornamentWindowMs: 1000, // ...and none this LATE into a note: graces
  // decorate transitions, while a deep trough mid-way through a long
  // sustain is just the vibrato at full width (measured: a real grace
  // dip and a wide vibrato trough overlap in depth — position in the
  // note is what separates them)
  offMs: 110, // unvoiced this long ends the note
  octaveHoldFactor: 3, // ±1-octave candidates hold changeHoldMs × this
};

const toMidiFloat = (f) => 69 + 12 * Math.log2(f / 440);

export function createNoteTracker(params) {
  let p = { ...TRACKER_DEFAULTS, ...params };
  let cur = null; // { midi }
  let cand = null; // { midi, sinceMs, jump }
  let unvoicedSince = null; // first unvoiced frame while a note sounds
  let prevMf = null; // last voiced frame's pitch, for jump detection
  let prevMfT = null; // ...and when it was seen
  let energyEma = 0; // recent voiced energy level, for the rest gate
  let floorEma = 0; // learned rest/noise energy level (from unvoiced frames)
  let exc = null; // ornament excursion: { midi, sinceMs, extreme }
  const recentV = []; // voiced/unvoiced ring for the flicker-proof off

  // Feed one detector frame; returns the (possibly empty) list of events
  // it produced. freq may be null/0 for unvoiced frames.
  function push({ tMs, freq, clarity, energy }) {
    const events = [];
    let voiced =
      !!freq &&
      clarity >= p.clarityMin &&
      freq >= p.freqMin &&
      freq <= p.freqMax;

    // rest gate: the melody dominates the (drone-subtracted) energy, so
    // a collapse to a fraction of the recent level is a rest even when
    // some residual pitch is still technically detectable. The drop must
    // ALSO land near the learned rest level (floorEma) — otherwise a
    // soft note after a loud one would be silenced forever (the level
    // reference can't decay while everything is gated).
    // the rest floor tracks the MINIMUM unvoiced energy (with a slow
    // upward drift) — an average would be inflated by loud mid-note
    // clarity flickers, which are also "unvoiced" frames
    if (!voiced && energy !== undefined && energy > 0) {
      floorEma = floorEma === 0 ? energy : Math.min(energy, floorEma * 1.0005);
    }
    if (voiced && p.restFrac > 0 && energy !== undefined) {
      // only gate when the floor is KNOWN and the drop lands near it —
      // a soft note after a loud one must not be silenced
      const nearFloor = floorEma > 0 && energy < 5 * floorEma;
      if (energyEma > 0 && energy < p.restFrac * energyEma && nearFloor) {
        voiced = false;
      } else {
        energyEma += (energy - energyEma) * 0.05;
      }
    }

    // flicker-proof note-off: scattered release-tail frames (reverb, dam
    // residue) can keep resetting a continuous-silence timeout and
    // bridge right across a real break — so ALSO end the note when the
    // voiced fraction of the last ~300ms falls under 40%
    recentV.push(voiced ? 1 : 0);
    if (recentV.length > 26) recentV.shift();
    if (cur && recentV.length === 26) {
      let vsum = 0;
      for (const v of recentV) vsum += v;
      if (vsum / 26 < 0.4) {
        events.push({ type: 'off', tMs });
        cur = null;
        exc = null;
        cand = null;
        return events;
      }
    }

    if (!voiced) {
      // keep prevMf and exc: a fast ornament often includes gated
      // flickers (articulation noise); its excursion memory must
      // survive them — ornamentMaxMs bounds it regardless
      cand = null;
      if (cur) {
        if (unvoicedSince === null) unvoicedSince = tMs;
        if (tMs - unvoicedSince >= p.offMs) {
          events.push({ type: 'off', tMs });
          cur = null;
          exc = null;
        }
      }
      return events;
    }
    unvoicedSince = null;

    const mf = toMidiFloat(freq) - p.tuningCents / 100;
    const nearest = Math.round(mf);
    // jump vs glide: ornaments and run notes ARRIVE between two frames
    // (a step of a semitone or more); vibrato and bends glide there in
    // ~10-20 cent increments. When the comparison spans a gap (gated
    // frames), demand double the step — deep vibrato measured across a
    // 2-3 frame flicker must not pass for a jump
    const gapped = prevMfT !== null && tMs - prevMfT > 30;
    const jumped =
      prevMf !== null &&
      Math.abs(mf - prevMf) * 100 >= p.jumpCents * (gapped ? 2 : 1);
    prevMf = mf;
    prevMfT = tMs;

    if (!cur) {
      // onsets demand energy well clear of the learned rest floor: in
      // near-silence, clarity is a ratio over almost nothing, and a
      // stable residue sliver can score 1.0 (a 569 Hz artifact in the
      // fixture did exactly this, self-legitimizing through the decaying
      // energy average). Continuing a note tolerates low energy;
      // STARTING one does not.
      if (energy !== undefined && floorEma > 0 && energy < 8 * floorEma) {
        cand = null;
        return events;
      }
      // onset from silence: the nearest semitone must be stable for
      // onsetHoldMs (a bend-in attack keeps resetting the candidate
      // until the pitch settles)
      if (cand && cand.midi === nearest) {
        if (tMs - cand.sinceMs >= p.onsetHoldMs) {
          events.push({ type: 'on', midi: nearest, tMs });
          cur = { midi: nearest, onMs: tMs, vibEnv: 0 };
          cand = null;
          recentV.length = 0; // the pre-onset silence must not count
          // against the fresh note's voiced ratio
        }
      } else {
        cand = { midi: nearest, sinceMs: tMs };
      }
      return events;
    }

    // sounding: hysteresis vs the note center
    const devCents = (mf - cur.midi) * 100;
    const absDev = Math.abs(devCents);

    // the note's vibrato envelope (measured from within-hysteresis
    // frames) floors the ornament threshold: a wide-vibrato held note
    // must dip proportionally deeper before anything counts as a grace
    if (absDev <= p.retrigCents) {
      cur.vibEnv += (absDev - cur.vibEnv) * 0.05;
    }
    const ornCents =
      p.ornamentCents > 0 ? Math.max(p.ornamentCents, cur.vibEnv * 2.2) : 0;

    // ornament snap: track excursions past the threshold; if one comes
    // BACK quickly (rather than committing as a note change), emit it
    // backdated to its true start with its true span — the engine
    // renders behind analysis for exactly this. Excursions past 250
    // cents are detector artifacts (octave flips), not neighbors, and
    // excursions inside the onset lockout are attack scoops.
    if (
      ornCents > 0 &&
      absDev >= ornCents &&
      absDev <= 250 &&
      // late into a note, only excursions that fully ARRIVE at the
      // neighbor (a solid semitone) count — a wide vibrato trough
      // (~70-75 cents in the fixture) never reaches that deep, while
      // the real mid-note ornaments dip a full 100
      (tMs - cur.onMs < p.ornamentWindowMs || absDev >= 80)
    ) {
      if (!exc) exc = { midi: nearest, sinceMs: tMs, extreme: absDev };
      else if (absDev > exc.extreme) {
        exc.extreme = absDev;
        exc.midi = nearest;
      }
    } else if (exc && ornCents > 0 && absDev < ornCents) {
      if (
        exc.midi !== cur.midi &&
        tMs - exc.sinceMs <= p.ornamentMaxMs &&
        absDev <= p.retrigCents &&
        exc.sinceMs - cur.onMs > p.ornamentLockoutMs
      ) {
        events.push({ type: 'off', tMs: exc.sinceMs });
        events.push({
          type: 'on',
          midi: exc.midi,
          tMs: exc.sinceMs,
          grace: true,
        });
        events.push({ type: 'off', tMs });
        events.push({ type: 'on', midi: cur.midi, tMs });
      }
      exc = null;
    }

    if (absDev <= p.retrigCents) {
      cand = null; // retreating bend / vibrato — never commits
      return events;
    }
    if (!cand || cand.midi !== nearest) {
      cand = { midi: nearest, sinceMs: tMs, jump: jumped };
      return events;
    }
    // octave-multiple candidates (±12, ±24...) are the detector's
    // classic harmonic errors — believed only after a much longer hold
    const isOctave =
      nearest !== cur.midi && Math.abs(nearest - cur.midi) % 12 === 0;
    // jump-entered candidates (ornaments, runs) commit fast; glide-
    // entered ones (vibrato, bends) must out-wait the long hold
    const holdBase = cand.jump ? p.changeFastMs : p.changeHoldMs;
    const hold = holdBase * (isOctave ? p.octaveHoldFactor : 1);
    if (tMs - cand.sinceMs >= hold) {
      events.push({ type: 'off', tMs });
      events.push({ type: 'on', midi: nearest, tMs });
      cur = { midi: nearest, onMs: tMs, vibEnv: 0 };
      cand = null;
      exc = null; // a committed change supersedes any pending ornament
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
