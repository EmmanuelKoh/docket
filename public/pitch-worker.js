// public/pitch-worker.js — pitch detection for the Tape tool, off the
// main thread (same pattern as dither-worker.js: vanilla JS, no imports,
// transferable buffers, one message in flight at a time).
//
// Two detectors, chosen per message:
//
// 'harm' (default) — harmonic-salience detector for real rooms: Hann
//   window → zero-padded FFT → subtract a slowly-learned estimate of the
//   STATIONARY spectrum (a dam/drone and room noise hold still; the
//   melody moves — so after a few seconds the background estimate IS the
//   drone, and it re-learns within seconds when the dam changes pitch) →
//   then score every candidate pitch in the melody band by how much of
//   the cleaned spectrum its harmonic comb explains, and take the best.
//   This is how melody-extraction systems handle accompaniment; a
//   time-domain autocorrelation cannot, because a loud low drone crushes
//   the melody's periodicity peak entirely.
//
// 'mpm' — McLeod Pitch Method (NSDF peak picking), the original
//   detector: slightly finer cents resolution, best for clean solo takes.
//
// message in:  { buf, sr, t, mode, fMin, gen }  Float32Array window
//              (transferred), sample rate, timestamp ms, detector mode,
//              melody-band floor Hz, take generation (bumps reset the
//              learned background so replays are deterministic)
// message out: { t, freq, clarity, rms, energy, cands }  freq null when
//              unvoiced; energy = cleaned-band energy (the tracker's
//              rest gate compares it against its recent level); cands =
//              alternate pitches for the drone filter

'use strict';

var RMS_FLOOR = 0.005; // below this the window is silence, skip the math

// ======================= harmonic-salience =======================

var FFT_N = 4096;      // zero-padded FFT size (window is 1024)
var F_MAX = 1050;      // top of the melody search band, Hz
var HARMONICS = 6;     // comb depth for salience
var GRID_CENTS = 10;   // f0 search resolution
// Background estimator: a dual-rate median-style tracker per bin, in
// the log domain — each frame the estimate steps UP 8 dB/s toward the
// (neighborhood-max) magnitude when below it, DOWN 4 dB/s when above.
// Equilibrium: a bin occupied more than ~1/3 of the time converges to
// its typical level; rarer visitors decay away. This is what a real dam
// needs — minimum statistics collapse at every breath the dam player
// takes, and a plain EMA absorbs the melody. Here the dam (present
// ~always, breaths included) is fully learned, while melody bins (a
// note at a time, then gone) never accumulate — and the tracked note's
// comb steps up at only 1 dB/s via the hold mask, so even long holds
// and note-heavy passages survive.
var BG_UP = 1.0108;    // ×/frame ≈ +8 dB/s at 86 fps
var BG_UP_HELD = 1.0013; // ≈ +1 dB/s on the held note's comb (a dam
                       // wrongly held at take start still learns
                       // eventually — a freeze would deadlock)
var BG_DOWN = 0.9947;  // ×/frame ≈ -4 dB/s
var BG_OVER = 1.5;     // oversubtraction: wobble peaks run above the
                       // converged typical level

var fftCos = null;
var fftSin = null;
var fftRe = new Float64Array(FFT_N);
var fftIm = new Float64Array(FFT_N);

function fftInit() {
  if (fftCos) return;
  fftCos = new Float64Array(FFT_N / 2);
  fftSin = new Float64Array(FFT_N / 2);
  for (var i = 0; i < FFT_N / 2; i++) {
    fftCos[i] = Math.cos((-2 * Math.PI * i) / FFT_N);
    fftSin[i] = Math.sin((-2 * Math.PI * i) / FFT_N);
  }
}

