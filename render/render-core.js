// render-core.js
// Content -> printer bytes, with no browser.
//
//   Liquid template + data   (fill the blanks)
//        -> HTML
//        -> Satori           (lay out as an image, flexbox)
//        -> SVG -> PNG        (resvg)
//        -> Floyd-Steinberg   (real 1-bit, gray + photos become dots)
//        -> ESC/POS bytes     (GS v 0 raster, hand-rolled)
//
// Runs anywhere Node runs: your Mac now, Vercel later. Same code.

import fs from 'fs';
import path from 'path';
import { Liquid } from 'liquidjs';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { PRINT_WIDTH, FONT_DIR } from '../config.js';

const WIDTH = PRINT_WIDTH;
const WIDTH_BYTES = WIDTH / 8;

const liquid = new Liquid();
const fonts = [
  { name: 'Sans', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans.ttf')), weight: 400, style: 'normal' },
  { name: 'Sans', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')), weight: 700, style: 'normal' },
  { name: 'Mono', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSansMono.ttf')), weight: 400, style: 'normal' },
  { name: 'Mono', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSansMono-Bold.ttf')), weight: 700, style: 'normal' },
];

// 1) Liquid template + data -> HTML
async function fill(template, data) {
  return liquid.parseAndRender(template, data);
}

// 2) HTML -> RGBA pixels via Satori + resvg
async function toPixels(markupHtml, maxHeight = 1600) {
  const svg = await satori(html(markupHtml), { width: WIDTH, height: maxHeight, fonts });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render();
  return { rgba: r.pixels, width: r.width, height: r.height };
}

// 3) RGBA -> 1-bit via Floyd-Steinberg, trimming trailing blank rows
function dither({ rgba, width, height }) {
  // grayscale (white where transparent)
  const g = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3];
    if (a === 0) { g[i] = 255; continue; }
    const af = a / 255;
    g[i] = 0.299 * (rgba[i * 4] * af + 255 * (1 - af))
         + 0.587 * (rgba[i * 4 + 1] * af + 255 * (1 - af))
         + 0.114 * (rgba[i * 4 + 2] * af + 255 * (1 - af));
  }
  // Floyd-Steinberg, serpentine + threshold jitter.
  // Plain row-major FS locks into a rigid checkerboard at ~50% gray, which
  // prints as horizontal streaks (dot gain fuses the alternating rows).
  // Serpentine scanning (alternate rows sweep right-to-left) denies the
  // pattern a consistent direction, and a few levels of position-seeded
  // threshold noise breaks any residual lock. The jitter is deterministic
  // (hashed x,y) so preview and print dither identically; solid black/white
  // (text) can't be flipped by ±12.
  // Works in inverted domain (255 = black dot) like the original port.
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = 255 - Math.round(g[i]);
  const bits = new Uint8Array(width * height);
  let cur = new Float32Array(width + 2);
  let nxt = new Float32Array(width + 2);
  for (let y = 0; y < height; y++) {
    nxt.fill(0);
    const ltr = y % 2 === 0;
    for (let i = 0; i < width; i++) {
      const x = ltr ? i : width - 1 - i;
      // Anti-checkerboard: at ~50% gray the checkerboard is FS's stable
      // fixed point — it prints as horizontal streaks (dot gain fuses the
      // alternating rows) and it self-repairs against small perturbations.
      // Cure: big position-seeded threshold swings whose amplitude fades in
      // ONLY near mid-gray (peak ±48 at 128, zero beyond ±48 away), so the
      // lattice can't form there while all other tones — and pure black/
      // white text and margins — dither exactly as before. Deterministic,
      // so preview and print match; error diffusion still conserves tone.
      const gv = gray[y * width + x];
      let v = gv + cur[x + 1];
      if (v < 0) v = 0; else if (v > 255) v = 255;
      let threshold = 128;
      const amp = 48 - Math.abs(gv - 128);
      if (amp > 0 && gv > 15 && gv < 240) {
        let h = (x * 374761393 + y * 668265263) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        threshold += (((h >>> 16) % (2 * amp + 1)) - amp);
      }
      const out = v > threshold ? 255 : 0;
      bits[y * width + x] = out === 0 ? 0 : 1;
      const e = v - out;
      const fwd = ltr ? 1 : -1;
      cur[x + 1 + fwd] += (e * 7) / 16;   // ahead, same row
      nxt[x + 1 - fwd] += (e * 3) / 16;   // behind, next row
      nxt[x + 1] += (e * 5) / 16;         // below
      nxt[x + 1 + fwd] += (e * 1) / 16;   // ahead, next row
    }
    const t = cur; cur = nxt; nxt = t;
  }
  // trim trailing all-white rows so receipts aren't padded with blank paper
  let last = 0;
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width; x++) if (bits[y * width + x]) { any = true; break; }
    if (any) last = y;
  }
  const trimmed = Math.min(height, last + 32); // bottom margin below last ink
  return { bits, width, height: trimmed };
}

