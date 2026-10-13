// Golden printer bytes. Pins the exact ESC/POS output of every reference
// template (rendered with its own sample data), of a synthetic gray field
// tall enough to split into GS * chunks, and of a hand-written Tape roll,
// so any change to rendering, dithering or encoding shows up as a
// diff of tests/golden/escpos.json in review.
//
// Regenerate after an intended change, then read the JSON diff:
//   UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts
//
// Besides the hashes, every run checks contracts that hold whatever the
// golden says: the bytes parse as one of the two known encodings, the
// preview PNG shows exactly the dots the bytes print, and a second render
// of the same input is byte-identical.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTapeRenderer } from '@/components/tape-renderer.js';
import { FONT_DIR, PRINT_WIDTH } from '@/config.js';
import { renderToEscpos } from '@/render/render-core.js';

// config.js takes PRINT_WIDTH and FONT_DIR from the environment and
// vitest.config.ts does not pin them, so a developer's .env could swap the
// fonts or width under the golden. dotenv never overrides a variable that
// is already set, so empty strings force the defaults (576, render/fonts).
// vi.hoisted runs before the imports above.
vi.hoisted(() => {
  process.env.PRINT_WIDTH = '';
  process.env.FONT_DIR = '';
});

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_PATH = path.join(ROOT, 'tests', 'golden', 'escpos.json');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const FROZEN_NOW = new Date('2026-01-15T09:30:00Z');

// ---- inputs ----

type RefTemplate = {
  name: string;
  template: string;
  data: Record<string, unknown>;
};

const TEMPLATE_FILES = ['starter', 'wc', 'brief', 'photo', 'task'];

type RenderInput = RefTemplate & {
  key: string;
  minChunks?: number; // the input exists to exercise a GS * split
};

