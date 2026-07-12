// scripts/tape-eval/dereverb.mjs — single-channel late-reverberation
// suppression (Lebart/Habets-style spectral subtraction), run on the
// recording BEFORE Basic Pitch. Pure JS (own FFT, no dependencies), so
// the same module runs in the eval harness and the browser; the decode
// is offline, so compute cost is irrelevant.
//
// Model: a room's late reverb at time t is the signal from T_D seconds
// ago, decayed by the room's exponential decay rate (RT60 = time for a
// 60 dB drop). Estimate that tail's power per spectrogram bin from the
// smoothed observed power, subtract it, floor the gain so real (if
// quiet) signal is attenuated rather than erased, and resynthesize
// with the original phase. Artifacts (musical noise) matter less than
// usual: the consumer is a pitch model, not an ear. The raw-pitch
// trace intentionally stays on the ORIGINAL audio — it answers "what
// did the mic capture?", and this module answers "what did the player
// play?".
//
// Every parameter is take-relative or perceptually anchored, and the
// whole stage is corpus-gated: npm run tape:eval decides its defaults.

export const DEREVERB_DEFAULTS = {
  rt60: 0.6, // assumed room decay (s); moderate small-room default
  lateSec: 0.08, // early/late boundary: reflections after this are tail
  strength: 1.0, // over/under-subtraction factor (beta)
  floorGain: 0.1, // minimum spectral gain (-20 dB) against artifacts
  fftSize: 1024, // ~46 ms at 22.05 kHz
  hopDiv: 4, // 75% overlap (Hann COLA)
  smooth: 0.7, // PSD smoothing across frames
};

// iterative radix-2 complex FFT, in-place on {re, im}
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// audio: Float32Array at sr Hz -> new Float32Array, same length
export function dereverb(audio, sr, opts = {}) {
  const o = { ...DEREVERB_DEFAULTS, ...opts };
  const N = o.fftSize;
  const hop = N / o.hopDiv;
  const nFrames = Math.max(1, Math.floor((audio.length - N) / hop) + 1);
  const bins = N / 2 + 1;

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  }

  // late-reverb estimator constants
  const delta = (3 * Math.LN10) / o.rt60; // energy decay rate
  const D = Math.max(1, Math.round((o.lateSec * sr) / hop)); // frame lag
  const decay = Math.exp(-2 * delta * o.lateSec);

  const out = new Float32Array(audio.length);
  const norm = new Float32Array(audio.length); // COLA renormalization
  const psd = new Float32Array(bins); // smoothed observed PSD
  const hist = []; // last D smoothed-PSD frames
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (audio[start + i] || 0) * win[i];
      im[i] = 0;
    }
    fft(re, im, false);

    // smoothed PSD of the observed signal, and this frame's tail
    // estimate from the smoothed PSD D frames back
    const past = hist.length >= D ? hist[hist.length - D] : null;
    const snap = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      psd[b] = o.smooth * psd[b] + (1 - o.smooth) * p;
      snap[b] = psd[b];
      const tail = past ? o.strength * decay * past[b] : 0;
      const g = Math.max(o.floorGain, (p - tail) / (p || 1e-12));
      // spectral gain, mirrored onto the conjugate bin
      re[b] *= g;
      im[b] *= g;
      if (b > 0 && b < N / 2) {
        re[N - b] *= g;
        im[N - b] *= g;
      }
    }
    hist.push(snap);
    if (hist.length > D) hist.shift();

    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      out[start + i] += re[i] * win[i];
      norm[start + i] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (norm[i] > 1e-6) out[i] /= norm[i];
  }
  return out;
}
