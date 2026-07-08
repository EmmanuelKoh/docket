// components/tape-renderer.js — the Tape tool's raster renderer: note
// events in, printer rows out. Pure JS, no DOM, no imports, so the same
// module can run in the browser (live preview), a worker, or a Node
// script. The preview draws these exact rows and the print job sends
// these exact rows — there is no second, prettier rendering to drift.
//
// Orientation: the printer emits 576-dot rows down the tape; the tape is
// READ sideways, rotated 90° counter-clockwise (print-start end to the
// left). Under that rotation a printed row becomes a vertical column of
// the read image, dot x=0 lands at the BOTTOM, x=575 at the top. So:
//   time     -> row index (one row per msPerRow of SOUNDING time)
//   pitch    -> dot position x within the row, higher pitch = higher x
// Glyphs are authored in reading space (like you'd draw them on paper)
// and the blit does the rotation, so the bitmaps below stay legible.
//
// Layout decisions from the design discussion: hybrid staff-roll on a
// treble staff, diatonic mapping with a selectable key signature,
// accidentals for out-of-key notes, no barlines, no tick marks. Silence
// does not advance the tape; a gap longer than breathGapMs prints a
// breath mark (Luftpause) between the notes instead. Every distinct note
// gets at least one row. All geometry is config, not constants — the
// Tape page exposes it as sliders.

