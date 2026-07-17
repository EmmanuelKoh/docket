// scripts/tape-eval/tuning.mjs — global tuning estimation and the
// compensating resample, shared verbatim by the browser decode
// (components/tape/decode.js) and the eval harness (transcribe.mjs).
//
// Basic Pitch quantizes to semitone bins with the A440 grid frozen into
// its weights: a take played between bins (a quarter tone off is the
// worst case) splits its evidence between neighbors and short notes
// vanish — measured on the synthetic demo phrase, 50 cents flat loses a
// third of the melody and a compensating resample recovers all of it.
// The v2 architecture will estimate a per-take reference properly
// ("auto-tune the reference, not the audio"); until that engine ships,
// moving the audio onto the model's grid is the only lever Basic Pitch
// offers, and this stage retires into v2's reference estimation.
//
// Pure JS, no DOM, no Node APIs.

// bump on ANY behavior change here: the eval harness folds this into
// its transcription cache key, or stale gate/estimator results replay
export const TUNING_VERSION = 4;

const WIN = 2048; // analysis window (93 ms at 22050)
const MAX_WINDOWS = 120; // sampled across the take, whatever its length
const F_MIN = 110; // duduk range with margin; octave errors are harmless
const F_MAX = 1100; // (any 1200-cent slip is 0 mod the semitone)
const CLARITY_MIN = 0.8; // periodicity gate per window
const RMS_MIN = 0.005; // silence gate per window

// Estimate how far the take plays from the semitone grid. Each voiced
// window contributes its deviation from the NEAREST semitone; the
// deviations combine as a circular mean (they wrap at ±50 cents — a
// plain average of a quarter-tone take would cancel itself). Returns
// { cents (-50..50), confidence (0..1 vector concentration), voiced }.
export function estimateTuningCents(samples, sampleRate) {
  const lagMin = Math.floor(sampleRate / F_MAX);
  const lagMax = Math.min(WIN >> 1, Math.ceil(sampleRate / F_MIN));
  const step = Math.max(WIN, Math.floor((samples.length - WIN) / MAX_WINDOWS));
  let sumSin = 0;
  let sumCos = 0;
  let sumW = 0;
  let voiced = 0;
  for (let start = 0; start + WIN <= samples.length; start += step) {
    const f0 = windowPitch(samples, start, sampleRate, lagMin, lagMax);
    if (!f0) continue;
    voiced++;
    const midi = 69 + 12 * Math.log2(f0.hz / 440);
    const theta = 2 * Math.PI * (midi - Math.floor(midi));
    const w = f0.clarity * f0.clarity;
    sumSin += w * Math.sin(theta);
    sumCos += w * Math.cos(theta);
    sumW += w;
  }
  if (!sumW) return { cents: 0, confidence: 0, voiced: 0 };
  let cents = (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) * 100;
  if (cents >= 50) cents -= 100;
  const confidence = Math.hypot(sumSin, sumCos) / sumW;
  return { cents, confidence, voiced };
}

// one window: normalized autocorrelation peak with parabolic refinement
function windowPitch(samples, start, sampleRate, lagMin, lagMax) {
  let e0 = 0;
  for (let i = 0; i < WIN; i++) {
    const s = samples[start + i];
    e0 += s * s;
  }
  if (Math.sqrt(e0 / WIN) < RMS_MIN) return null;
  let bestLag = 0;
  let bestR = 0;
  const r = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let num = 0;
    let eLag = 0;
    const n = WIN - lag;
    for (let i = 0; i < n; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      num += a * b;
      eLag += b * b;
    }
    const v = num / Math.sqrt(e0 * eLag + 1e-12);
    r[lag] = v;
    if (v > bestR) {
      bestR = v;
      bestLag = lag;
    }
  }
  if (bestR < CLARITY_MIN || !bestLag) return null;
  // parabolic sub-sample refinement around the peak
  let lag = bestLag;
  if (bestLag > lagMin && bestLag < lagMax) {
    const a = r[bestLag - 1];
    const b = r[bestLag];
    const c = r[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom < 0) lag = bestLag + (0.5 * (a - c)) / denom;
  }
  return { hz: sampleRate / lag, clarity: bestR };
}

