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
  // Floyd-Steinberg
  const bits = new Uint8Array(width * height); // 1 = black dot
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, old = g[i], nv = old < 128 ? 0 : 255, err = old - nv;
      g[i] = nv;
      bits[i] = nv === 0 ? 1 : 0;
      if (x + 1 < width) g[i + 1] += err * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) g[i + width - 1] += err * 3 / 16;
        g[i + width] += err * 5 / 16;
        if (x + 1 < width) g[i + width + 1] += err * 1 / 16;
      }
    }
  }
  // trim trailing all-white rows so receipts aren't padded with blank paper
  let last = 0;
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width; x++) if (bits[y * width + x]) { any = true; break; }
    if (any) last = y;
  }
  const trimmed = Math.min(height, last + 16); // small bottom margin
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

// Orchestrate: template + data -> { bytes, preview(png), height }
async function renderToEscpos(template, data) {
  const markup = await fill(template, data);
  const pixels = await toPixels(markup);
  const bw = dither(pixels);
  const bytes = toEscpos(bw);
  // also emit a preview PNG of exactly what will print (the 1-bit result)
  const preview = previewPng(bw);
  return { bytes, preview, width: WIDTH, height: bw.height };
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

export { renderToEscpos, fill, toPixels, dither, toEscpos, WIDTH };