// iterative radix-2 Cooley-Tukey, in place
function fft(re, im) {
  var n = re.length;
  for (var i = 1, j = 0; i < n; i++) {
    var bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (var len = 2; len <= n; len <<= 1) {
    var step = n / len;
    for (var s = 0; s < n; s += len) {
      for (var k = 0; k < len / 2; k++) {
        var wr = fftCos[k * step];
        var wi = fftSin[k * step];
        var er = re[s + k];
        var ei = im[s + k];
        var or_ = re[s + k + len / 2] * wr - im[s + k + len / 2] * wi;
        var oi = re[s + k + len / 2] * wi + im[s + k + len / 2] * wr;
        re[s + k] = er + or_;
        im[s + k] = ei + oi;
        re[s + k + len / 2] = er - or_;
        im[s + k + len / 2] = ei - oi;
      }
    }
  }
}

// per-(sr,fMin) state: window, f0 grid, learned background spectrum
var HS = { sr: 0, fMin: 0, gen: -1, hann: null, grid: null, bg: null, binMax: 0 };

function hsPrepare(winLen, sr, fMin, gen) {
  fftInit();
  if (HS.sr === sr && HS.fMin === fMin && HS.gen === gen && HS.hann && HS.hann.length === winLen) return;
  if (!HS.hann || HS.hann.length !== winLen) {
    HS.hann = new Float64Array(winLen);
    for (var i = 0; i < winLen; i++) {
      HS.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winLen - 1));
    }
  }
  if (HS.sr !== sr || HS.fMin !== fMin) {
    var grid = [];
    var step = Math.pow(2, GRID_CENTS / 1200);
    for (var f = fMin; f <= F_MAX; f *= step) grid.push(f);
    HS.grid = grid;
    HS.binMax = Math.min(FFT_N / 2 - 2, Math.ceil(((F_MAX * (HARMONICS + 0.5)) / sr) * FFT_N));
  }
  // new take / new params: forget the learned background
  HS.bg = new Float64Array(HS.binMax + 1);
  HS.sr = sr;
  HS.fMin = fMin;
  HS.gen = gen;
}

// peak magnitude near a (fractional) bin — tolerates slight inharmonicity
function peakNear(clean, k, spread) {
  var lo = Math.max(0, Math.floor(k) - spread);
  var hi = Math.min(clean.length - 1, Math.ceil(k) + spread);
  var m = 0;
  for (var i = lo; i <= hi; i++) if (clean[i] > m) m = clean[i];
  return m;
}

