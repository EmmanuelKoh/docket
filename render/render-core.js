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
import { CaptureTag, Liquid, LiquidError } from 'liquidjs';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { PRINT_WIDTH, FONT_DIR } from '../config.js';
import { unescapeHtml } from './escape-html.js';
import { BLANK_IMAGE, guardImages, isFragmentHref, safeDataUrl, urlsAreLocal } from './image-guard.js';

const WIDTH = PRINT_WIDTH;
const WIDTH_BYTES = WIDTH / 8;

// ENCODER names the framing (mode, rotate, flushCut, chunking), not the
// pixels. Bump it only when parseEscpos (tests/golden-escpos.test.ts) has
// to learn a new framing. Template edits, dither tuning and golden
// regeneration do not bump it. Stored on each job as encoding.encoder.
const ENCODER = 'render-core/1';

// Templates are account input, so Liquid never reads files: render,
// include and layout look names up in this empty map and fail. Without
// it they read from the working directory (package.json, a local .env).
// The map has no prototype, so 'constructor' or 'toString' are not names.
//
// Account input also gets bounded Liquid work, so filling a template in
// cannot hang a function or fill its memory. Measured 2026-10-13 on every
// reference template with its sample data: at most 2,511 characters of
// source, 0 memory units, 3,219 characters of output, and 5.1 ms for a
// cold first render (0.3 ms warm).
//   parseLimit   characters of source. Parsing is superlinear in tags:
//                100,000 characters of {{a}} parse in about 0.2 s, a
//                million in 18 s. Room for an inline data: image.
//   renderLimit  wall time of one render, in ms. Liquid checks it
//                between tags only, so one filter call is bounded by
//                memoryLimit instead.
//   memoryLimit  Liquid's allocation units: range sizes, the array and
//                string lengths filters build, (CountedCapture below)
//                the strings {% capture %} builds, and (PER_ITEM_FILTERS
//                below) the property lookups a filter does per item.
//                10 million covers a filter over the largest request
//                body (about 4.5 MB). At the limit, the slowest measured
//                filter work (per-item property lookups) took 0.3 s.
// FILL_OUTPUT_LIMIT caps the filled-in HTML, which Liquid does not count:
// a 5,000-pass loop over a 3,300-character string outputs 16.5 million
// characters in 25 ms. 5 million characters is above the largest
// legitimate output, a Photo print's data: URI, which the ~4.5 MB request
// cap bounds.
// tests/liquid-limits.test.ts holds the reference templates to a small
// fraction of each limit.
//
// Not bounded here: Satori's layout time, and the memory resvg uses to
// decode an image. Layout grows with the text and elements the HTML
// holds, not its length: 147,456 characters of plain text, from a
// 150-character template inside every limit, was still laying out after
// 30 s. A 17.5 KB PNG that declares 12000x12000 pixels took the render to
// 830 MB. Both are open decisions.
const LIQUID_LIMITS = Object.freeze({
  parseLimit: 100_000,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});
const FILL_OUTPUT_LIMIT = 5_000_000;
const liquid = new Liquid({ templates: Object.create(null), ...LIQUID_LIMITS });

// Liquid does not count what {% capture %} builds, so a template could
// double a capture 23 times to 300 million characters in a millisecond.
// This capture counts its result against memoryLimit, as append does.
class CountedCapture extends CaptureTag {
  *render(ctx) {
    yield* super.render(ctx);
    const value = ctx.bottom()[this.variable];
    ctx.memoryLimit.use(typeof value === 'string' ? value.length : 0);
  }
}
liquid.registerTag('capture', CountedCapture);

