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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
          holdF0: 0,
        },
      });
    });
    frames.push({ t: m.t, freq: m.freq, clarity: m.clarity, energy: m.energy });
  }
  return frames;
}
