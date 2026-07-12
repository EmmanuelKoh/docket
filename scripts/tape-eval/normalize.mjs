// scripts/tape-eval/normalize.mjs — input loudness normalization
// (robustness item 2, first half): every recording reaches the model
// at the SAME loudness, because the whole evidence chain is
// amplitude-shaped — Basic Pitch's event thresholds and the skeleton's
// gates are calibrated to a level, and a -6 dB gain change alone was
// measured to flip note decisions (a confirmed G4 vanished). Pure JS,
// shared by the Node harness and the browser engine.
//
// Level statistic: the median frame RMS over ACTIVE frames (those
// above a tenth of the loudest frame) — robust to leading silence,
// breaths, and single transients, unlike whole-take RMS or peak. The
// target is the level the fixture corpus was calibrated at.

export const NORMALIZE_DEFAULTS = {
  targetRms: 0.025, // calibration loudness — corpus-selected (best
  // mean F across fixtures when all arrive at one common level)
  frameLen: 1024, // ~46 ms at 22.05 kHz
  activeFrac: 0.1, // frames above this fraction of the max are active
  maxGain: 8, // don't amplify junk/noise-floor recordings into signal
  peakCeil: 0.98, // never push samples into clipping
};

// the browser records everything through a ~130 Hz high-pass (RBJ
// biquad, room rumble/handling noise; the duduk's lowest note is well
// above). The harness applies the same filter so Node and browser
// analyze identical signals.
export function highpass130(audio, sr) {
  const w0 = (2 * Math.PI * 130) / sr;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cosw) / 2 / a0;
  const b1 = -(1 + cosw) / a0;
  const b2 = (1 + cosw) / 2 / a0;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(audio.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < audio.length; i++) {
    const x = audio[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

// audio: Float32Array -> new Float32Array at the calibration loudness
export function normalizeLoudness(audio, opts = {}) {
  const o = { ...NORMALIZE_DEFAULTS, ...opts };
  const F = o.frameLen;
  const rms = [];
  for (let s = 0; s + F <= audio.length; s += F) {
    let e = 0;
    for (let i = s; i < s + F; i++) e += audio[i] * audio[i];
    rms.push(Math.sqrt(e / F));
  }
  if (!rms.length) return audio;
  const max = Math.max(...rms);
  if (max <= 0) return audio;
  const active = rms.filter((r) => r >= o.activeFrac * max).sort((a, b) => a - b);
  const level = active[Math.floor(active.length / 2)];
  if (!level) return audio;
  let peak = 0;
  for (const x of audio) peak = Math.max(peak, Math.abs(x));
  const gain = Math.min(
    o.targetRms / level,
    o.maxGain,
    peak > 0 ? o.peakCeil / peak : o.maxGain,
  );
  const out = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) out[i] = audio[i] * gain;
  return out;
}
