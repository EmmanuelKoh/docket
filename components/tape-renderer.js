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

// ---- glyphs: engraved shapes, not pixel art. Rasterized offline from
// Bravura (c) Steinberg Media Technologies, SIL Open Font License 1.1 —
// the reference engraving font used by professional notation software —
// at 40 source px per staff space, trimmed to the ink box, packed as
// 1-bit base64 rows (reading space: rows top->bottom = pitch high->low).
// originFromTop is where the note line the glyph attaches to crosses the
// bitmap (the font's baseline): sharp/natural center on it, the flat's
// bowl wraps it, the G clef's curl winds around it, the breath comma
// sits fully above it. Regenerate with scripts in the session notes if
// the set ever grows. ----
const GLYPH_SPACE_SRC = 40; // source px per staff space
const GLYPHS_PACKED = {
  clef: {
    w: 107,
    h: 281,
    originFromTop: 176,
    data:
      'AAAAAAAAAAAAgAAAAAAAAAAAAAAAAAPgAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAAAAAf' +
      '+AAAAAAAAAAAAAAAAD/8AAAAAAAAAAAAAAAAf/4AAAAAAAAAAAAAAAD//wAAAAAAAAAA' +
      'AAAAAf//gAAAAAAAAAAAAAAD//+AAAAAAAAAAAAAAAf//8AAAAAAAAAAAAAAD///4AAA' +
      'AAAAAAAAAAAP///gAAAAAAAAAAAAAB////AAAAAAAAAAAAAAP///8AAAAAAAAAAAAAA/' +
      '///4AAAAAAAAAAAAAH////gAAAAAAAAAAAAA/////AAAAAAAAAAAAAD////8AAAAAAAA' +
      'AAAAAf////wAAAAAAAAAAAAB/////gAAAAAAAAAAAAP////+AAAAAAAAAAAAA/////8A' +
      'AAAAAAAAAAAH/////wAAAAAAAAAAAAf/////AAAAAAAAAAAAD/////+AAAAAAAAAAAAP' +
      '//+D/4AAAAAAAAAAAA///AD/gAAAAAAAAAAAH//wAH+AAAAAAAAAAAAf/+AAP8AAAAAA' +
      'AAAAAB//wAAfwAAAAAAAAAAAP/+AAB/AAAAAAAAAAAA//wAAD8AAAAAAAAAAAD/+AAAP' +
      'wAAAAAAAAAAAP/4AAA/gAAAAAAAAAAB//AAAD+AAAAAAAAAAAH/4AAAH4AAAAAAAAAAA' +
      'f/gAAAfgAAAAAAAAAAB/8AAAB+AAAAAAAAAAAP/wAAAH4AAAAAAAAAAA/+AAAAfgAAAA' +
      'AAAAAAD/4AAAB+AAAAAAAAAAAP/AAAAH4AAAAAAAAAAA/8AAAA/wAAAAAAAAAAD/gAAA' +
      'D/AAAAAAAAAAAf+AAAAP8AAAAAAAAAAB/4AAAA/wAAAAAAAAAAH/AAAAD/AAAAAAAAAA' +
      'Af8AAAAf8AAAAAAAAAAB/wAAAB/wAAAAAAAAAAH/AAAAH+AAAAAAAAAAAf8AAAA/4AAA' +
      'AAAAAAAB/gAAAD/gAAAAAAAAAAH+AAAAf+AAAAAAAAAAAf4AAAB/4AAAAAAAAAAB/gAA' +
      'AH/gAAAAAAAAAAH+AAAA/+AAAAAAAAAAAf4AAAH/4AAAAAAAAAAB/AAAAf/AAAAAAAAA' +
      'AAH8AAAD/8AAAAAAAAAAAfwAAAP/wAAAAAAAAAAB/AAAB//AAAAAAAAAAAH8AAAP/8AA' +
      'AAAAAAAAAfwAAB//gAAAAAAAAAAB/AAAH/+AAAAAAAAAAAH8AAA//4AAAAAAAAAAAfwA' +
      'AH//gAAAAAAAAAAB/AAA//8AAAAAAAAAAAH8AAH//wAAAAAAAAAAAfwAA///AAAAAAAA' +
      'AAAB/AAD//4AAAAAAAAAAAH8AAf//gAAAAAAAAAAAfwAD//8AAAAAAAAAAAB/AAf//wA' +
      'AAAAAAAAAAH8AD///AAAAAAAAAAAAPwAf//4AAAAAAAAAAAA/AD///gAAAAAAAAAAAD+' +
      'A///8AAAAAAAAAAAAP4H///wAAAAAAAAAAAA/g///+AAAAAAAAAAAAD+H///4AAAAAAA' +
      'AAAAAP4////AAAAAAAAAAAAA/n///8AAAAAAAAAAAAB/////gAAAAAAAAAAAAH////8A' +
      'AAAAAAAAAAAAf////wAAAAAAAAAAAAB////+AAAAAAAAAAAAAH////wAAAAAAAAAAAAA' +
      '/////AAAAAAAAAAAAAH////4AAAAAAAAAAAAA/////AAAAAAAAAAAAAP////8AAAAAAA' +
      'AAAAAB/////gAAAAAAAAAAAAP////8AAAAAAAAAAAAB/////gAAAAAAAAAAAAP////8A' +
      'AAAAAAAAAAAB/////wAAAAAAAAAAAAf////+AAAAAAAAAAAAD/////wAAAAAAAAAAAAf' +
      '////+AAAAAAAAAAAAD/////wAAAAAAAAAAAAf////+AAAAAAAAAAAAD/////wAAAAAAA' +
      'AAAAAf////+AAAAAAAAAAAAD/////wAAAAAAAAAAAAf////+AAAAAAAAAAAAD/////wA' +
      'AAAAAAAAAAAf////+AAAAAAAAAAAAD/////wAAAAAAAAAAAAf/////AAAAAAAAAAAAD/' +
      '////8AAAAAAAAAAAAf/////wAAAAAAAAAAAD//////gAAAAAAAAAAAf////7+AAAAAAA' +
      'AAAAD/////P4AAAAAAAAAAAf////w/gAAAAAAAAAAB////+B+AAAAAAAAAAAP////wH4' +
      'AAAAAAAAAAB////+AfwAAAAAAAAAAP////gB/AAAAAAAAAAB////8AH8AAAAAAAAAAH/' +
      '///gAfwAAAAAAAAAA////8AA/AAAAAAAAAAH////gAD8AAAAAAAAAAf///8AAP4AAAAA' +
      'AAAAD////gAA/gAAAAAAAAAf///8AAD+AAAAAAAAAB////gAAP4AAAAAAAAAP///4AAA' +
      'fgAAAAAAAAB////AAAB+AAAAAAAAAH///4AAAH8AAAAAAAAA////gAAAfwAAAAAAAAD/' +
      '//8AAAB/AAAAAAAAAf///gAAAH8AAAAAAAAB///8AAAAPwAAAAAAAAP///gAAAA/gAAA' +
      'AAAAA///8AAAAD/AAAAAAAAH///gAAAAP//4AAAAAAf//8AAAAB///+AAAAAB///gAAA' +
      'A/////AAAAAP//+AAAAP/////AAAAA///wAAAD//////AAAAD//+AAAA///////AAAAf' +
      '//wAAAP//////+AAAB///AAAB///////+AAAH//4AAAP///////8AAA///AAAB//////' +
      '//4AAD//8AAAP////////wAAP//gAAB/////////gAA//+AAAP/////////AAH//wAAB' +
      '/////////+AAf//AAAP/////////8AB//4AAA//////////wAH//gAAH//////////gA' +
      'f/8AAA///////////AD//wAAD//////////8AP//AAAf//////////4A//4AAB//////' +
      '/////gD//gAAP/////j/////AP/+AAA////n+A////8A//wAAD///wP4Af///4D//AAA' +
      'f//8A/gAf///gP/8AAB///AD+AA///+A//wAAH//4AP4AA///8D//AAAf/+AAfwAB///' +
      'wP/4AAD//wAB/AAD///A//gAAP/+AAH8AAH//8D/+AAA//4AAfwAAP//4P/4AAD//AAB' +
      '/AAAf//g//gAAP/4AAH8AAA//+D/+AAA//gAAP4AAD//4H/4AAD/8AAA/gAAH//gf/gA' +
      'AP/wAAD+AAAf/+B/+AAA//AAAP4AAA//4H/4AAD/4AAA/gAAD//gf/gAAH/gAAD+AAAH' +
      '/+A/+AAAf+AAAH8AAAf/4D/4AAB/4AAAfwAAB//gP/gAAH/gAAB/AAAD/+A/+AAAf+AA' +
      'AH8AAAP/4B/4AAA/4AAAfwAAA//gH/wAAD/gAAB/AAAD/+Af/AAAP+AAAD+AAAP/4A/8' +
      'AAAf8AAAP4AAA//gD/wAAB/wAAA/gAAD/8AP/gAAD/gAAD+AAAP/wAf+AAAP+AAAP4AA' +
      'A//AB/4AAAf8AAA/gAAD/8AD/wAAA/wAAB/AAAP/gAP/AAAD/gAAH8AAA/+AAf+AAAH/' +
      'AAAfwAAH/wAB/4AAAP+AAB/AAAf/AAD/wAAAf8AAH8AAB/8AAH/gAAA/4AAf4AAP/gAA' +
      'f+AAAB/4AA/gAA/+AAA/8AAAB/4AD+AAH/wAAB/4AAAD/wAP4AAf+AAAD/wAAAB/gA/g' +
      'AD/4AAAH/gAAAB8AD+AAP/AAAAf/AAAAAAAH8AB/4AAAA/+AAAAAAAfwAP/gAAAB/8AA' +
      'AAAAB/AB/8AAAAD/4AAAAAAH8AP/gAAAAH/4AAAAAAfwB/8AAAAAH/wAAAAAB/Af/gAA' +
      'AAAP/wAAAAAD+D/8AAAAAAf/wAAAAAP4//AAAAAAAf/wAAAAA/v/4AAAAAAA//4AAAAD' +
      '///AAAAAAAA//8AAAAP//wAAAAAAAA///gAAB//8AAAAAAAAA////AH///gAAAAAAAAA' +
      '////////wAAAAAAAAAAf//////8AAAAAAAAAAAP//////AAAAAAAAAAAAD/////8AAAA' +
      'AAAAAAAAAf//+f4AAAAAAAAAAAAAAAAA/gAAAAAAAAAAAAAAAAD+AAAAAAAAAAAAAAAA' +
      'AP4AAAAAAAAAAAAAAAAA/gAAAAAAAAAAAAAAAAD+AAAAAAAAAAAAAAAAAP8AAAAAAAAA' +
      'AAAAAAAAfwAAAAAAAAAAAAAAAAB/AAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAAAAAfwAA' +
      'AAAAAAAAAAAAAAB/AAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAAAAAP4AAAAAAAAAAAAAA' +
      'AAA/gAAAAAAAAAAAAAAAAD+AAAAAAAAAAAAAAAAAP4AAAAAAAAAAAAAAAAA/gAAAAAAA' +
      'AAAAAAAAAD/AAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAAAAAfwAAAAAAAAAAAAAAAAB/A' +
      'AAAAAAAAAH/gAAAAH8AAAAAAAAAB//gAAAAfwAAAAAAAAAf//gAAAB/AAAAAAAAAD///' +
      'AAAAH+AAAAAAAAAf//+AAAAf4AAAAAAAAH///8AAAA/gAAAAAAAAf///4AAAD+AAAAAA' +
      'AAD////wAAAP4AAAAAAAAf////AAAA/gAAAAAAAB////8AAAD+AAAAAAAAH////4AAAP' +
      '4AAAAAAAA/////gAAA/gAAAAAAAD////+AAAD+AAAAAAAAP////4AAAP4AAAAAAAB///' +
      '//wAAA/gAAAAAAAH/////AAAD+AAAAAAAAf////8AAAP4AAAAAAAB/////wAAA/gAAAA' +
      'AAAH/////AAAH+AAAAAAAAf////4AAAfwAAAAAAAB/////gAAB/AAAAAAAAH////+AAA' +
      'H8AAAAAAAAf////4AAAfwAAAAAAAA/////AAAD/AAAAAAAAD////8AAAP4AAAAAAAAP/' +
      '///gAAA/gAAAAAAAA////8AAAH+AAAAAAAAB////gAAAfwAAAAAAAAH///8AAAD/AAAA' +
      'AAAAAP///gAAAf4AAAAAAAAA///4AAAB/gAAAAAAAAB//8AAAAP8AAAAAAAAAH/+AAAA' +
      'B/gAAAAAAAAAP/wAAAAP+AAAAAAAAAAf/AAAAD/wAAAAAAAAAA/+AAAAf+AAAAAAAAAA' +
      'B/8AAAP/wAAAAAAAAAAD/8AAH/+AAAAAAAAAAAH//wP//gAAAAAAAAAAAP/////8AAAA' +
      'AAAAAAAAP/////AAAAAAAAAAAAAP////wAAAAAAAAAAAAAH///4AAAAAAAAAAAAAAB//' +
      '4AAAAAAAAA==',
  },
  sharp: {
    w: 40,
    h: 112,
    originFromTop: 56,
    data:
      'AAAADgAAAAAfAAAAAB8AAAAAHwAAAAAfAAAAAB8AAAAAHwAAcAAfAAD4AB8AAPgAHwAA' +
      '+AAfAAD4AB8AAPgAHwAA+AAfAAD4AB8AAPgAHwAA+AAfAAD4AB8AAPgAHwAA+AAfAAD4' +
      'AB8AAPgAHwAA+AAfDwD4AB//APgAP/8A+AA//wD4AH//APgA//8A+AP//wD4D///APx/' +
      '//8A/////wD/////Af////8D/////w//////P/////5/////+P/////A/////4D/////' +
      'AP////8A/////wD///gfAP//wB8A//8AHwD//gAfAP/8AB8A//gAHwD/+AAfAPn4AB8A' +
      'wPgAHwAA+AAfAAD4AB8AAPgAHwAA8AAfAADwAB8AAPAAHwAA8AAfAADwAB8CAPAAH58A' +
      '8AAf/wDwAB//APAAH/8A8AA//wD4AH//APgA//8A+AP//wD4D///APz///8A/////wH/' +
      '////A/////8f/////n/////8//////D/////wP////8A/////wD/////AP///j8A///4' +
      'PwD//+AfAP//AB8A//wAHwD/+AAfAP/4AB8A//gAHwDx+AAfAAD4AB8AAPgAHwAA+AAf' +
      'AAD4AB8AAPgAHwAA+AAfAAD4AB8AAPgAHwAA+AAfAAD4AB8AAPgAHwAA+AAfAAD4AB8A' +
      'APgAHwAA+AAeAAD4AAwAAPgAAAAA+AAAAAD4AAAAAPgAAAAA+AAAAAD4AAAAAGAAAAA=',
  },
  flat: {
    w: 36,
    h: 98,
    originFromTop: 70,
    data:
      'PgAAAAB/AAAAAP8AAAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/' +
      'AAAAAP8AAAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/AAAAAP8A' +
      'AAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/AAAAAP8AAAAA/wAAAAD/AAAAAP4AAAAA/gAA' +
      'AAD+AAAAAP4AAAAA/gAAAAD+AAAAAP4AAAAA/gAAAAD+AAAAAP4AAAAA/gAAAAD+AAAA' +
      'AP4AAAAA/gAAAAD+AAAAAP4AAAAA/gAAAAD+AH/AAP4D//AA/gf//AD/H//+AP////8A' +
      '/////4D/////wP/////A//8H/+D//AP/4P/wAf/w/+AA//D/wAD/8P+AAH/wfwAAf/B/' +
      'AAB/8H4AAH/wfgAAf/B+AAB/8H4AAH/wfgAAf+B+AAD/4H4AAP/AfgAA/8B+AAH/wH4A' +
      'Af+AfgAD/wB+AAP/AH4AB/4AfgAH/AB+AA/8AH4AH/gAfgA/8AB+AH/gAH8A/8AAfwH/' +
      'gAB/A/8AAH8H/gAAfx/8AAB///AAAH//4AAAf//AAAB//wAAAH/+AAAAf/wAAAB/8AAA' +
      'AH/gAAAAf8AAAAB/gAAAAD8AAAAAPAAAAAA4AAAAAA==',
  },
  natural: {
    w: 27,
    h: 108,
    originFromTop: 54,
    data:
      '/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAA/AAA' +
      'APwAAAD8AAAA/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAA/AAA4PwA' +
      'B+D8AD/g/AH/4Pwf/+D////g////4P///+D////g////4P///+D////g////4P///+D/' +
      '///g////4P///+D//+/g//wH4P/wB+D/wAfg/wAH4P4AB+D8AAfg/AAH4PwAB+D8AAfg' +
      '/AAH4PwAB+D8AAfg/AAH4PwAB+D8AAfg/AAH4PwAB+D8AAfg/AAP4PwAH+D8AH/g/AH/' +
      '4PwP/+D////g////4P///+D////g////4P///+D////g////4P///+D////g////4P//' +
      '/+D////g////4P///+D//g/g/+AH4P8AB+D8AAfg4AAH4AAAB+AAAAfgAAAH4AAAB+AA' +
      'AAfgAAAH4AAAB+AAAAfgAAAH4AAAB+AAAAfgAAAH4AAAB+AAAAfgAAAH4AAAB+AAAAfg' +
      'AAAH4AAAB+AAAAfgAAAH4AAAB+AAAAOA',
  },
  breath: {
    w: 24,
    h: 40,
    originFromTop: 40,
    data:
      'Af8AB//AD//wH//4P//8f//8f//+///+////////////////////f///f///P///H///' +
      'D///A///AA//AAf/AAf+AAP+AAP+AAP8AAP8AAf4AAf4AA/wAA/wAB/gAD/AAH+AAP8A' +
      'Af4AA/gAD/AAH8AAH4AADAAA',
  },
};