// Worth acting on? Two conditions.
//
// NEAR THE BIN EDGE: corpus-measured, not principled — Basic Pitch
// scores native takes at +34/+38 cents perfectly (F 0.97 mean), while
// takes within ~10 cents of the boundary collapse (F 0.53), and ANY
// resample perturbs its razor-edge note decisions by roughly the same
// amount as the documented -6 dB gain flip. So correction only pays
// where the systematic collapse outweighs the perturbation: |cents|
// >= 40.
//
// ENOUGH EVIDENCE: concentration x sqrt(windows), not raw
// concentration. A long expressive take spreads widely per window
// (vibrato, ornaments, drift — a real quarter-tone-flat take measured
// concentration 0.35 over 93 windows) yet its MEAN offset is pinned
// down by the sample count; short clean fixtures read 0.5-0.85 over
// 50-90. Concentration alone would reject exactly the takes that need
// the fix most. A take with no single tuning (evenly smeared) still
// fails: 0.1 x sqrt(93) ≈ 1.
export function shouldRetune({ cents, confidence, voiced }) {
  return (
    voiced >= 8 &&
    confidence * Math.sqrt(voiced) >= 3 &&
    Math.abs(cents) >= 40
  );
}

// the playback-speed ratio that moves a take `cents` off the grid back
// onto it (flat take -> ratio > 1: shorter, higher)
export const retuneRatio = (cents) => 2 ** (-cents / 1200);

// Move fine-cents trace frames onto the same grid the retuned notes
// live on. The frames are analyzed from the ORIGINAL audio (playback
// and the visible trace must stay honest), but pass 3 compares their
// pitch against note midis with sub-semitone tolerances — fed unshifted
// they'd misfire by the whole tuning offset. Times don't move: notes
// were mapped back to the original clock.
export function retuneFrames(frames, cents) {
  if (!cents) return frames;
  const ratio = retuneRatio(cents);
  return frames.map((f) => (f.freq ? { ...f, freq: f.freq * ratio } : f));
}

// linear-interpolation resample by ratio: pitch scales by `ratio`,
// duration by 1/ratio. Kept for reference only — MEASURED to damage
// real recordings enough to cost transcription accuracy (a near-grid
// take dropped F 1.00 -> 0.53 through one linear pass); use
// resampleSinc for anything the model will hear.
export function resampleLinear(f32, ratio) {
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const fr = p - j;
    out[i] = f32[j] * (1 - fr) + (f32[j + 1] ?? 0) * fr;
  }
  return out;
}

// windowed-sinc resample by ratio (pitch scales by `ratio`, duration by
// 1/ratio): 16 taps per side, Blackman-Harris window, kernels
// precomputed for 512 fractional phases. Transparent for the ±3%
// steps tuning correction needs, cheap enough for a 10-minute take.
const SINC_TAPS = 16;
const SINC_PHASES = 512;
let sincTable = null;

function buildSincTable() {
  const table = new Float32Array(SINC_PHASES * (2 * SINC_TAPS + 1));
  for (let p = 0; p < SINC_PHASES; p++) {
    const frac = p / SINC_PHASES;
    let sum = 0;
    for (let k = -SINC_TAPS; k <= SINC_TAPS; k++) {
      const x = k - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      // Blackman-Harris over the kernel's support
      const u = (x + SINC_TAPS) / (2 * SINC_TAPS);
      const w =
        u >= 0 && u <= 1
          ? 0.35875 -
            0.48829 * Math.cos(2 * Math.PI * u) +
            0.14128 * Math.cos(4 * Math.PI * u) -
            0.01168 * Math.cos(6 * Math.PI * u)
          : 0;
      const v = sinc * w;
      table[p * (2 * SINC_TAPS + 1) + (k + SINC_TAPS)] = v;
      sum += v;
    }
    // normalize each phase to unity gain
    for (let k = 0; k <= 2 * SINC_TAPS; k++) {
      table[p * (2 * SINC_TAPS + 1) + k] /= sum;
    }
  }
  return table;
}

export function resampleSinc(f32, ratio) {
  if (!sincTable) sincTable = buildSincTable();
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  const W = 2 * SINC_TAPS + 1;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const phase = Math.min(
      SINC_PHASES - 1,
      Math.round((pos - j) * SINC_PHASES),
    );
    const base = phase * W;
    let acc = 0;
    for (let k = -SINC_TAPS; k <= SINC_TAPS; k++) {
      const s = f32[j + k];
      if (s !== undefined) acc += s * sincTable[base + k + SINC_TAPS];
    }
    out[i] = acc;
  }
  return out;
}