// renderLimit is only checked between tags, never inside one filter call.
// Filters that read a property on every item walk the whole property path
// for each item, and Liquid charges only the item count (sum charges
// nothing). A 1-million-character path ("a.a.a...") mapped over 2,048
// items ran for minutes inside every limit. These filters charge
// items x (1 + the property's length) x a weight against memoryLimit
// before they run. The _exp filters run their expression once per item
// and are charged the same way for the expression. The weight evens out
// the cost per unit: the filters that parse the property as an
// expression (where, group_by, has, find and the _exp filters) measured
// about 8 times slower per unit than sort, map and sum. Each entry: which
// argument holds the property or expression, and the weight.
const PER_ITEM_FILTERS = {
  sort: [0, 1], sort_natural: [0, 1], map: [0, 1], sum: [0, 1],
  where: [0, 8], reject: [0, 8], group_by: [0, 8], has: [0, 8], find: [0, 8], find_index: [0, 8],
  where_exp: [1, 8], reject_exp: [1, 8], group_by_exp: [1, 8], has_exp: [1, 8], find_exp: [1, 8], find_index_exp: [1, 8],
};
const itemCount = v => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 1);
for (const [name, [argIndex, weight]] of Object.entries(PER_ITEM_FILTERS)) {
  const builtin = liquid.filters[name];
  if (typeof builtin !== 'function') throw new Error(`liquidjs has no built-in filter ${name} to count`);
  liquid.registerFilter(name, function (input, ...args) {
    const arg = args[argIndex];
    this.context.memoryLimit.use(itemCount(input) * (1 + (arg == null ? 0 : String(arg).length)) * weight);
    return builtin.call(this, input, ...args);
  });
}

// Liquid's own messages name no limit, and the parse-length one is not a
// LiquidError, so the Studio preview would answer 500 instead of showing
// it. fill() rethrows all three as LiquidErrors that name the limit.
const LIMIT_MESSAGES = [
  ['parse length limit exceeded', `template is longer than ${LIQUID_LIMITS.parseLimit.toLocaleString('en-US')} characters`],
  ['template render limit exceeded', `template took longer than ${LIQUID_LIMITS.renderLimit.toLocaleString('en-US')} ms to fill`],
  ['memory alloc limit exceeded', `template built more than ${LIQUID_LIMITS.memoryLimit.toLocaleString('en-US')} items (loop ranges, captures, filter results and per-item property lookups)`],
];