const REFERENCE: RenderInput[] = TEMPLATE_FILES.flatMap((set) => {
  const file = path.join(ROOT, 'reference', `${set}-templates.json`);
  const list: RefTemplate[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return list.map((t) => ({ key: `${set}/${t.name}`, ...t }));
});

// No reference template prints past one GS * chunk, so this mid-gray field
// (1000 dithered rows) pins the split at the RP850's probed ceiling of 100
// blocks = 800 rows per definition (docs/rp850-field-notes.md).
const RP850_MAX_CHUNK_BLOCKS = 100;
const SYNTHETIC: RenderInput[] = [
  {
    key: 'synthetic/Tall gray field',
    name: 'Tall gray field',
    template:
      '<div style="display:flex;width:576px;height:1000px;background:#808080"></div>',
    data: {},
    minChunks: 2,
  },
];

const TEMPLATES = [...REFERENCE, ...SYNTHETIC];

// One fixed melody driven through the renderer the way the Tape controller
// feeds it (advance to the event's time, then dispatch). Covers a plain
// note, a grace note, a slide (rising and same-pitch dip), a time-anchored
// ornament mark mid-note, a rest long enough for a breath mark, a note with
// its own ornament arc and accidental, a caesura, and ledger notes above
// and below the staff. Rendered under a flat key and a sharp key so the
// key signature and the sharp, flat and natural glyphs all print.
type TapeEvent =
  | {
      type: 'on';
      tMs: number;
      midi: number;
      grace?: boolean;
      slide?: boolean;
      ornament?: boolean;
      id?: string;
    }
  | { type: 'off'; tMs: number }
  | { type: 'mark'; tMs: number; id?: string }
  | { type: 'caesura'; tMs: number };

const TAPE_EVENTS: TapeEvent[] = [
  { type: 'on', tMs: 0, midi: 67, id: 'n1' }, // G4
  { type: 'off', tMs: 400 },
  { type: 'on', tMs: 420, midi: 72, grace: true, id: 'n2' }, // C5 grace
  { type: 'off', tMs: 450 },
  { type: 'on', tMs: 470, midi: 71, id: 'n3' }, // B4, hugs the grace
  { type: 'off', tMs: 900 },
  { type: 'on', tMs: 960, midi: 74, slide: true, id: 'n4' }, // D5 slide up
  { type: 'mark', tMs: 1200, id: 'm1' }, // ornament mid-hold
  { type: 'off', tMs: 1400 },
  { type: 'on', tMs: 1500, midi: 74, slide: true, id: 'n5' }, // same-pitch dip
  { type: 'off', tMs: 1800 },
  // 600 ms rest: breath mark
  { type: 'on', tMs: 2400, midi: 66, ornament: true, id: 'n6' }, // F#4 / Gb4
  { type: 'off', tMs: 2800 },
  { type: 'caesura', tMs: 2800 },
  { type: 'on', tMs: 2900, midi: 81, id: 'n7' }, // A5, ledger above
  { type: 'off', tMs: 3200 },
  { type: 'on', tMs: 3300, midi: 60, id: 'n8' }, // C4, ledger below
  { type: 'off', tMs: 3700 },
  { type: 'on', tMs: 3720, midi: 70, id: 'n9' }, // Bb4 / A#4
  { type: 'off', tMs: 4000 },
];

const TAPE_KEYS = [
  { key: 'tape/F major (1 flat)', keySig: -1 },
  { key: 'tape/D major (2 sharps)', keySig: 2 },
];

function renderTape(keySig: number) {
  const r = createTapeRenderer({ keySig });
  for (const e of TAPE_EVENTS) {
    r.advance(e.tMs);
    if (e.type === 'on') {
      r.noteOn(e.midi, e.tMs, e.grace, {
        slide: e.slide,
        ornament: e.ornament,
        id: e.id,
      });
    } else if (e.type === 'off') r.noteOff(e.tMs);
    else if (e.type === 'mark') r.markNow(e.id);
    else r.caesura();
  }
  return { renderer: r, bytes: Buffer.from(r.toEscpos()) };
}

// ---- ESC/POS parsing: the two encodings render-core can emit ----

const ESC_INIT = [0x1b, 0x40];
const GS_V0 = [0x1d, 0x76, 0x30, 0x00];
const LINE_SPACING_0 = [0x1b, 0x33, 0x00];
const GS_PRINT_MEMORIZED = [0x1d, 0x2f, 0x00];
const LINE_SPACING_DEFAULT = [0x1b, 0x32];
const FEED_AND_CUT = [0x1b, 0x64, 0x02, 0x1d, 0x56, 0x41, 0x03];
const FLUSH_CUT = [0x1d, 0x56, 0x42, 0x0c];

type Encoding = 'raster' | 'chunked' | 'chunked-rotated';

type Parsed = {
  encoding: Encoding;
  widthDots: number;
  rows: number; // dot rows the bytes carry, in print order
  chunks: number;
  chunkBlocks: number[]; // GS * height of each chunk in 8-row blocks
  bitmap: Uint8Array; // 1 = ink, row-major, widthDots x rows
};

function expectSeq(b: Buffer, at: number, seq: number[], what: string) {
  for (let i = 0; i < seq.length; i++) {
    if (b[at + i] !== seq[i]) {
      throw new Error(`expected ${what} at byte ${at}`);
    }
  }
}

function parseEscpos(b: Buffer): Parsed {
  expectSeq(b, 0, ESC_INIT, 'ESC @');
  if (b[2] === 0x1d && b[3] === 0x76) {
    // single raster: ESC @, GS v 0 xL xH yL yH, row-major rows, feed + cut
    expectSeq(b, 2, GS_V0, 'GS v 0');
    const xBytes = b[6] | (b[7] << 8);
    const rows = b[8] | (b[9] << 8);
    const start = 10;
    const end = start + xBytes * rows;
    expectSeq(b, end, FEED_AND_CUT, 'feed + full cut');
    if (b.length !== end + FEED_AND_CUT.length) {
      throw new Error(`${b.length - end - FEED_AND_CUT.length} trailing bytes`);
    }
    const w = xBytes * 8;
    const bitmap = new Uint8Array(w * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < w; x++) {
        const byte = b[start + y * xBytes + (x >> 3)];
        bitmap[y * w + x] = (byte >> (7 - (x & 7))) & 1;
      }
    }
    return {
      encoding: 'raster',
      widthDots: w,
      rows,
      chunks: 1,
      chunkBlocks: [],
      bitmap,
    };
  }
  // memorize-then-print: ESC @, ESC 3 0, (GS * x y data, GS / 0)+, ESC 2,
  // then a flush cut (rotated jobs) or feed + full cut
  expectSeq(b, 2, LINE_SPACING_0, 'ESC 3 0');
  let p = 5;
  let widthDots = 0;
  const bands: Uint8Array[] = [];
  while (b[p] === 0x1d && b[p + 1] === 0x2a) {
    const xBytes = b[p + 2];
    const yBlocks = b[p + 3];
    const w = xBytes * 8;
    if (widthDots && w !== widthDots) throw new Error('chunk widths differ');
    widthDots = w;
    const h = yBlocks * 8;
    const band = new Uint8Array(w * h);
    let i = p + 4;
    // column-major: per dot column, yBlocks bytes top to bottom, MSB = top
    for (let x = 0; x < w; x++) {
      for (let blk = 0; blk < yBlocks; blk++) {
        const byte = b[i++];
        for (let dy = 0; dy < 8; dy++) {
          band[(blk * 8 + dy) * w + x] = (byte >> (7 - dy)) & 1;
        }
      }
    }
    bands.push(band);
    p = i;
    expectSeq(b, p, GS_PRINT_MEMORIZED, 'GS / 0');
    p += GS_PRINT_MEMORIZED.length;
  }
  if (!bands.length) throw new Error('no GS * chunk');
  expectSeq(b, p, LINE_SPACING_DEFAULT, 'ESC 2');
  p += LINE_SPACING_DEFAULT.length;
  let encoding: Encoding;
  if (b[p] === FLUSH_CUT[0] && b[p + 2] === FLUSH_CUT[2]) {
    expectSeq(b, p, FLUSH_CUT, 'flush cut');
    p += FLUSH_CUT.length;
    encoding = 'chunked-rotated';
  } else {
    expectSeq(b, p, FEED_AND_CUT, 'feed + full cut');
    p += FEED_AND_CUT.length;
    encoding = 'chunked';
  }
  if (p !== b.length) throw new Error(`${b.length - p} trailing bytes`);
  const bitmap = Buffer.concat(bands);
  return {
    encoding,
    widthDots,
    rows: bitmap.length / widthDots,
    chunks: bands.length,
    chunkBlocks: bands.map((band) => band.length / widthDots / 8),
    bitmap,
  };
}

