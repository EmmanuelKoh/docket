// public/pitch-worker.js — monophonic pitch detection for the Tape tool,
// off the main thread (same pattern as dither-worker.js: vanilla JS, no
// imports, transferable buffers, one message in flight at a time — the
// engine posts the next window when the reply for this one arrives).
//
// Detector: McLeod Pitch Method (MPM) — the normalized square difference
// function (NSDF) peak picker used by most serious tuner apps. Chosen
// over plain autocorrelation for its built-in "clarity" measure (the
// NSDF peak height, ~0..1), which the note tracker uses as its voiced /
// unvoiced gate. The engine sends windows already decimated to ~22 kHz:
// duduk fundamentals top out well under 1 kHz, and halving the rate
// quarters the NSDF cost.
//
// message in:  { buf, sr, t }   Float32Array window (transferred), sample
//                               rate, timestamp ms
// message out: { t, freq, clarity, rms }   freq null when unvoiced

'use strict';

var PEAK_CUTOFF = 0.9;   // take the first NSDF peak >= cutoff × tallest
var RMS_FLOOR = 0.005;   // below this the window is silence, skip the math
var FREQ_MIN = 60;       // Hz — NSDF search band (the tracker narrows it
var FREQ_MAX = 1400;     //      further with its live-tunable limits)

function nsdfPitch(x, sr) {
  var n = x.length;
  var tauMin = Math.max(2, Math.floor(sr / FREQ_MAX));
  var tauMax = Math.min(n - 2, Math.floor(sr / FREQ_MIN));

  var rms = 0;
  for (var i = 0; i < n; i++) rms += x[i] * x[i];
  rms = Math.sqrt(rms / n);
  if (rms < RMS_FLOOR) return { freq: null, clarity: 0, rms: rms };

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
  if (!peaks.length) return { freq: null, clarity: 0, rms: rms };

  var tallest = 0;
  for (var pi = 0; pi < peaks.length; pi++) {
    if (peaks[pi][1] > tallest) tallest = peaks[pi][1];
  }
  var chosen = null;
  for (var pj = 0; pj < peaks.length; pj++) {
    if (peaks[pj][1] >= PEAK_CUTOFF * tallest) { chosen = peaks[pj]; break; }
  }

  // parabolic interpolation around the chosen lag for sub-sample pitch
  var ct = chosen[0];
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
  return { freq: sr / tau2, clarity: Math.max(0, Math.min(1, val)), rms: rms };
}

onmessage = function (ev) {
  var m = ev.data;
  var r = nsdfPitch(new Float32Array(m.buf), m.sr);
  postMessage({ t: m.t, freq: r.freq, clarity: r.clarity, rms: r.rms });
};
