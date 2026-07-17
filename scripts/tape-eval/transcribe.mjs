// scripts/tape-eval/transcribe.mjs — wav file -> Basic Pitch note
// events (Node side of the Tape v2 pipeline; the browser will run the
// same model via tfjs-webgl). Exports transcribe(); also a CLI:
//   node scripts/tape-eval/transcribe.mjs <wav>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dereverb } from './dereverb.mjs';
import { highpass130, normalizeLoudness } from './normalize.mjs';
import { onsetAt } from './ornaments.mjs';
import {
  estimateTuningCents,
  resampleSinc,
  retuneRatio,
  shouldRetune,
} from './tuning.mjs';

const require = createRequire(import.meta.url);
const tf = require('@tensorflow/tfjs');
const {
  BasicPitch,
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
} = require('@spotify/basic-pitch');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '@spotify',
  'basic-pitch',
  'model',
);

// plain tfjs in Node has no file:// loader — feed the artifacts from
// memory (the browser build loads the same files over HTTP instead)
const ioHandler = {
  load: async () => {
    const spec = JSON.parse(
      fs.readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf8'),
    );
    const weightSpecs = spec.weightsManifest.flatMap((g) => g.weights);
    const bins = spec.weightsManifest.flatMap((g) => g.paths);
    const buffers = bins.map((p) => fs.readFileSync(path.join(MODEL_DIR, p)));
    const weightData = new Uint8Array(
      buffers.reduce((n, b) => n + b.length, 0),
    );
    let o = 0;
    for (const b of buffers) {
      weightData.set(b, o);
      o += b.length;
    }
    return {
      modelTopology: spec.modelTopology,
      format: spec.format,
      generatedBy: spec.generatedBy,
      convertedBy: spec.convertedBy,
      weightSpecs,
      weightData: weightData.buffer,
    };
  },
};

// 16-bit mono PCM wav (what Save clip writes) -> Float32 at 22050
// (Basic Pitch's rate). Linear resampling is acceptable for the small
// 24000 -> 22050 step of our own clips; the browser path uses
// OfflineAudioContext for arbitrary inputs.
function loadWav22k(wavPath) {
  const wav = fs.readFileSync(wavPath);
  const srIn = wav.readUInt32LE(24);
  const n = (wav.length - 44) / 2;
  let raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = wav.readInt16LE(44 + i * 2) / 32768;
  // browser parity: everything the engine analyzes passed its 130 Hz
  // high-pass at record/load time
  raw = highpass130(raw, srIn);
  const SR = 22050;
  const outLen = Math.floor((n * SR) / srIn);
  const audio = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = (i * srIn) / SR;
    const j = Math.floor(x);
    const f = x - j;
    audio[i] = raw[j] * (1 - f) + (raw[Math.min(j + 1, n - 1)] || 0) * f;
  }
  return { audio, seconds: outLen / SR };
}

// disk cache: Basic Pitch inference is by far the slowest step of the
// harness and its output is deterministic per (file, options) — cache
// results under data/.tape-cache keyed by path+mtime+size+options
const CACHE_DIR = path.join(__dirname, '..', '..', 'data', '.tape-cache');
function cacheKey(kind, wavPath, opts) {
  const st = fs.statSync(wavPath);
  const raw = `${kind}:${wavPath}:${st.mtimeMs}:${st.size}:${JSON.stringify(opts)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return path.join(CACHE_DIR, `${kind}-${h.toString(16)}.json`);
}
export function cached(kind, wavPath, opts, compute) {
  const key = cacheKey(kind, wavPath, opts);
  try {
    return JSON.parse(fs.readFileSync(key, 'utf8'));
  } catch {
    /* miss */
  }
  const result = compute();
  const store = (r) => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(key, JSON.stringify(r));
    return r;
  };
  return result instanceof Promise ? result.then(store) : store(result);
}

// wav -> { notes: [{ t0, t1, midi, amp, bends, onset }], tuningCents }.
// tuningCents is the offset the tuning stage corrected (0 when it held
// off): everything downstream that compares continuous pitch against
// the notes (the fine-cents frames in pass 3) must shift onto the same
// grid, or its ±0.7-semitone tolerances misfire by the offset.
export async function transcribeWithMeta(wavPath, opts = {}) {
  return cached('bp', wavPath, opts, () => transcribeUncached(wavPath, opts));
}

// wav -> just the notes (CLI and older callers)
export async function transcribe(wavPath, opts = {}) {
  return (await transcribeWithMeta(wavPath, opts)).notes;
}

async function transcribeUncached(
  wavPath,
  {
    onsetThresh = 0.4,
    frameThresh = 0.3,
    minNoteLenFrames = 5,
    deReverb = false,
    gain = 1, // perturbation A/B hook: pre-normalization level change
    detune = 0, // perturbation A/B hook: shift the input off-grid (cents)
    retune = true, // the tuning-normalization stage (browser parity)
    ...preOpts // forwarded to normalizeLoudness and dereverb
  } = {},
) {
  let { audio } = loadWav22k(wavPath);
  if (gain !== 1) {
    audio = audio.map((x) => Math.max(-1, Math.min(1, x * gain)));
  }
  let timeScale = 1;
  if (detune) {
    // simulate an off-grid player; fold the stretch into the time map
    // so note times stay on the fixture's clock
    const dr = 2 ** (detune / 1200);
    audio = resampleSinc(audio, dr);
    timeScale *= dr;
  }
  // tuning-normalize before the model, exactly like the browser decode
  // (components/tape/decode.js): Basic Pitch's semitone grid is frozen
  // at A440; note times scale back to the original clock below
  let tuningCents = 0;
  if (retune) {
    const tune = estimateTuningCents(audio, 22050);
    if (shouldRetune(tune)) {
      tuningCents = tune.cents;
      const ratio = retuneRatio(tune.cents);
      timeScale *= ratio;
      audio = resampleSinc(audio, ratio);
    }
  }
  audio = normalizeLoudness(audio, preOpts);
  if (deReverb) audio = dereverb(audio, 22050, preOpts);
  const bp = new BasicPitch(tf.loadGraphModel(ioHandler));
  const frames = [];
  const onsets = [];
  const contours = [];
  await bp.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    () => {},
  );
  const frameEvents = addPitchBendsToNoteEvents(
    contours,
    outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLenFrames),
  );
  const events = noteFramesToTime(frameEvents);
  const notes = events
    .map((e, i) => ({
      t0: e.startTimeSeconds * timeScale,
      t1: (e.startTimeSeconds + e.durationSeconds) * timeScale,
      midi: e.pitchMidi,
      amp: e.amplitude,
      bends: e.pitchBends ?? [],
      onset: onsetAt(onsets, frameEvents[i].startFrame, e.pitchMidi),
    }))
    .sort((a, b) => a.t0 - b.t0);
  return { notes, tuningCents };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = await transcribe(process.argv[2]);
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (const n of notes) {
    console.log(
      `${n.t0.toFixed(2)}-${n.t1.toFixed(2)}s  ${NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1}  amp=${n.amp.toFixed(2)}`,
    );
  }
}