function harmonicPitch(x, sr, fMin, gen, holdF0) {
  var n = x.length;
  var rms = 0;
  for (var i = 0; i < n; i++) rms += x[i] * x[i];
  rms = Math.sqrt(rms / n);
  if (rms < RMS_FLOOR) return { freq: null, clarity: 0, rms: rms, energy: 0, cands: [] };

  hsPrepare(n, sr, fMin, gen);
  // spectral widths scale with the analysis window: zero-padding to
  // FFT_N spreads a tone's mainlobe across ~16 bins for a 1024 window,
  // ~32 for 512 — every neighborhood below follows suit
  var LOBE = Math.max(4, Math.round((8 * 1024) / n)); // mainlobe half-width
  var SPREAD = Math.max(1, Math.round((2 * 1024) / n)); // peak search slop
  fftRe.fill(0);
  fftIm.fill(0);
  for (var w = 0; w < n; w++) fftRe[w] = x[w] * HS.hann[w];
  fft(fftRe, fftIm);

  var binMax = HS.binMax;
  var mag = new Float64Array(binMax + 1);
  for (var b = 0; b <= binMax; b++) {
    mag[b] = Math.hypot(fftRe[b], fftIm[b]);
  }

  // Bins on the comb of the note the tracker is CURRENTLY holding
  // (holdF0) learn extra slowly, so a long held melody note is never
  // eaten; a real drone still learns during rests and other notes.
  var hold = new Uint8Array(binMax + 1);
  if (holdF0 > 0) {
    for (var hh = 1; hh <= HARMONICS; hh++) {
      var hk = Math.round(((holdF0 * hh) / sr) * FFT_N);
      for (var hb = Math.max(0, hk - LOBE); hb <= Math.min(binMax, hk + LOBE); hb++) {
        hold[hb] = 1;
      }
    }
  }
  var bg = HS.bg;
  var clean = new Float64Array(binMax + 1);
  // near-silent frames carry no information about the background: FREEZE
  // learning instead of letting the estimate decay — else a pause in the
  // music erodes the drone model and the dam's re-entry reads as a note
  var learn = rms >= RMS_FLOOR * 2;
  for (var c = 0; c <= binMax; c++) {
    if (learn) {
      // learn from the neighborhood max: a wobbling dam smears its
      // energy across adjacent bins frame to frame
      var tgt = mag[c];
      if (c > 0 && mag[c - 1] > tgt) tgt = mag[c - 1];
      if (c < binMax && mag[c + 1] > tgt) tgt = mag[c + 1];
      if (bg[c] < tgt * 1e-3) bg[c] = tgt * 1e-3; // log-step bootstrap
      bg[c] *= tgt > bg[c] ? (hold[c] ? BG_UP_HELD : BG_UP) : BG_DOWN;
    }
    var v = mag[c] - BG_OVER * bg[c];
    clean[c] = v > 0 ? v : 0;
  }

  var fMinBin = Math.max(1, Math.floor((fMin / sr) * FFT_N));
  var totalClean = 0;
  for (var tb = fMinBin; tb <= binMax; tb++) totalClean += clean[tb];
  if (totalClean < 1e-6) return { freq: null, clarity: 0, rms: rms, energy: 0, cands: [] };

  // salience of every grid pitch: weighted comb over the cleaned spectrum
  var grid = HS.grid;
  var sal = new Float64Array(grid.length);
  for (var gi = 0; gi < grid.length; gi++) {
    var s = 0;
    for (var h = 1; h <= HARMONICS; h++) {
      var k = ((grid[gi] * h) / sr) * FFT_N;
      if (k > binMax) break;
      s += peakNear(clean, k, SPREAD) / h;
    }
    sal[gi] = s;
  }

  // local maxima of the salience curve, tallest first
  var maxima = [];
  for (var mi = 1; mi < grid.length - 1; mi++) {
    if (sal[mi] >= sal[mi - 1] && sal[mi] > sal[mi + 1]) maxima.push(mi);
  }
  if (!maxima.length) return { freq: null, clarity: 0, rms: rms, energy: 0, cands: [] };
  maxima.sort(function (a2, b2) { return sal[b2] - sal[a2]; });

  function refine(idx) {
    // The salience grid only locates the pitch to ~±10 cents (the comb
    // windows plateau); for vibrato-grade precision, re-estimate from
    // the spectrum itself: parabolic interpolation on the fundamental's
    // mainlobe peak gives a few cents.
    var f0 = grid[idx];
    var k0 = Math.round((f0 / sr) * FFT_N);
    var pb = k0;
    var pm = -1;
    for (var sb = Math.max(1, k0 - LOBE); sb <= Math.min(binMax - 1, k0 + LOBE); sb++) {
      if (clean[sb] > pm) { pm = clean[sb]; pb = sb; }
    }
    if (pm > 0) {
      var pa = clean[pb - 1];
      var pc = clean[pb + 1];
      var pden = pa - 2 * pm + pc;
      var psh = pden !== 0 ? (0.5 * (pa - pc)) / pden : 0;
      if (psh > -1 && psh < 1) f0 = ((pb + psh) * sr) / FFT_N;
    }
    // a grid-edge candidate can catch the mainlobe skirt of something
    // BELOW the melody band (the dam) and slide onto its true peak —
    // that's not melody, reject it rather than report a sub-floor pitch
    if (f0 < fMin * 0.99) return null;
    // ghost-comb rejection: if a strong fundamental exists at f0/2..f0/4
    // BELOW the melody floor, this "pitch" is the harmonic stack of a
    // sub-floor source (a dam harmonic masquerading as melody while
    // subtraction re-learns), not a melody note
    var f0bin = Math.round((f0 / sr) * FFT_N);
    var f0mag = peakNear(mag, f0bin, SPREAD);
    for (var dv = 2; dv <= 4; dv++) {
      var sub = f0 / dv;
      if (sub >= fMin || sub < 60) continue;
      var subMag = peakNear(mag, (sub / sr) * FFT_N, SPREAD);
      // the sub-floor fundamental must be clearly STRONGER than the
      // claimed pitch (a ghost's is ~3x its own harmonic) — a real
      // melody note an octave above the dam is quieter than that
      if (subMag >= 2.5 * f0mag) return null;
    }
    var comb = 0;
    for (var h2 = 1; h2 <= HARMONICS; h2++) {
      var k2 = ((f0 * h2) / sr) * FFT_N;
      if (k2 > binMax) break;
      var lo = Math.max(0, Math.round(k2) - LOBE);
      var hi = Math.min(binMax, Math.round(k2) + LOBE);
      for (var s2 = lo; s2 <= hi; s2++) comb += clean[s2];
    }
    return { freq: f0, clarity: Math.max(0, Math.min(1, comb / totalClean)) };
  }

  var cands = [];
  var used = [];
  for (var cm = 0; cm < maxima.length && cands.length < 5; cm++) {
    var far = true;
    for (var u = 0; u < used.length; u++) {
      if (Math.abs(1200 * Math.log2(grid[maxima[cm]] / used[u])) < 80) { far = false; break; }
    }
    if (!far) continue;
    used.push(grid[maxima[cm]]);
    var rc = refine(maxima[cm]);
    if (rc) cands.push(rc);
  }
  if (!cands.length) return { freq: null, clarity: 0, rms: rms, energy: totalClean, cands: [] };
  return { freq: cands[0].freq, clarity: cands[0].clarity, rms: rms, energy: totalClean, cands: cands };
}