// ---- helpers ----

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function previewBits(png: Buffer) {
  const img = PNG.sync.read(png);
  const bits = new Uint8Array(img.width * img.height);
  let nonBinary = 0;
  for (let i = 0; i < bits.length; i++) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    const a = img.data[i * 4 + 3];
    if (!((r === 0 || r === 255) && r === g && g === b && a === 255)) {
      nonBinary++;
    }
    bits[i] = r === 0 ? 1 : 0;
  }
  return { width: img.width, height: img.height, bits, nonBinary };
}

function rotate180(bits: Uint8Array) {
  return bits.slice().reverse();
}

function lastInkRow(bits: Uint8Array, w: number) {
  for (let y = bits.length / w - 1; y >= 0; y--) {
    if (bits.subarray(y * w, (y + 1) * w).some((v) => v)) return y;
  }
  return -1;
}

function firstDiffRow(a: Uint8Array, b: Uint8Array, w: number) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return Math.floor(i / w);
  return a.length === b.length ? -1 : Math.floor(n / w);
}

// ---- golden file ----

type TemplateEntry = {
  sha256: string;
  length: number;
  width: number;
  height: number;
  encoding: Encoding;
  printedRows: number;
  chunks: number;
  previewPixelsSha256: string;
};

type TapeEntry = {
  sha256: string;
  length: number;
  width: number;
  height: number;
  encoding: Encoding;
  notes: number;
  marks: number;
};

type Golden = {
  templates: Record<string, TemplateEntry>;
  tape: Record<string, TapeEntry>;
};

const loaded: Golden | null = fs.existsSync(GOLDEN_PATH)
  ? JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'))
  : null;
const fresh: Golden = { templates: {}, tape: {} };

function checkGolden<K extends keyof Golden>(
  section: K,
  key: string,
  entry: Golden[K][string],
) {
  (fresh[section] as Record<string, Golden[K][string]>)[key] = entry;
  if (UPDATE) return;
  if (!loaded) {
    throw new Error(
      `${path.relative(ROOT, GOLDEN_PATH)} is missing; run: UPDATE_GOLDEN=1 npx vitest run tests/golden-escpos.test.ts`,
    );
  }
  expect(entry, `${section}/${key} drifted from the golden`).toEqual(
    loaded[section][key],
  );
}

