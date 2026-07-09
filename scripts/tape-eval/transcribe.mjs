// scripts/tape-eval/transcribe.mjs — wav file -> Basic Pitch note
// events (Node side of the Tape v2 pipeline; the browser will run the
// same model via tfjs-webgl). Exports transcribe(); also a CLI:
//   node scripts/tape-eval/transcribe.mjs <wav>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { onsetAt } from './ornaments.mjs';

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
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = wav.readInt16LE(44 + i * 2) / 32768;
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

// wav -> [{ t0, t1, midi, amp, bends, onset }] (seconds, sorted)
export async function transcribe(
  wavPath,
  { onsetThresh = 0.4, frameThresh = 0.3, minNoteLenFrames = 5 } = {},
) {
  const { audio } = loadWav22k(wavPath);
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
  return events
    .map((e, i) => ({
      t0: e.startTimeSeconds,
      t1: e.startTimeSeconds + e.durationSeconds,
      midi: e.pitchMidi,
      amp: e.amplitude,
      bends: e.pitchBends ?? [],
      onset: onsetAt(onsets, frameEvents[i].startFrame, e.pitchMidi),
    }))
    .sort((a, b) => a.t0 - b.t0);
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
