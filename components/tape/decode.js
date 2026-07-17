// components/tape/decode.js — the neural transcription wrapper:
// recording in, raw note events out (t0/t1/midi/amp/bends/onset). Basic
// Pitch (Apache-2.0, model bundled in public/basic-pitch/) transcribes
// polyphonically — melody AND dam as separate note tracks — and the take
// document (doc.mjs) reduces that to the tape. tfjs is lazy-loaded on
// first use and the model instance is cached at module level, so it
// survives React remounts and later takes skip the load.
//
// Backend canary: some mobile GPUs miscompute the net in WebGL while
// advertising full float32 support (observed on a phone: garbage on
// webgl with WEBGL_RENDER_FLOAT32_CAPABLE=true, correct on cpu). No
// capability flag detects it, so the first transcription tests the truth
// directly — half a second of synthetic A4 must transcribe as A4 — and
// on failure switches to the WASM kernels in public/tf-wasm/. There is
// deliberately no rung below wasm: it computes in plain IEEE floats, so
// a wasm failure means something on our side broke and should surface.
// All of this is invisible to the user; the canary numbers and the
// chosen backend go to the console only.

import { normalizeLoudness } from '../../scripts/tape-eval/normalize.mjs';
import { onsetAt } from '../../scripts/tape-eval/ornaments.mjs';
import {
  estimateTuningCents,
  resampleSinc,
  retuneRatio,
  shouldRetune,
} from '../../scripts/tape-eval/tuning.mjs';

let neural = null; // cached { bp, ...bpModule } after first use
let backendPromise = null; // resolves to the canary-approved backend name

const CANARY_SR = 22050; // the model's native rate
const A4_BIN = 69 - 21; // frame bins start at A0 (MIDI 21)

function freshModel() {
  neural.bp = new neural.BasicPitch('/basic-pitch/model.json');
}

// half a second of A4 sine at the demo phrase's level, 20 ms fades
function canaryTone() {
  const n = Math.round(0.5 * CANARY_SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(
      1,
      i / (0.02 * CANARY_SR),
      (n - i) / (0.02 * CANARY_SR),
    );
    out[i] = env * 0.25 * Math.sin((2 * Math.PI * 440 * i) / CANARY_SR);
  }
  return out;
}

// run the real model over the tone and require the mean frame activation
// to peak at A4 with real confidence — a lying GPU lands anywhere else
// (or nowhere), a healthy backend passes with lots of margin
async function canaryPasses() {
  const frames = [];
  await neural.bp.evaluateModel(
    canaryTone(),
    (f) => {
      frames.push(...f);
    },
    () => {},
  );
  if (!frames.length) return false;
  const bins = frames[0].length;
  const mean = new Float32Array(bins);
  for (const fr of frames) {
    for (let b = 0; b < bins; b++) mean[b] += fr[b] / frames.length;
  }
  let best = 0;
  for (let b = 1; b < bins; b++) if (mean[b] > mean[best]) best = b;
  console.log(
    `tape decode canary: peak bin ${best} (want ${A4_BIN}) mean ${mean[best].toFixed(3)}`,
  );
  return best === A4_BIN && mean[best] > 0.15;
}

async function loadWasm(tf) {
  const wasm = await import('@tensorflow/tfjs-backend-wasm');
  wasm.setWasmPaths('/tf-wasm/');
  // tfjs 3.21's wasm Fill kernel crashes on the dtype-less fill() that
  // tf.signal.frame emits while padding (Basic Pitch's prepareData);
  // the cpu and webgl kernels default it to float32 — mirror that.
  // Verified: with this shim, wasm note events match cpu exactly.
  const fill = tf.getKernel('Fill', 'wasm');
  if (fill) {
    tf.unregisterKernel('Fill', 'wasm');
    tf.registerKernel({
      kernelName: 'Fill',
      backendName: 'wasm',
      ...(fill.setupFunc ? { setupFunc: fill.setupFunc } : {}),
      kernelFunc: ({ attrs, ...rest }) =>
        fill.kernelFunc({
          ...rest,
          attrs: { ...attrs, dtype: attrs.dtype ?? 'float32' },
        }),
    });
  }
  return tf.setBackend('wasm');
}

