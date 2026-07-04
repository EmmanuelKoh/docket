// scripts/print-calibration.js — print a grayscale calibration receipt.
//
// Prints seven labeled rows, one per candidate tone curve (gamma). Each row:
// an 11-step wedge (black -> white, 10% steps) and a continuous ramp, run
// through the exact photo pipeline (same dither, same printer path).
//
// Read the print: pick the row where the wedge steps are all DISTINCT and
// look evenly spaced (especially 70-100% — dark steps must not fuse into
// black), and the ramp looks smooth. Set that row's gamma as GAMMA in
// views/photo.liquid.
//
//   node scripts/print-calibration.js                 -> production (PRINT_SERVER)
//   node scripts/print-calibration.js http://localhost:3000
//
// Uses DASHBOARD_PASSWORD from .env to sign in (the /jobs API is behind the
// session cookie).

import 'dotenv/config';
import { PNG } from 'pngjs';

const SERVER = process.argv[2] || process.env.PRINT_SERVER || 'http://localhost:3000';
const PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!PASSWORD) {
  console.error('DASHBOARD_PASSWORD not set in .env');
  process.exit(1);
}

// Tone-dependent transfer curve (from reading the 7-gamma calibration print):
// highlights need no lift, shadows need a lot. Anchors are [brightness,
// gamma], interpolated linearly between; output = b^gamma(b). Keep in sync
// with the copy in views/photo.liquid.
const CURVE = [
  [0.0, 0.50], [0.1, 0.53], [0.2, 0.53], [0.3, 0.58], [0.4, 0.63],
  [0.5, 0.70], [0.6, 0.78], [0.7, 0.88], [0.8, 0.96], [1.0, 1.00],
];

function curveLut() {
  const lut = [];
  for (let v = 0; v < 256; v++) {
    const b = v / 255;
    let g = CURVE[CURVE.length - 1][1];
    for (let i = 1; i < CURVE.length; i++) {
      if (b <= CURVE[i][0]) {
        const [b0, g0] = CURVE[i - 1];
        const [b1, g1] = CURVE[i];
        const f = b1 === b0 ? 0 : (b - b0) / (b1 - b0);
        g = g0 + f * (g1 - g0);
        break;
      }
    }
    lut[v] = Math.round(255 * Math.pow(b, g));
  }
  return lut;
}

const W = 528;   // strip width in the template

// mode 'both': wedge over ramp. mode 'ramp': one tall continuous gradient.
function stripPng(lut, mode, H) {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let target;
      if (mode === 'both' && y < H / 2) {
        const step = Math.min(10, Math.floor(x / (W / 11)));   // 11 steps
        target = Math.round(255 - step * 25.5);                // white -> black
      } else {
        target = Math.round(255 * (1 - x / (W - 1)));          // smooth ramp
      }
      const v = lut[target];
      const i = (W * y + x) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

const ROWS = [
  { label: 'custom curve', mode: 'both', h: 96, lut: curveLut() },
  { label: 'custom curve — continuous', mode: 'ramp', h: 150, lut: curveLut() },
  { label: 'gamma 1.00 (control)', mode: 'both', h: 96, lut: [...Array(256).keys()] },
];

const template = `
<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">
  <div style="display:flex;font-size:24px;font-weight:700">GRAYSCALE CALIBRATION</div>
  <div style="display:flex;font-size:14px;margin-bottom:6px">pick the row with distinct, even steps</div>
  {% for s in strips %}
  <div style="display:flex;font-family:Mono;font-size:16px;margin-top:10px">{{ s.label }}</div>
  <img src="{{ s.uri }}" style="width:528px;height:{{ s.h }}px" />
  {% endfor %}
</div>`;

const strips = ROWS.map(r => ({ label: r.label, h: r.h, uri: stripPng(r.lut, r.mode, r.h) }));

// sign in, then queue the job
const login = await fetch(`${SERVER}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'password=' + encodeURIComponent(PASSWORD),
  redirect: 'manual',
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie.includes('docket_session')) {
  console.error('login failed — check DASHBOARD_PASSWORD matches the server at', SERVER);
  process.exit(1);
}

const resp = await fetch(`${SERVER}/jobs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({
    template,
    data: { strips },
    name: 'Calibration',
    source: 'calibration',
  }),
});
const body = await resp.json();
if (!resp.ok) {
  console.error('job failed:', body.error);
  process.exit(1);
}
console.log(`queued ${body.id} (${body.width}x${body.height}) on ${SERVER}`);
console.log('read the print, then set the winning gamma as GAMMA in views/photo.liquid');