// 4) 1-bit -> ESC/POS bytes (GS v 0 raster image), with init + feed + cut
function toEscpos({ bits, width, height }) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    for (let xb = 0; xb < WIDTH_BYTES; xb++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const x = xb * 8 + b;
        if (x < width && bits[y * width + x]) byte |= (0x80 >> b); // MSB = leftmost
      }
      rows.push(byte);
    }
  }
  const yL = height & 0xff, yH = (height >> 8) & 0xff;
  const xL = WIDTH_BYTES & 0xff, xH = (WIDTH_BYTES >> 8) & 0xff;
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),                       // ESC @  init
    Buffer.from([0x1d, 0x76, 0x30, 0, xL, xH, yL, yH]), // GS v 0  raster
    Buffer.from(rows),
    Buffer.from([0x1b, 0x64, 0x02]),                 // ESC d 2  print and feed 2 lines
    Buffer.from([0x1d, 0x56, 0x41, 0x03]),            // GS V 65 3  feed 3 lines + full cut
  ]);
}

// 4b) 1-bit -> ESC/POS as memorize-then-print chunks (GS * / GS /).
// For dense images over serial: one big raster command starves the printer's
// buffer (the wire is ~8x slower than the head), making it crawl and stop —
// over-burnt photos with dark stall bands. Chunked, the printer absorbs each
// chunk with the head idle, then prints it as a short full-speed burst:
// even heat, no starvation. The spec caps GS * at x*y <= 1536 (~168 rows),
// but the RP850 was probed accepting 100 blocks (800 rows ≈ 58KB) in one
// definition — which single-chunks every photo we produce: one silent
// upload, one continuous full-speed print, zero seams. Taller-than-800-row
// output still splits automatically. Note GS * wants COLUMN-major data
// (top bit = top dot), unlike GS v 0's rows. Line spacing is zeroed so any
// multi-chunk output butts together seamlessly.
const CHUNK_BLOCKS = 100; // probed RP850 ceiling: 100 blocks = 800 rows/chunk

// Rotate a bitmap 180° and strip the leading blank rows the rotation
// creates (the former bottom margin). Used for the upside-down photo trick:
// the print head sits ~2cm upstream of the cutter, so every slip has a
// blank mechanical leader at its top — but the final cut lands EXACTLY at
// the content's end, so the bottom is flush. Print the image rotated and
// the flush-cut edge becomes the visual top; the leader becomes bottom
// margin. (180° of a flat w×h grid is just index reversal.)
function rotate180({ bits, width, height }) {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bits[n - 1 - i];
  let first = 0;
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width; x++) if (out[y * width + x]) { any = true; break; }
    if (any) { first = y; break; }
  }
  return { bits: out.slice(first * width), width, height: height - first };
}