// ---- tests ----

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
  // rendering must stay offline: satori fetches http(s) image sources
  vi.stubGlobal('fetch', () => {
    throw new Error('network access during golden render');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('golden ESC/POS: reference templates', () => {
  it('renders with the bundled fonts at 576 dots', () => {
    expect(PRINT_WIDTH).toBe(576);
    expect(path.resolve(FONT_DIR)).toBe(path.join(ROOT, 'render', 'fonts'));
  });

  it.each(TEMPLATES)('$key', { timeout: 60_000 }, async (t) => {
    const first = await renderToEscpos(t.template, t.data);
    const again = await renderToEscpos(t.template, t.data);
    const bytes = Buffer.from(first.bytes);

    // deterministic: same input, same bytes and preview
    expect(sha256(again.bytes), 'second render differs').toBe(sha256(bytes));
    expect(sha256(again.preview), 'second preview differs').toBe(
      sha256(first.preview),
    );

    const parsed = parseEscpos(bytes);
    expect(parsed.widthDots).toBe(first.width);
    expect(parsed.chunks).toBeGreaterThanOrEqual(t.minChunks ?? 1);

    // the preview is exactly what prints: 1-bit, full width, and the same
    // dots as the bytes (un-rotated for chunked jobs)
    const pv = previewBits(first.preview);
    expect(pv.nonBinary, 'preview has non 1-bit pixels').toBe(0);
    expect(pv.width).toBe(first.width);
    expect(pv.height).toBe(first.height);
    if (parsed.encoding === 'raster') {
      expect(parsed.rows).toBe(first.height);
      expect(firstDiffRow(parsed.bitmap, pv.bits, pv.width)).toBe(-1);
    } else {
      // rotate180 strips the former bottom margin and GS * pads to whole
      // 8-row blocks, so compare the inked part: the un-rotated print ends
      // with the preview's rows 0..last ink, preceded only by blank padding
      expect(parsed.encoding).toBe('chunked-rotated');
      // each GS * definition fits the printer, and output splits only at
      // that ceiling: every chunk but the last is a full one
      const blocks = parsed.chunkBlocks;
      expect(Math.max(...blocks), 'GS * chunk over 100 blocks').toBeLessThan(
        RP850_MAX_CHUNK_BLOCKS + 1,
      );
      expect(
        blocks.slice(0, -1).every((n) => n === RP850_MAX_CHUNK_BLOCKS),
        `chunks split below the ceiling: ${blocks.join(', ')}`,
      ).toBe(true);
      const upright = rotate180(parsed.bitmap);
      const inked = (lastInkRow(pv.bits, pv.width) + 1) * pv.width;
      const pad = upright.length - inked;
      expect(pad).toBeGreaterThanOrEqual(0);
      expect(pad).toBeLessThan(8 * pv.width);
      expect(
        upright.subarray(0, pad).every((v) => v === 0),
        'ink in block padding',
      ).toBe(true);
      expect(
        firstDiffRow(
          upright.subarray(pad),
          pv.bits.subarray(0, inked),
          pv.width,
        ),
      ).toBe(-1);
    }

    checkGolden('templates', t.key, {
      sha256: sha256(bytes),
      length: bytes.length,
      width: first.width,
      height: first.height,
      encoding: parsed.encoding,
      printedRows: parsed.rows,
      chunks: parsed.chunks,
      previewPixelsSha256: sha256(pv.bits),
    });
  });
});

describe('golden ESC/POS: tape renderer', () => {
  it.each(TAPE_KEYS)('$key', ({ key, keySig }) => {
    const { renderer, bytes } = renderTape(keySig);
    const again = renderTape(keySig);
    expect(sha256(again.bytes), 'second render differs').toBe(sha256(bytes));

    // one raster, same framing as render-core's text path; the bytes carry
    // exactly the renderer's rows plus the blank-staff tail
    const parsed = parseEscpos(bytes);
    expect(parsed.encoding).toBe('raster');
    expect(parsed.widthDots).toBe(renderer.width);
    expect(parsed.rows).toBe(renderer.rows.length + renderer.config.tailRows);
    const rowBytes = renderer.width / 8;
    const body = bytes.subarray(10, 10 + renderer.rows.length * rowBytes);
    expect(Buffer.compare(body, Buffer.concat(renderer.rows))).toBe(0);

    checkGolden('tape', key, {
      sha256: sha256(bytes),
      length: bytes.length,
      width: parsed.widthDots,
      height: parsed.rows,
      encoding: parsed.encoding,
      notes: renderer.notes.length,
      marks: renderer.marks.length,
    });
  });
});

describe('golden file', () => {
  const expectedKeys = () => ({
    templates: TEMPLATES.map((t) => t.key).sort(),
    tape: TAPE_KEYS.map((t) => t.key).sort(),
  });

  // writes only when every item rendered and passed its contract checks,
  // so a failing run never leaves a partial golden behind
  it.runIf(UPDATE)('rewrites tests/golden/escpos.json', () => {
    expect({
      templates: Object.keys(fresh.templates).sort(),
      tape: Object.keys(fresh.tape).sort(),
    }).toEqual(expectedKeys());
    fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(fresh, null, 2)}\n`);
    const n =
      Object.keys(fresh.templates).length + Object.keys(fresh.tape).length;
    console.log(
      `UPDATE_GOLDEN=1: rewrote ${path.relative(ROOT, GOLDEN_PATH)} (${n} entries) instead of asserting; review the diff before committing`,
    );
  });

  it.runIf(!UPDATE)('covers exactly the current inputs', () => {
    expect(loaded, 'golden file missing').not.toBeNull();
    expect(Object.keys(loaded?.templates ?? {}).sort()).toEqual(
      TEMPLATES.map((t) => t.key).sort(),
    );
    expect(Object.keys(loaded?.tape ?? {}).sort()).toEqual(
      TAPE_KEYS.map((t) => t.key).sort(),
    );
  });
});