// ======================= MPM (autocorrelation) =======================

var PEAK_CUTOFF = 0.9;   // take the first NSDF peak >= cutoff × tallest
var CAND_CUTOFF = 0.5;   // report peaks >= this × tallest as candidates
var FREQ_MIN = 60;       // Hz — NSDF search band (the tracker narrows it
var FREQ_MAX = 1400;     //      further with its live-tunable limits)

function nsdfPitch(x, sr) {
  var n = x.length;
  var tauMin = Math.max(2, Math.floor(sr / FREQ_MAX));
  var tauMax = Math.min(n - 2, Math.floor(sr / FREQ_MIN));

  var rms = 0;
  for (var i = 0; i < n; i++) rms += x[i] * x[i];
  rms = Math.sqrt(rms / n);
  if (rms < RMS_FLOOR) return { freq: null, clarity: 0, rms: rms, energy: 0, cands: [] };

  // NSDF: 2*acf(tau) / (m(tau)); values in [-1, 1], 1 = perfect period
  var nsdf = new Float32Array(tauMax + 1);
  for (var tau = tauMin; tau <= tauMax; tau++) {
    var acf = 0;
    var m = 0;
    for (var j = 0, k = tau; k < n; j++, k++) {
      acf += x[j] * x[k];
      m += x[j] * x[j] + x[k] * x[k];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // McLeod peak picking: the highest point between each positive zero
  // crossing pair is a candidate; accept the FIRST candidate that comes
  // within PEAK_CUTOFF of the tallest, so a strong harmonic at 2×tau
  // (half the frequency) can't steal a slightly taller peak.
  var peaks = [];
  var pos = false;
  var maxTau = -1;
  var maxVal = -1;
  for (var t2 = tauMin; t2 <= tauMax; t2++) {
    if (!pos && nsdf[t2] > 0 && nsdf[t2 - 1] <= 0) { pos = true; maxTau = -1; maxVal = -1; }
    if (pos) {
      if (nsdf[t2] > maxVal) { maxVal = nsdf[t2]; maxTau = t2; }
      if (nsdf[t2] <= 0 && nsdf[t2 - 1] > 0) {
        pos = false;
        if (maxTau > 0) peaks.push([maxTau, maxVal]);
      }
    }
  }
  if (pos && maxTau > 0) peaks.push([maxTau, maxVal]);
  if (!peaks.length) return { freq: null, clarity: 0, rms: rms, energy: 0, cands: [] };

  var tallest = 0;
  for (var pi = 0; pi < peaks.length; pi++) {
    if (peaks[pi][1] > tallest) tallest = peaks[pi][1];
  }

  // parabolic interpolation around a lag for sub-sample pitch
  function refine(ct) {
    var tau2 = ct;
    var val = nsdf[ct];
    if (ct > tauMin && ct < tauMax) {
      var a = nsdf[ct - 1];
      var b = nsdf[ct];
      var c = nsdf[ct + 1];
      var denom = a - 2 * b + c;
      if (denom !== 0) {
        var shift = (0.5 * (a - c)) / denom;
        if (shift > -1 && shift < 1) {
          tau2 = ct + shift;
          val = b - 0.25 * (a - c) * shift;
        }
      }
    }
    return { freq: sr / tau2, clarity: Math.max(0, Math.min(1, val)) };
  }

  var cands = [];
  for (var pc = 0; pc < peaks.length && cands.length < 6; pc++) {
    if (peaks[pc][1] >= CAND_CUTOFF * tallest) cands.push(refine(peaks[pc][0]));
  }
  var chosen = null;
  for (var pj = 0; pj < peaks.length; pj++) {
    if (peaks[pj][1] >= PEAK_CUTOFF * tallest) { chosen = refine(peaks[pj][0]); break; }
  }
  // rms doubles as the rest-gate energy for this detector
  return { freq: chosen.freq, clarity: chosen.clarity, rms: rms, energy: rms, cands: cands };
}

onmessage = function (ev) {
  var m = ev.data;
  var x = new Float32Array(m.buf);
  var r = m.mode === 'mpm'
    ? nsdfPitch(x, m.sr)
    : harmonicPitch(x, m.sr, m.fMin || 180, m.gen || 0, m.holdF0 || 0);
  postMessage({ t: m.t, freq: r.freq, clarity: r.clarity, rms: r.rms, energy: r.energy, cands: r.cands });
};