const fonts = [
  { name: 'Sans', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans.ttf')), weight: 400, style: 'normal' },
  { name: 'Sans', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')), weight: 700, style: 'normal' },
  { name: 'Mono', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSansMono.ttf')), weight: 400, style: 'normal' },
  { name: 'Mono', data: fs.readFileSync(path.join(FONT_DIR, 'DejaVuSansMono-Bold.ttf')), weight: 700, style: 'normal' },
];

// 1) Liquid template + data -> HTML
async function fill(template, data) {
  let markup;
  try {
    markup = await liquid.parseAndRender(template, data);
  } catch (err) {
    const message = typeof err?.message === 'string' ? err.message : '';
    const hit = LIMIT_MESSAGES.find(([liquidMessage]) => message.startsWith(liquidMessage));
    if (!hit) throw err;
    // Keeps Liquid's ", line:1, col:25" position where it gave one.
    throw new LiquidError(hit[1] + message.slice(hit[0].length), err.token);
  }
  if (markup.length > FILL_OUTPUT_LIMIT) {
    throw new LiquidError(`template filled in to more than ${FILL_OUTPUT_LIMIT.toLocaleString('en-US')} characters`);
  }
  return markup;
}

// Escaped text (data escaped before it reached the template, as
// plugins/message-ingest.js does, or Liquid's escape filter) reaches
// Satori with its entities as typed, so "&amp;" would print as five
// characters. Decode the escaped forms of & < > " ' back to the
// characters (render/escape-html.js), in text only and after parsing,
// so they print as text and never become markup. Other entities stay as
// typed.
//
// Never inside an <svg>. Satori writes an svg subtree out as raw markup
// inside an XML attribute (a data: URL), and that attribute is
// entity-decoded once more before the inner SVG is parsed: "&lt;rect/&gt;"
// typed in an svg would become a live <rect>, decoded here or not. So in
// an svg subtree, text is dropped (an SVG never draws bare text, and
// Satori would also lay it out as stray glyphs), attribute and inner
// style values are escaped once for each of the two parses, and an
// attribute or style name that is not a plain name is dropped. A value
// then reaches the inner SVG as a value, never as markup.
const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const xmlEscape = s => s.replace(/[&<>"']/g, c => XML_ESCAPES[c]);
const sealValue = v => xmlEscape(xmlEscape(unescapeHtml(v)));
const PLAIN_ATTR = /^[A-Za-z_][-A-Za-z0-9_:.]*$/;
const PLAIN_STYLE = /^[A-Za-z][-A-Za-z0-9]*$/;

// The root svg's own style is layout input to Satori, not markup, so it
// stays as typed.
//
// resvg reads an href that is not a data: URL or a #fragment as a file
// path on the server (feImage reads one even inside an inline svg). So on
// every element an href (href, xlink:href, any prefix:href) keeps only a
// #fragment or a data: URL that passes the image guard's check, in its
// checked base64 form (render/image-guard.js safeDataUrl). Any other href
// is dropped, or on <image> made a blank. An attribute or style value
// with a url() that does not start with # or data: is dropped too. Both
// are checked on the value resvg reads after the two parses
// (unescapeHtml of the value as typed).
const isHrefKey = key => {
  const k = key.toLowerCase();
  return k === 'href' || k === 'xlinkhref' || k.endsWith(':href');
};
function sealSvg(node, root) {
  const props = node?.props;
  if (!props || typeof props !== 'object') return;
  const isImage = typeof node.type === 'string' && node.type.toLowerCase() === 'image';
  for (const key of Object.keys(props)) {
    if (key === 'children' || (root && key === 'style')) continue;
    const value = props[key];
    if (!PLAIN_ATTR.test(key)) delete props[key];
    else if (isHrefKey(key)) {
      const read = typeof value === 'string' ? unescapeHtml(value) : '';
      const data = read.startsWith('data:') ? safeDataUrl(read) : null;
      if (isFragmentHref(read)) props[key] = sealValue(value);
      else if (data) props[key] = data;
      else if (isImage) props[key] = BLANK_IMAGE;
      else delete props[key];
    }
    else if (key === 'style' && value && typeof value === 'object') {
      const sealed = {};
      for (const [k, v] of Object.entries(value)) {
        if (!PLAIN_STYLE.test(k)) continue;
        if (typeof v !== 'string') sealed[k] = v;
        else if (urlsAreLocal(unescapeHtml(v))) sealed[k] = sealValue(v);
      }
      props.style = sealed;
    } else if (typeof value === 'string') {
      if (urlsAreLocal(unescapeHtml(value))) props[key] = sealValue(value);
      else delete props[key];
    }
  }
  const kids = props.children;
  if (typeof kids === 'string') props.children = [];
  else if (Array.isArray(kids)) {
    for (let i = 0; i < kids.length; i++) {
      if (typeof kids[i] === 'string') kids[i] = undefined;
      else if (kids[i]) sealSvg(kids[i], false);
    }
  }
}

// Children may be one string or a sparse array (satori-html leaves holes
// where whitespace was); holes stay holes.
function prepareTree(node) {
  if (node?.type === 'svg') {
    sealSvg(node, true);
    return node;
  }
  const kids = node?.props?.children;
  if (typeof kids === 'string') node.props.children = unescapeHtml(kids);
  else if (Array.isArray(kids)) {
    for (let i = 0; i < kids.length; i++) {
      if (typeof kids[i] === 'string') kids[i] = unescapeHtml(kids[i]);
      else if (kids[i]) prepareTree(kids[i]);
    }
  }
  return node;
}

// HTML -> the element tree Satori lays out. Image sources are left as
// typed here; toPixels guards them first.
const toElement = markupHtml => prepareTree(html(markupHtml));

// 2) HTML -> RGBA pixels via Satori + resvg. Every image source becomes
// a data: URL first (render/image-guard.js), so Satori never fetches.
async function toPixels(markupHtml, maxHeight = 1600) {
  const tree = await guardImages(html(markupHtml));
  const svg = await satori(prepareTree(tree), { width: WIDTH, height: maxHeight, fonts });
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

// Orchestrate: template + data -> { bytes, preview(png), width, height,
// encoding }. encoding reports which framing the bytes use; it never
// changes them.
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
  const encoding = dithered
    ? { mode: 'chunked', rotate: 180, flushCut: true, encoder: ENCODER }
    : { mode: 'raster', rotate: 0, flushCut: false, encoder: ENCODER };
  // also emit a preview PNG of exactly what will print (the 1-bit result)
  const preview = previewPng(bw);
  return { bytes, preview, width: WIDTH, height: bw.height, encoding };
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

export { renderToEscpos, renderToPreview, fill, toElement, toPixels, dither, toEscpos, WIDTH, ENCODER, LIQUID_LIMITS, FILL_OUTPUT_LIMIT };
