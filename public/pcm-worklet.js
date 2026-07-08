// public/pcm-worklet.js — AudioWorklet processor for the Tape tool: it
// does nothing but forward the mic's mono PCM to the main thread, one
// 128-frame block at a time (copied, because the engine accumulates them
// into analysis windows). All real work — decimation, windowing, pitch
// detection — happens in the engine and public/pitch-worker.js, where it
// is tunable without touching the audio thread.

class PcmForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-forwarder', PcmForwarder);