function toEscposChunked({ bits, width, height }, { flushCut = false } = {}) {
  const parts = [
    Buffer.from([0x1b, 0x40]),        // ESC @  init
    Buffer.from([0x1b, 0x33, 0x00]),  // ESC 3 0  line spacing 0
  ];
  for (let y0 = 0; y0 < height; y0 += CHUNK_BLOCKS * 8) {
    const rows = Math.min(CHUNK_BLOCKS * 8, height - y0);
    const yBlocks = Math.ceil(rows / 8);
    const data = Buffer.alloc(WIDTH_BYTES * 8 * yBlocks);
    let i = 0;
    for (let x = 0; x < WIDTH_BYTES * 8; x++) {
      for (let b = 0; b < yBlocks; b++) {
        let byte = 0;
        for (let dy = 0; dy < 8; dy++) {
          const y = y0 + b * 8 + dy;
          if (y < height && x < width && bits[y * width + x]) byte |= (0x80 >> dy);
        }
        data[i++] = byte;
      }
    }
    parts.push(
      Buffer.from([0x1d, 0x2a, WIDTH_BYTES, yBlocks]), // GS *  memorize
      data,
      Buffer.from([0x1d, 0x2f, 0x00])                  // GS /  print it
    );
  }
  parts.push(Buffer.from([0x1b, 0x32]));                // restore line spacing
  if (flushCut) {
    // rotated jobs: cut just past the content's last row — the image's
    // (visual) top. The blade leaves ~1.5mm to the data by itself; +12 dots
    // (~1.5mm) makes a measured ~3mm visual top margin after flipping.
    parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x0c]));  // feed to cut pos +12 dots, cut
  } else {
    parts.push(
      Buffer.from([0x1b, 0x64, 0x02]),                  // feed 2
      Buffer.from([0x1d, 0x56, 0x41, 0x03])             // feed 3 + full cut
    );
  }
  return Buffer.concat(parts);
}

// Horizontal tone transitions per pixel — the fingerprint of dithered
// imagery. Dithering fakes gray by alternating ink/no-ink constantly
// (measured: photos ~0.38), while text is solid strokes (~0.01-0.12, the
// high end being templates with dithered accent bars). Threshold at 0.2.
// Ink *density* can't separate the classes: bold text hits ~20% ink while
// gamma-compensated photos sit ~25%.
function transitionsPerPixel({ bits, width, height }) {
  let t = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 1; x < width; x++) {
      if (bits[row + x] !== bits[row + x - 1]) t++;
    }
  }
  const total = width * height;
  return total ? t / total : 0;
}

// Orchestrate: template + data -> { bytes, preview(png), height }
async function renderToEscpos(template, data) {
  const markup = await fill(template, data);
  const pixels = await toPixels(markup);
  const bw = dither(pixels);
  // Dithered, tall output (photos, gradients) ships as memorize-then-print
  // chunks so the serial link never starves the head — printed 180°
  // ROTATED with a flush cut, so the mechanical top leader lands at the
  // slip's visual bottom (flip the slip to view). Solid-stroke output
  // (text receipts) keeps the plain raster command it has always used.
  // The preview stays unrotated: design right-side-up.
  const dithered = bw.height > 160 && transitionsPerPixel(bw) > 0.2;
  const bytes = dithered
    ? toEscposChunked(rotate180(bw), { flushCut: true })
    : toEscpos(bw);
  // also emit a preview PNG of exactly what will print (the 1-bit result)
  const preview = previewPng(bw);
  return { bytes, preview, width: WIDTH, height: bw.height };
}

// Same pipeline as renderToEscpos but skip the ESC/POS byte packing.
// Returns { preview: Buffer(PNG), width, height } — for the design studio.
async function renderToPreview(template, data) {
  const markup = await fill(template, data || {});
  const pixels = await toPixels(markup);
  const bw = dither(pixels);
  const preview = previewPng(bw);
  return { preview, width: WIDTH, height: bw.height };
}

// build a real PNG of the 1-bit bitmap, so you can see exactly what prints
function previewPng({ bits, width, height }) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const v = bits[i] ? 0 : 255;
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

export { renderToEscpos, renderToPreview, fill, toPixels, dither, toEscpos, WIDTH };