// ---- key signatures ----
// sharps: -7 (Cb major) .. 0 (C) .. +7 (C# major)
export const KEY_SIGS = [];
{
  const flats = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
  const sharps = ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  for (let i = 7; i >= 1; i--)
    KEY_SIGS.push({ sharps: -i, name: `${flats[7 - i]} major · ${i}♭` });
  KEY_SIGS.push({ sharps: 0, name: 'C major · no accidentals' });
  for (let i = 1; i <= 7; i++)
    KEY_SIGS.push({ sharps: i, name: `${sharps[i - 1]} major · ${i}♯` });
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BASE_PC = [0, 2, 4, 5, 7, 9, 11]; // pitch class of each natural letter
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

// Per-letter alteration a key signature applies: +1, -1 or 0.
function sigAlterations(sharps) {
  const alter = [0, 0, 0, 0, 0, 0, 0];
  if (sharps > 0) for (let i = 0; i < sharps; i++) alter[SHARP_ORDER[i]] = 1;
  if (sharps < 0) for (let i = 0; i < -sharps; i++) alter[FLAT_ORDER[i]] = -1;
  return alter;
}

// Spell a MIDI note in a key: which letter/octave (-> staff step) and
// which accidental glyph, if any. Preference order: the key's own
// spelling (no glyph), then a natural, then sharp-or-flat by key
// direction. Staff steps count diatonic steps from E4 = 0 (bottom line
// of the treble staff), so the lines sit at steps 0 2 4 6 8.
export function spellNote(midi, sharps) {
  const alter = sigAlterations(sharps);
  const pc = ((midi % 12) + 12) % 12;
  const tryLetters = (accOf) => {
    for (let L = 0; L < 7; L++) {
      const acc = accOf(L);
      if (acc === null) continue;
      if ((((BASE_PC[L] + acc) % 12) + 12) % 12 !== pc) continue;
      const octave = Math.round((midi - BASE_PC[L] - acc) / 12) - 1;
      const step = (octave - 4) * 7 + L - 2; // E4 -> 0
      return {
        letter: LETTERS[L],
        acc,
        octave,
        step,
        glyph:
          acc === alter[L]
            ? null
            : acc === 0
              ? 'natural'
              : acc > 0
                ? 'sharp'
                : 'flat',
      };
    }
    return null;
  };
  return (
    tryLetters((L) => alter[L]) || // in key
    tryLetters((L) => (alter[L] !== 0 ? 0 : null)) || // natural
    (sharps >= 0
      ? tryLetters(() => 1) || tryLetters(() => -1)
      : tryLetters(() => -1) || tryLetters(() => 1))
  );
}

// "F♯4" style label for the event log.
export function noteLabel(midi, sharps) {
  const s = spellNote(midi, sharps);
  if (!s) return `midi ${midi}`;
  const mark = s.acc === 1 ? '♯' : s.acc === -1 ? '♭' : '';
  return `${s.letter}${mark}${s.octave}`;
}

// ---- glyphs (authored in reading space: rows top->bottom = pitch
// high->low, columns left->right = time) ----
function bitmap(rows) {
  return {
    w: rows[0].length,
    h: rows.length,
    bits: rows.map((r) => [...r].map((c) => (c === '#' ? 1 : 0))),
  };
}
const GLYPHS = {
  sharp: bitmap([
    '.#.#.',
    '.#.#.',
    '#####',
    '.#.#.',
    '.#.#.',
    '#####',
    '.#.#.',
    '.#.#.',
  ]),
  flat: bitmap(['#....', '#....', '#....', '###..', '#..#.', '#..#.', '###..']),
  natural: bitmap([
    '#....',
    '#....',
    '#...#',
    '#####',
    '#...#',
    '#####',
    '#...#',
    '....#',
    '....#',
  ]),
  breath: bitmap(['.##', '.##', '..#', '.#.', '#..']),
};

// Where each accidental of a treble key signature sits (staff steps,
// standard order: F5 C5 G5 D5 A4 E5 B4 for sharps, B4 E5 A4 D5 G4 C5 F4
// for flats).
const SIG_STEPS_SHARP = [8, 5, 9, 6, 3, 7, 4];
const SIG_STEPS_FLAT = [4, 7, 3, 6, 2, 5, 1];

const WIDTH = 576;
const WIDTH_BYTES = WIDTH / 8;

export const TAPE_DEFAULTS = {
  msPerRow: 20, // one row of tape per this much SOUNDING time
  staffGap: 28, // dots between adjacent staff lines
  lineDots: 2, // staff/ledger line thickness (dots)
  noteDots: 10, // note bar thickness (dots)
  glyphScale: 2, // integer scale of the glyph bitmaps
  staffCenter: 288, // dot x of the middle staff line (B4)
  breathGapMs: 350, // a rest at least this long prints a breath mark
  gapRows: 6, // blank rows between consecutive notes
  breathRows: 10, // extra blank rows on each side of a breath mark
  leadRows: 32, // blank staff before the first note / after key sig
  tailRows: 32, // blank staff after the last note (before the cut)
  keySig: 0, // sharps count, -7..+7
};

export function createTapeRenderer(config) {
  let cfg = { ...TAPE_DEFAULTS, ...config };
  const rows = []; // Uint8Array(WIDTH_BYTES) each, append-only

  let cur = null; // { midi, step, onMs, rowsEmitted, rStart }
  let lastOffMs = null; // when the previous note ended
  let started = false;

  // Audio-time ↔ tape-row map for the player's playhead and scrubbing.
  // The tape is NOT linear in time (silence compresses to a breath mark,
  // key signatures and accidentals occupy rows that represent no time),
  // so each emitted span records its row range and the clip time it
  // covers: note bars span [noteOn, noteOff], the lead/gap/glyph rows
  // before a note span the silence that preceded it. Both columns are
  // monotonic, so mapping either way is an interpolating scan.
  const timeline = []; // { r0, r1, t0, t1 }

  function pushSpan(r0, t0, t1) {
    if (rows.length > r0 && t1 >= t0)
      timeline.push({ r0, r1: rows.length, t0, t1 });
  }

  // clip ms -> tape row (fractional)
  function rowForTime(ms) {
    if (!timeline.length) return 0;
    for (const s of timeline) {
      if (ms <= s.t1) {
        if (ms <= s.t0) return s.r0;
        return s.r0 + ((ms - s.t0) / (s.t1 - s.t0 || 1)) * (s.r1 - s.r0);
      }
    }
    return timeline[timeline.length - 1].r1;
  }

  // tape row -> clip ms
  function timeForRow(row) {
    if (!timeline.length) return 0;
    for (const s of timeline) {
      if (row <= s.r1) {
        if (row <= s.r0) return s.t0;
        return s.t0 + ((row - s.r0) / (s.r1 - s.r0 || 1)) * (s.t1 - s.t0);
      }
    }
    return timeline[timeline.length - 1].t1;
  }

  // dot x of a staff step (higher step = higher pitch = higher x)
  const xOfStep = (s) =>
    Math.round(cfg.staffCenter + (s - 4) * (cfg.staffGap / 2));

  function setDots(row, x0, w) {
    const lo = Math.max(0, Math.round(x0));
    const hi = Math.min(WIDTH - 1, Math.round(x0) + w - 1);
    for (let x = lo; x <= hi; x++) row[x >> 3] |= 0x80 >> (x & 7);
  }

  // a line of the staff: centered on a step's x, lineDots thick
  function setLine(row, step) {
    setDots(row, xOfStep(step) - Math.floor(cfg.lineDots / 2), cfg.lineDots);
  }

  function blankRow() {
    const row = new Uint8Array(WIDTH_BYTES);
    for (let s = 0; s <= 8; s += 2) setLine(row, s);
    return row;
  }

  // Ledger steps a note at `step` needs (even steps between the staff and
  // the note, inclusive when the note itself sits on a ledger line).
  function ledgerSteps(step) {
    const out = [];
    if (step <= -2) for (let s = -2; s >= step; s -= 2) out.push(s);
    if (step >= 10) for (let s = 10; s <= step; s += 2) out.push(s);
    return out;
  }

  function emitRow(withNote) {
    const row = blankRow();
    if (withNote && cur) {
      for (const s of ledgerSteps(cur.step)) setLine(row, s);
      setDots(
        row,
        xOfStep(cur.step) - Math.floor(cfg.noteDots / 2),
        cfg.noteDots,
      );
    }
    rows.push(row);
  }

  function emitBlank(n) {
    for (let i = 0; i < n; i++) emitRow(false);
  }

  // Blit a reading-space glyph centered (in pitch) on a staff step. Each
  // glyph column becomes glyphScale printed rows; bitmap row gy maps to
  // dot x descending from the glyph's top. Ledger lines (if any) continue
  // through the glyph region so an accidental never floats unanchored.
  function emitGlyph(name, step, ledgers) {
    const g = GLYPHS[name];
    const sc = cfg.glyphScale;
    const xTop = xOfStep(step) + Math.round((g.h * sc) / 2);
    for (let gx = 0; gx < g.w; gx++) {
      for (let r = 0; r < sc; r++) {
        const row = blankRow();
        if (ledgers) for (const s of ledgers) setLine(row, s);
        for (let gy = 0; gy < g.h; gy++) {
          if (g.bits[gy][gx]) setDots(row, xTop - (gy + 1) * sc, sc);
        }
        rows.push(row);
      }
    }
  }

  function emitKeySignature() {
    const n = Math.abs(cfg.keySig);
    const steps = cfg.keySig > 0 ? SIG_STEPS_SHARP : SIG_STEPS_FLAT;
    const glyph = cfg.keySig > 0 ? 'sharp' : 'flat';
    for (let i = 0; i < n; i++) {
      emitGlyph(glyph, steps[i], null);
      emitBlank(2);
    }
  }

  function start() {
    started = true;
    emitBlank(4);
    emitKeySignature();
    emitBlank(cfg.leadRows);
  }

  function noteOn(midi, tMs) {
    if (cur) noteOff(tMs); // defensive: overlapping monophonic events
    const preRow = rows.length;
    const preT = lastOffMs === null ? 0 : lastOffMs;
    if (!started) start();
    if (lastOffMs !== null) {
      if (tMs - lastOffMs >= cfg.breathGapMs) {
        emitBlank(cfg.breathRows);
        emitGlyph('breath', 10, null); // above the staff, like on paper
        emitBlank(cfg.breathRows);
      } else {
        emitBlank(cfg.gapRows);
      }
    }
    const sp = spellNote(midi, cfg.keySig);
    cur = { midi, step: sp.step, onMs: tMs, rowsEmitted: 0 };
    if (sp.glyph) {
      emitGlyph(sp.glyph, sp.step, ledgerSteps(sp.step));
      emitBlank(2);
    }
    pushSpan(preRow, preT, tMs); // lead/gap/glyph rows cover the silence
    cur.rStart = rows.length;
  }

  // Emit the rows the current note has earned up to tMs. Called every
  // frame while live, so a held note lengthens on tape (and paper, in the
  // streaming mode) while it is still sounding.
  function advance(tMs) {
    if (!cur) return;
    const owed = Math.floor((tMs - cur.onMs) / cfg.msPerRow) - cur.rowsEmitted;
    for (let i = 0; i < owed; i++) emitRow(true);
    if (owed > 0) cur.rowsEmitted += owed;
  }

  function noteOff(tMs) {
    if (!cur) return;
    advance(tMs);
    if (cur.rowsEmitted === 0) emitRow(true); // every note gets >= 1 row
    pushSpan(cur.rStart, cur.onMs, tMs);
    cur = null;
    lastOffMs = tMs;
  }

  // Full print job: same shape as the render core's text path (ESC @,
  // one GS v 0 raster, feed, full cut) — the proven encoding for sparse
  // line art. No 180° rotation: the streaming mode can't rotate, so the
  // take mode doesn't either, keeping orientation identical across both.
  function toEscpos() {
    const height = rows.length + cfg.tailRows;
    const body = new Uint8Array(height * WIDTH_BYTES);
    for (let y = 0; y < rows.length; y++) body.set(rows[y], y * WIDTH_BYTES);
    const blank = blankRow();
    for (let y = rows.length; y < height; y++) body.set(blank, y * WIDTH_BYTES);
    const head = [
      0x1b,
      0x40, // ESC @  init
      0x1d,
      0x76,
      0x30,
      0x00, // GS v 0  raster
      WIDTH_BYTES & 0xff,
      (WIDTH_BYTES >> 8) & 0xff,
      height & 0xff,
      (height >> 8) & 0xff,
    ];
    const tail = [
      0x1b,
      0x64,
      0x02, // ESC d 2  print and feed 2 lines
      0x1d,
      0x56,
      0x41,
      0x03, // GS V 65 3  feed 3 + full cut
    ];
    const out = new Uint8Array(head.length + body.length + tail.length);
    out.set(head, 0);
    out.set(body, head.length);
    out.set(tail, head.length + body.length);
    return out;
  }

  function setConfig(partial) {
    cfg = { ...cfg, ...partial };
  }

  return {
    rows,
    timeline,
    width: WIDTH,
    noteOn,
    noteOff,
    advance,
    rowForTime,
    timeForRow,
    toEscpos,
    setConfig,
    get config() {
      return cfg;
    },
    get sounding() {
      return cur ? cur.midi : null;
    },
  };
}