// tiny env-agnostic base64 decoder (no Buffer, no atob — this module
// runs in the browser and in Node)
function b64decode(str) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = {};
  for (let i = 0; i < 64; i++) lut[chars[i]] = i;
  const clean = str.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (lut[clean[i]] << 18) |
      (lut[clean[i + 1]] << 12) |
      ((lut[clean[i + 2]] || 0) << 6) |
      (lut[clean[i + 3]] || 0);
    out[o++] = (n >> 16) & 0xff;
    if (clean[i + 2] !== undefined) out[o++] = (n >> 8) & 0xff;
    if (clean[i + 3] !== undefined) out[o++] = n & 0xff;
  }
  return out;
}

const GLYPHS = {};
for (const name of Object.keys(GLYPHS_PACKED)) {
  const g = GLYPHS_PACKED[name];
  GLYPHS[name] = {
    w: g.w,
    h: g.h,
    originFromTop: g.originFromTop,
    stride: Math.ceil(g.w / 8),
    bytes: b64decode(g.data),
  };
}
const glyphBit = (g, x, y) =>
  (g.bytes[y * g.stride + (x >> 3)] >> (7 - (x & 7))) & 1;

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
  noteDots: 16, // note bar thickness (dots) — most of a space, not all
  glyphScale: 2, // glyph size multiplier; 2 = engraving-normal
  staffCenter: 288, // dot x of the middle staff line (B4)
  breathGapMs: 350, // a rest at least this long prints a breath mark
  gapRows: 8, // blank rows between consecutive notes
  breathRows: 10, // extra blank rows on each side of a breath mark
  ledgerPadRows: 4, // ledger lines poke this far past the note (each side)
  startBlankRows: 24, // bare paper before the staff begins
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

  // Rows that carry only the staff plus a note's ledger lines — used to
  // poke ledgers a little past the note itself on both sides in time,
  // like engraved ledger lines extending past a notehead. (Ledgers do
  // not run through the accidental; they hug the note only.)
  function emitPad(ledgers, n) {
    for (let i = 0; i < n; i++) {
      const row = blankRow();
      for (const s of ledgers) setLine(row, s);
      rows.push(row);
    }
  }

  // Blit an engraved glyph anchored on a staff step: the glyph's origin
  // line (the note line it attaches to, per the font's baseline) lands
  // exactly on the step's x. Scaled from the 40px-per-space source by
  // box-coverage sampling so the curves survive the resize; glyphs track
  // staffGap automatically (engraving proportions), with the Glyph size
  // slider as a multiplier on top (2 = normal). Each glyph column is one
  // tape row.
  function emitGlyph(name, step) {
    const g = GLYPHS[name];
    const s = (cfg.staffGap * (cfg.glyphScale / 2)) / GLYPH_SPACE_SRC;
    const tw = Math.max(1, Math.round(g.w * s));
    const th = Math.max(1, Math.round(g.h * s));
    const xTop = xOfStep(step) + Math.round(g.originFromTop * s);
    for (let gx = 0; gx < tw; gx++) {
      const row = blankRow();
      const sx0 = Math.floor((gx * g.w) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((gx + 1) * g.w) / tw));
      for (let gy = 0; gy < th; gy++) {
        const sy0 = Math.floor((gy * g.h) / th);
        const sy1 = Math.max(sy0 + 1, Math.floor(((gy + 1) * g.h) / th));
        let ink = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          for (let sx = sx0; sx < sx1; sx++) ink += glyphBit(g, sx, sy);
        }
        if (ink / ((sx1 - sx0) * (sy1 - sy0)) >= 0.38) {
          setDots(row, xTop - gy, 1);
        }
      }
      rows.push(row);
    }
  }

  function emitKeySignature() {
    const n = Math.abs(cfg.keySig);
    const steps = cfg.keySig > 0 ? SIG_STEPS_SHARP : SIG_STEPS_FLAT;
    const glyph = cfg.keySig > 0 ? 'sharp' : 'flat';
    for (let i = 0; i < n; i++) {
      emitGlyph(glyph, steps[i]);
      emitBlank(3);
    }
  }

  // Rows of bare paper — no staff — for the lead-in before the staff
  // begins, like the margin before a printed system.
  function emitEmpty(n) {
    for (let i = 0; i < n; i++) rows.push(new Uint8Array(WIDTH_BYTES));
  }

  function start() {
    started = true;
    emitEmpty(cfg.startBlankRows);
    emitBlank(4);
    emitGlyph('clef', 2); // the G clef winds around the G4 line
    emitBlank(6);
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
        emitGlyph('breath', 10); // above the staff, like on paper
        emitBlank(cfg.breathRows);
      } else {
        emitBlank(cfg.gapRows);
      }
    }
    const sp = spellNote(midi, cfg.keySig);
    const led = ledgerSteps(sp.step);
    cur = { midi, step: sp.step, onMs: tMs, rowsEmitted: 0 };
    if (sp.glyph) {
      emitGlyph(sp.glyph, sp.step);
      emitBlank(3);
    }
    if (led.length) emitPad(led, cfg.ledgerPadRows);
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
    const led = ledgerSteps(cur.step);
    if (led.length) emitPad(led, cfg.ledgerPadRows);
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
