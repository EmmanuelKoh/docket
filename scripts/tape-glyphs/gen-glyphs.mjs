// Rasterize SMuFL glyphs from Bravura at a known scale and emit packed
// 1-bit bitmaps as a JS object for components/tape-renderer.js.
// SMuFL convention: 1 em = the 5-line staff height = 4 staff spaces, and
// the glyph origin (text baseline) sits on the note line the glyph
// attaches to. We render with the baseline at a known y, trim to the ink
// bbox, and record originFromTop so the renderer can anchor exactly.
// Run from the repo root with Bravura.otf placed next to this script:
//   node scripts/tape-glyphs/gen-glyphs.mjs
// Bravura is (c) Steinberg Media Technologies, SIL Open Font License
// 1.1 — download from github.com/steinbergmedia/bravura (not committed
// here; only the rasterized bitmaps ship, in components/tape-renderer.js).
// Paste the emitted glyphs-packed.js blocks into GLYPHS_PACKED there.
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import fs from 'fs';

const SPACE = 40; // px per staff space in the source bitmaps
const EM = SPACE * 4;
const CANVAS = 1024;
const BASELINE = 512;

const GLYPHS = {
  clef: 0xe050, // gClef
  sharp: 0xe262, // accidentalSharp
  flat: 0xe260, // accidentalFlat
  natural: 0xe261, // accidentalNatural
  breath: 0xe4ce, // breathMarkComma
  ornament: 0xe56c, // ornamentShortTrill — the approximate-ornament squiggle
};

const out = {};
for (const [name, cp] of Object.entries(GLYPHS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
    <text x="200" y="${BASELINE}" font-family="Bravura" font-size="${EM}" fill="#000">&#x${cp.toString(16)};</text>
  </svg>`;
  const r = new Resvg(svg, {
    font: {
      fontFiles: [new URL('./Bravura.otf', import.meta.url).pathname],
      loadSystemFonts: false,
      defaultFontFamily: 'Bravura',
    },
    fitTo: { mode: 'original' },
  });
  const png = PNG.sync.read(Buffer.from(r.render().asPng()));
  // ink bbox from alpha
  let x0 = CANVAS, x1 = -1, y0 = CANVAS, y1 = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { console.error(`NO INK for ${name} — glyph missing?`); process.exit(1); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const stride = Math.ceil(w / 8);
  const bytes = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (png.data[((y0 + y) * png.width + (x0 + x)) * 4 + 3] >= 128) {
        bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  out[name] = {
    w, h,
    originFromTop: BASELINE - y0,
    data: Buffer.from(bytes).toString('base64'),
  };
  console.error(`${name}: ${w}x${h} originFromTop=${BASELINE - y0} (${(h / SPACE).toFixed(2)} spaces tall) b64=${out[name].data.length} chars`);
}

// emit as JS
let js = `// Rasterized from Bravura (c) Steinberg Media Technologies,\n// SIL Open Font License 1.1 — engraved music glyphs at ${SPACE}px per\n// staff space, trimmed to ink, origin = the note line they attach to.\nconst GLYPH_SPACE_SRC = ${SPACE}; // source px per staff space\nconst GLYPHS_PACKED = {\n`;
for (const [name, g] of Object.entries(out)) {
  js += `  ${name}: {\n    w: ${g.w},\n    h: ${g.h},\n    originFromTop: ${g.originFromTop},\n    data:\n`;
  for (let i = 0; i < g.data.length; i += 68) {
    js += `      '${g.data.slice(i, i + 68)}'${i + 68 < g.data.length ? ' +' : ','}\n`;
  }
  js += `  },\n`;
}
js += `};\n`;
fs.writeFileSync(new URL('./glyphs-packed.js', import.meta.url), js);
console.error('wrote glyphs-packed.js');
