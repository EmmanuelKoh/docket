// scripts/tape-eval/score.mjs — the Tape corpus scorer. For every
// data/clips/*.truth.json, transcribe the matching wav, run the
// skeleton pass, and score the note+rest sequence against the truth by
// global alignment (Needleman-Wunsch): precision/recall/F over aligned
// symbols. Robustness is this number, not a vibe.
//
//   npm run tape:eval          (all fixtures)
//   node scripts/tape-eval/score.mjs data/clips/take2.truth.json
//
// Truth format: { "provisional": bool, "sequence": ["E4", "F#4:long",
// "REST", ...] } — ":long" asserts duration >= 0.8s; graces/ornaments
// are pass-2 and do not belong in skeleton truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribeWithMeta } from './transcribe.mjs';
import { TUNING_VERSION, retuneFrames } from './tuning.mjs';
import { skeletonize, skeletonSequence } from './skeleton.mjs';
import { decorate } from './ornaments.mjs';
import { annotate } from './marks.mjs';
import { fineFramesFor } from './fine.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIPS = path.join(ROOT, 'data', 'clips');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LONG_SEC = 0.8;

const label = (n) =>
  n.rest ? 'REST' : `${NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1}${n.t1 - n.t0 >= LONG_SEC ? ':long' : ''}`;

// symbols match when pitch+rest agree; the :long assertion must hold
// when the truth states it
function symMatch(truth, pred) {
  const tBase = truth.replace(':long', '');
  const pBase = pred.replace(':long', '');
  if (tBase !== pBase) return false;
  if (truth.endsWith(':long') && !pred.endsWith(':long')) return false;
  return true;
}

function align(truth, pred) {
  const T = truth.length;
  const P = pred.length;
  const dp = Array.from({ length: T + 1 }, () => new Array(P + 1).fill(0));
  for (let i = 1; i <= T; i++) {
    for (let j = 1; j <= P; j++) {
      dp[i][j] = Math.max(
        dp[i - 1][j],
        dp[i][j - 1],
        dp[i - 1][j - 1] + (symMatch(truth[i - 1], pred[j - 1]) ? 1 : 0),
      );
    }
  }
  // traceback for the diff view
  const rows = [];
  let i = T;
  let j = P;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (symMatch(truth[i - 1], pred[j - 1]) ? 1 : 0) && symMatch(truth[i - 1], pred[j - 1])) {
      rows.unshift(['  ', truth[--i], pred[--j]]);
    } else if (j > 0 && dp[i][j] === dp[i][j - 1]) {
      rows.unshift(['+ ', '', pred[--j]]);
    } else {
      rows.unshift(['- ', truth[--i], '']);
    }
  }
  return { matches: dp[T][P], rows };
}

async function scoreFixture(truthPath) {
  const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  const wav = truthPath.replace(/\.truth\.json$/, '.wav');
  // A/B hooks: TAPE_GAIN=0.5 perturbs the input level BEFORE loudness
  // normalization (scores must not move — the brittleness regression
  // check); TAPE_DETUNE=-50 shifts the input off the semitone grid in
  // cents BEFORE tuning normalization (same rule: scores must not
  // move); TAPE_RETUNE=0 disables the tuning stage for A/B;
  // TAPE_DEREVERB=1 (+ TAPE_RT60 / TAPE_DRSTRENGTH) A/Bs the
  // corpus-vetoed dereverb stage
  const { notes, tuningCents } = await transcribeWithMeta(wav, {
    ...(process.env.TAPE_GAIN ? { gain: parseFloat(process.env.TAPE_GAIN) } : {}),
    ...(process.env.TAPE_DETUNE
      ? { detune: parseFloat(process.env.TAPE_DETUNE) }
      : {}),
    // always explicit: both are part of the transcription cache key
    // (tuningV busts cached results when tuning.mjs behavior changes)
    retune: process.env.TAPE_RETUNE !== '0',
    tuningV: TUNING_VERSION,
    ...(process.env.TAPE_TARGET
      ? { targetRms: parseFloat(process.env.TAPE_TARGET) }
      : {}),
    deReverb: process.env.TAPE_DEREVERB === '1',
    ...(process.env.TAPE_RT60 ? { rt60: parseFloat(process.env.TAPE_RT60) } : {}),
    ...(process.env.TAPE_DRSTRENGTH
      ? { strength: parseFloat(process.env.TAPE_DRSTRENGTH) }
      : {}),
  });
  // pass 1 + pass 2's rearticulation splits + pass 3's fine-trace
  // re-strike splits — double-struck main notes are part of the scored
  // melody, however they were detected
  // a truth file may pin the Melody floor it was validated at (Hz,
  // matching the browser slider); default matches the slider default
  const floorHz = truth.melodyFloorHz ?? 230;
  const opts = {
    melodyLoMidi: Math.round(69 + 12 * Math.log2(floorHz / 440)),
  };
  const decorated = decorate(notes, skeletonize(notes, opts), opts);
  // the fine frames come from the original audio; the notes live on the
  // retuned grid — shift the frames to match (see tuning.mjs). Under
  // TAPE_DETUNE the simulated flat player's fine detector would read
  // flat too, so the frames take the detune first.
  let fine = await fineFramesFor(wav, { floor: floorHz });
  const detuneCents = process.env.TAPE_DETUNE
    ? parseFloat(process.env.TAPE_DETUNE)
    : 0;
  if (detuneCents) fine = retuneFrames(fine, -detuneCents);
  fine = retuneFrames(fine, tuningCents);
  const timeline = annotate(notes, decorated, opts, fine);
  const pred = skeletonSequence(timeline.filter((e) => !e.mark)).map(label);
  const { matches, rows } = align(truth.sequence, pred);
  const precision = pred.length ? matches / pred.length : 0;
  const recall = truth.sequence.length ? matches / truth.sequence.length : 0;
  const f = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { name: path.basename(wav), truth, pred, precision, recall, f, rows };
}

const targets = process.argv[2]
  ? [process.argv[2]]
  : fs
      .readdirSync(CLIPS)
      .filter((f) => f.endsWith('.truth.json'))
      .map((f) => path.join(CLIPS, f));

let sumF = 0;
for (const t of targets) {
  const r = await scoreFixture(t);
  sumF += r.f;
  console.log(
    `\n${r.name}${r.truth.provisional ? ' (provisional truth)' : ''}: ` +
      `P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)} F=${r.f.toFixed(2)}`,
  );
  for (const [tag, tr, pr] of r.rows) {
    console.log(`  ${tag}${(tr || '·').padEnd(10)} ${pr || '·'}`);
  }
}
console.log(`\nmean F over ${targets.length} fixture(s): ${(sumF / targets.length).toFixed(2)}`);
process.exit(sumF / targets.length >= 0.75 ? 0 : 1);