async function pickBackend() {
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();
  // only webgl is suspect; wasm and cpu compute in honest IEEE floats
  if (tf.getBackend() !== 'webgl') return tf.getBackend();
  if (await canaryPasses()) return 'webgl';
  console.warn('tape decode: webgl fails the canary on this device');
  // no rung below wasm: it computes in plain IEEE floats, so if it fails
  // something is broken on our side (missing /tf-wasm asset, a stale
  // Fill shim after a tfjs bump) and the error should surface, not be
  // papered over by a minutes-long cpu transcription
  if (!(await loadWasm(tf))) {
    throw new Error('the WASM transcription engine failed to start');
  }
  await tf.ready();
  freshModel(); // weights must load on the new backend
  if (!(await canaryPasses())) {
    throw new Error('the WASM transcription engine fails the canary');
  }
  return 'wasm';
}

async function resampleTo22050(f32, srcRate) {
  if (Math.round(srcRate) === 22050) return f32;
  const oac = new OfflineAudioContext(
    1,
    Math.ceil((f32.length * 22050) / srcRate),
    22050,
  );
  const buf = oac.createBuffer(1, f32.length, srcRate);
  buf.copyToChannel(f32, 0);
  const src = oac.createBufferSource();
  src.buffer = buf;
  src.connect(oac.destination);
  src.start();
  return (await oac.startRendering()).getChannelData(0);
}

// onStatus receives human-readable progress lines for the status area.
export async function transcribe({ samples, sampleRate, onStatus }) {
  if (!neural) {
    onStatus?.('loading the transcriber…');
    const bpModule = await import('@spotify/basic-pitch');
    neural = { ...bpModule };
    freshModel();
  }
  if (!backendPromise) {
    backendPromise = pickBackend().then((b) => {
      console.log(`tape decode backend: ${b}`);
      return b;
    });
    // a failed pick (e.g. a flaky .wasm fetch) retries on the next take
    // instead of caching the rejection forever
    backendPromise.catch(() => {
      backendPromise = null;
    });
  }
  await backendPromise;
  let audio = await resampleTo22050(samples, sampleRate);
  // tuning-normalize: Basic Pitch's semitone grid is frozen at A440, so
  // a take played off the grid (a quarter tone is the worst case) is
  // moved ONTO the grid by a compensating resample before the model.
  // Note times scale back afterwards (timeScale), so the tape, playback,
  // and the raw-pitch trace stay aligned to the original audio. Shared
  // math with the eval harness: scripts/tape-eval/tuning.mjs.
  onStatus?.('checking the tuning…');
  const tune = estimateTuningCents(audio, 22050);
  let timeScale = 1;
  let tuningCents = 0;
  const acting = shouldRetune(tune);
  console.log(
    `tape decode tuning: ${tune.cents.toFixed(1)} cents (confidence ${tune.confidence.toFixed(2)}, ${tune.voiced} windows) — ${acting ? 'compensating' : 'holding off'}`,
  );
  if (acting) {
    tuningCents = tune.cents;
    const label = `${Math.round(Math.abs(tune.cents))} cents ${tune.cents < 0 ? 'flat' : 'sharp'}`;
    onStatus?.(`played ${label} — compensating…`);
    timeScale = retuneRatio(tune.cents);
    audio = resampleSinc(audio, timeScale);
  }
  // loudness-normalize to the corpus calibration level: the whole
  // evidence chain is amplitude-shaped, and this makes mic gain and
  // clip level irrelevant to the transcription. Playback and the
  // raw-pitch trace keep the original audio
  audio = normalizeLoudness(audio);
  const frames = [];
  const onsets = [];
  const contours = [];
  await neural.bp.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (pct) => {
      onStatus?.(`transcribing… ${Math.round(pct * 100)}%`);
    },
  );
  const frameEvents = neural.addPitchBendsToNoteEvents(
    contours,
    neural.outputToNotesPoly(frames, onsets, 0.4, 0.3, 5),
  );
  const events = neural.noteFramesToTime(frameEvents);
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
  // tuningCents rides with the notes: every later derivation must shift
  // its fine-cents frames onto the same grid (retuneFrames)
  return { notes, tuningCents };
}
