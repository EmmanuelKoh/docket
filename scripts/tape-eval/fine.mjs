// scripts/tape-eval/fine.mjs — Node-side runner for the v1 pitch
// detector (public/pitch-worker.js, vm-sandboxed): the fine-cents
// pitch trace. The v1 detector resolves continuous cents at ~12 ms
// hops, so it sees brief ornament excursions that sit entirely below
// the neural model's note/contour floor. The browser gets the same
// frames for free from the trace backfill; this wrapper gives the eval
// harness parity. Runs on the ORIGINAL (un-normalized) audio, exactly
// like the browser trace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createNoteTracker } from '../../components/tape-events.js';
import { highpass130 } from './normalize.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// the browser trace backfill's fixed tracker settings (tape-engine.js
// trackerValues) — the tracker only supplies holdF0, the hold mask that
// stops the detector's background from eating a held note. Keep in sync
// or Node and browser frames diverge.
const TRACKER = {
  clarityMin: 0.5,
  tuningCents: 0,
  onsetHoldMs: 50,
  retrigCents: 60,
  changeHoldMs: 80,
  changeFastMs: 30,
  ornamentCents: 45,
  restFrac: 0.18,
  offMs: 110,
};

// 16-bit mono PCM wav -> { audio: Float32Array, sr } at NATIVE rate,
// un-normalized — the fine trace analyzes what the mic captured
export function loadWavRaw(wavPath) {
  const wav = fs.readFileSync(wavPath);
  const sr = wav.readUInt32LE(24);
  const n = (wav.length - 44) / 2;
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) audio[i] = wav.readInt16LE(44 + i * 2) / 32768;
  return { audio, sr };
}

// cached wrapper for whole files (the common harness path): the v1
// analysis is deterministic per (file, floor)
export async function fineFramesFor(wavPath, opts = {}) {
  const { cached } = await import('./transcribe.mjs');
  return cached('fine', wavPath, opts, () => {
    const { audio, sr } = loadWavRaw(wavPath);
    // browser parity: the engine's recording buffer is high-passed
    return fineFrames(highpass130(audio, sr), sr, opts);
  });
}

// audio: Float32Array at sr -> [{ t (ms), freq, clarity }]
export async function fineFrames(audio, sr, { floor = 230 } = {}) {
  const src = fs.readFileSync(
    path.join(ROOT, 'public', 'pitch-worker.js'),
    'utf8',
  );
  let resolveMsg = null;
  const sandbox = {
    postMessage: (m) => resolveMsg(m),
    onmessage: null,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const WINDOW = 1024;
  const HOP = 256;
  const frames = [];
  // mirror the browser backfill: a throwaway tracker rides along purely
  // to supply holdF0 (the tracked note's frequency), so the detector's
  // background never learns a held note
  const trk = createNoteTracker(TRACKER);
  const holdF0 = () =>
    trk.sounding === null ? 0 : 440 * 2 ** ((trk.sounding - 69) / 12);
  for (let start = 0; start + WINDOW <= audio.length; start += HOP) {
    const win = new Float32Array(WINDOW);
    win.set(audio.subarray(start, start + WINDOW));
    const m = await new Promise((resolve) => {
      resolveMsg = resolve;
      sandbox.onmessage({
        data: {
          buf: win.buffer,
          sr,
          t: ((start + WINDOW) / sr) * 1000,
          mode: 'harm',
          fMin: floor,
          gen: 1,
          holdF0: holdF0(),
        },
      });
    });
    trk.push({ tMs: m.t, freq: m.freq, clarity: m.clarity, energy: m.energy });
    frames.push({ t: m.t, freq: m.freq, clarity: m.clarity, energy: m.energy });
  }
  return frames;
}
