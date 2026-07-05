// Dithered viewfinder worker — runs the live camera dither off the main
// thread so the page never stutters.
//
// Same recipe as the print pipeline (render/render-core.js): grayscale ->
// serpentine Floyd-Steinberg with position-seeded midtone threshold noise
// (peak ±48 at gray 128, gated to 16..239). No tone compensation: like the
// live preview, an uncompensated dither on a screen approximates what the
// compensated print looks like on paper.
//
// Two message kinds:
//   {buf, w, h}                video frame -> stabilized dither (below)
//   {cmd: 'still', buf, w, h}  captured still -> one-shot dither for the
//                              editor's display skin (fresh auto-levels,
//                              no temporal state)
// Buffers are transferred (zero-copy) both ways.

// Auto-levels state for video. The applied black/white points only step
// when the measured ones move >=2 levels: a continuously creeping exposure
// would re-scale every gray a hair per frame and defeat the stabilization.
var appLo = -1;
var appHi = -1;

// Temporal stabilization for video. Error diffusion is chaotic: a ±1
// flicker in ONE pixel rearranges dots for everything after it in scan
// order, so an unstabilized dither "boils" even on a static scene.
//   ema   - running average per pixel; single-frame sensor pops move it
//           only 25%, so they can't cross the deadband alone
//   shown - the value actually dithered; follows ema only when it strays
//           past the deadband, so a static scene dithers IDENTICAL input
//           every frame (identical input -> identical dots)
var ema = null;
var shown = null;
var DEADBAND = 8;

function toGray(d, n) {
  var gray = new Float32Array(n);
  for (var i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = (d[p] * 2126 + d[p + 1] * 7152 + d[p + 2] * 722) / 10000;
  }
  return gray;
}

// 0.5%-clip black/white points — the same measure the Levels AUTO uses
function clipPoints(gray, n) {
  var hist = new Uint32Array(256);
  for (var i = 0; i < n; i++) hist[gray[i] | 0]++;
  var clip = n * 0.005;
  var sum = 0, lo = 0, hi = 255;
  for (var a = 0; a < 256; a++) { sum += hist[a]; if (sum > clip) { lo = a; break; } }
  sum = 0;
  for (var b = 255; b >= 0; b--) { sum += hist[b]; if (sum > clip) { hi = b; break; } }
  if (hi - lo < 16) { lo = 0; hi = 255; }
  return [lo, hi];
}

function stretch(gray, n, lo, hi) {
  var scale = 255 / Math.max(1, hi - lo);
  for (var i = 0; i < n; i++) {
    var g = (gray[i] - lo) * scale;
    gray[i] = g < 0 ? 0 : g > 255 ? 255 : g;
  }
}

// serpentine Floyd-Steinberg with midtone threshold noise; writes the
// black/white result into the RGBA buffer
function dither(gray, d, w, h) {
  // error rows, padded one cell each side so diffusion never bounds-checks
  var cur = new Float32Array(w + 2);
  var next = new Float32Array(w + 2);

  for (var y = 0; y < h; y++) {
    var ltr = (y % 2) === 0;          // serpentine: alternate direction
    next.fill(0);
    for (var xi = 0; xi < w; xi++) {
      var x = ltr ? xi : (w - 1 - xi);
      var idx = y * w + x;
      var gv = gray[idx];
      var v = gv + cur[x + 1];
      if (v < 0) v = 0; else if (v > 255) v = 255;

      var threshold = 128;
      var amp = 48 - Math.abs(gv - 128);
      if (amp > 0 && gv > 15 && gv < 240) {
        var hsh = (x * 374761393 + y * 668265263) | 0;
        hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
        threshold += (((hsh >>> 16) % (2 * amp + 1)) - amp);
      }

      var out = v > threshold ? 255 : 0;
      var err = v - out;
      var f = ltr ? 1 : -1;
      cur[x + 1 + f] += err * 7 / 16;
      next[x + 1 - f] += err * 3 / 16;
      next[x + 1] += err * 5 / 16;
      next[x + 1 + f] += err * 1 / 16;

      var p2 = idx * 4;
      d[p2] = d[p2 + 1] = d[p2 + 2] = out;
      d[p2 + 3] = 255;
    }
    var t = cur; cur = next; next = t;
  }
}

self.onmessage = function (ev) {
  var w = ev.data.w, h = ev.data.h;
  var d = new Uint8ClampedArray(ev.data.buf);
  var n = w * h;
  var gray = toGray(d, n);

  if (ev.data.cmd === 'still') {
    var pts = clipPoints(gray, n);
    stretch(gray, n, pts[0], pts[1]);
    dither(gray, d, w, h);
    self.postMessage({ still: true, buf: d.buffer, w: w, h: h }, [d.buffer]);
    return;
  }

  // video frame: per-frame auto-levels (stepped) + temporal stabilization
  var m = clipPoints(gray, n);
  if (appLo < 0 || Math.abs(m[0] - appLo) >= 2 || Math.abs(m[1] - appHi) >= 2) {
    appLo = m[0];
    appHi = m[1];
  }
  stretch(gray, n, appLo, appHi);

  if (!ema || ema.length !== n) {
    ema = new Float32Array(gray);
    shown = new Float32Array(gray);
  } else {
    for (var ti = 0; ti < n; ti++) {
      var jump = gray[ti] - ema[ti];
      if (jump > 20 || jump < -20) {
        // real motion: snap immediately — smoothing here reads as ghosting
        ema[ti] = gray[ti];
        shown[ti] = gray[ti];
      } else {
        ema[ti] += jump * 0.25;
        var diff = ema[ti] - shown[ti];
        if (diff >= DEADBAND || diff <= -DEADBAND) shown[ti] = ema[ti];
        gray[ti] = shown[ti];
      }
    }
  }

  dither(gray, d, w, h);
  self.postMessage({ buf: d.buffer, w: w, h: h }, [d.buffer]);
};
