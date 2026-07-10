// components/tape/audio-io.js — the Tape tool's recording side: mic
// capture through the PCM worklet, decimation to ~22 kHz, the record-time
// high-pass, the in-memory take buffer, and WAV save/load. No analysis,
// no rendering — audio in, samples out.
//
// The session is always recorded (decimated PCM in memory, ~10 min cap).

const REC_MAX_S = 600; // recording cap (10 min ≈ 53 MB of Float32)
const PAD = 4096; // slack past the sample count (analysis window room)

// ---- input high-pass (~130 Hz, RBJ biquad): kills room rumble and
// handling noise that erode detector clarity. The duduk's lowest note is
// A3 (220 Hz), so the music passes untouched. Applied at record time, so
// replays and saved clips carry the same signal — and the browser stays
// in parity with the eval harness (normalize.mjs applies the same
// filter to fixture WAVs). ----
const HP_HZ = 130;

export function createRecorder() {
  let effSr = 22050; // decimated sample rate (actual, from the device)
  let recorded = new Float32Array(1 << 20);
  let recLen = 0;

  let stream = null;
  let actx = null;
  let workletNode = null;
  let micOn = false;

  let hpB0 = 1;
  let hpB1 = 0;
  let hpB2 = 0;
  let hpA1 = 0;
  let hpA2 = 0;
  let hpX1 = 0;
  let hpX2 = 0;
  let hpY1 = 0;
  let hpY2 = 0;

  function setRate(sr) {
    effSr = sr;
    const w0 = (2 * Math.PI * HP_HZ) / sr;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const cosw = Math.cos(w0);
    const a0 = 1 + alpha;
    hpB0 = (1 + cosw) / 2 / a0;
    hpB1 = -(1 + cosw) / a0;
    hpB2 = (1 + cosw) / 2 / a0;
    hpA1 = (-2 * cosw) / a0;
    hpA2 = (1 - alpha) / a0;
    hpX1 = hpX2 = hpY1 = hpY2 = 0;
  }
  setRate(effSr);

  function highpass(x) {
    const y = hpB0 * x + hpB1 * hpX1 + hpB2 * hpX2 - hpA1 * hpY1 - hpA2 * hpY2;
    hpX2 = hpX1;
    hpX1 = x;
    hpY2 = hpY1;
    hpY1 = y;
    return y;
  }

  // Decimate a raw block by `factor` (boxcar average) through the
  // high-pass into the take buffer. Returns false when the cap is hit —
  // the caller decides what to do (the controller stops the mic).
  function append(block, factor) {
    const n = Math.floor(block.length / factor);
    if (recLen + n > recorded.length) {
      if (recLen + n > REC_MAX_S * effSr) return false;
      const bigger = new Float32Array(
        Math.min(REC_MAX_S * effSr, recorded.length * 2) + n,
      );
      bigger.set(recorded.subarray(0, recLen));
      recorded = bigger;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < factor; j++) s += block[i * factor + j];
      recorded[recLen++] = highpass(s / factor);
    }
    return true;
  }

  // ---- mic session. onBlock fires after each appended block (the
  // controller pumps analysis from it); onCap fires once if the
  // recording cap stops the take. Throws on permission/device failure —
  // the caller owns the status line. ----
  async function startMic({ onBlock, onCap }) {
    // music, not speech: the browser's voice DSP would eat the duduk
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    actx = new AudioContext();
    await actx.audioWorklet.addModule('/pcm-worklet.js');
    const factor = Math.max(1, Math.round(actx.sampleRate / 22050));
    setRate(actx.sampleRate / factor);
    const src = actx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(actx, 'pcm-forwarder');
    const mute = actx.createGain();
    mute.gain.value = 0; // pull the graph without hearing yourself
    src.connect(workletNode);
    workletNode.connect(mute);
    mute.connect(actx.destination);
    workletNode.port.onmessage = (ev) => {
      if (!micOn) return;
      if (!append(ev.data, factor)) {
        onCap?.();
        return;
      }
      onBlock?.();
    };
    micOn = true;
    return effSr;
  }

  function stopMic() {
    if (stream) {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      stream = null;
    }
    if (actx) {
      actx.close();
      actx = null;
    }
    workletNode = null;
    micOn = false;
  }

  // ---- load a clip file (WAV or anything the browser decodes) ----
  async function loadFile(file) {
    const dctx = new AudioContext();
    const decoded = await dctx.decodeAudioData(await file.arrayBuffer());
    dctx.close();
    const ch = decoded.getChannelData(0);
    const factor = Math.max(1, Math.round(decoded.sampleRate / 22050));
    setRate(decoded.sampleRate / factor);
    recorded = new Float32Array(Math.ceil(ch.length / factor) + PAD);
    recLen = 0;
    append(ch, factor);
  }

  // Adopt already-synthesized samples at the current rate (the demo
  // phrase) — no high-pass; synthetic audio has no rumble to kill.
  function loadRaw(f32) {
    recorded = new Float32Array(f32.length + PAD);
    recorded.set(f32);
    recLen = f32.length;
  }

  // ---- save the take as a 16-bit mono WAV blob ----
  function toWavBlob() {
    const sr = Math.round(effSr);
    const buf = new ArrayBuffer(44 + recLen * 2);
    const dv = new DataView(buf);
    const w = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, 'RIFF');
    dv.setUint32(4, 36 + recLen * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    w(36, 'data');
    dv.setUint32(40, recLen * 2, true);
    for (let i = 0; i < recLen; i++) {
      const s = Math.max(-1, Math.min(1, recorded[i]));
      dv.setInt16(44 + i * 2, s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  return {
    startMic,
    stopMic,
    loadFile,
    loadRaw,
    toWavBlob,
    reset() {
      recLen = 0;
    },
    samples: () => recorded.subarray(0, recLen),
    get length() {
      return recLen;
    },
    get sampleRate() {
      return effSr;
    },
    get seconds() {
      return recLen ? recLen / effSr : 0;
    },
    get micOn() {
      return micOn;
    },
  };
}

// ---- demo phrase: a synthetic duduk-ish take (vibrato, a committed
// bend, a retreating bend, a fast run, breaths, both ledger regions) so
// the whole pipeline can be exercised without an instrument ----
export function synthDemoPcm(effSr) {
  const segs = [
    // [midi from, midi to, ms]  (null = breath)
    [69, 69, 2200], // A4, vibrato arrives after the attack
    [69, 71, 150], // bend up to B4 — should commit as a new note
    [71, 71, 1100],
    [71, 71.7, 130], // retreating bend: up 70 cents…
    [71.7, 71, 130], // …and back — should NOT commit
    [71, 71, 600],
    [null, null, 500], // breath
    [72, 72, 140],
    [71, 71, 140],
    [69, 69, 140],
    [67, 67, 140], // fast run
    [64, 64, 1300], // E4
    [null, null, 650], // breath
    [57, 57, 1200], // A3 — ledger lines below
    [79, 79, 500], // G5 — top of the range
  ];
  let total = 0;
  segs.forEach((s) => {
    total += s[2];
  });
  const out = new Float32Array(Math.ceil((total / 1000) * effSr));
  let len = 0;
  let phase = 0;
  let vibPhase = 0;
  segs.forEach((s) => {
    const n = Math.round((s[2] / 1000) * effSr);
    for (let i = 0; i < n && len < out.length; i++) {
      if (s[0] === null) {
        out[len++] = 0;
        continue;
      }
      const frac = i / n;
      const midi = s[0] + (s[1] - s[0]) * frac;
      const vib = s[0] === s[1] && s[2] > 500 ? 0.3 * Math.sin(vibPhase) : 0; // ±30 cents
      vibPhase += (2 * Math.PI * 5.5) / effSr;
      const f = 440 * 2 ** ((midi + vib - 69) / 12);
      phase += (2 * Math.PI * f) / effSr;
      const env = Math.min(1, i / (0.02 * effSr), (n - i) / (0.02 * effSr));
      out[len++] = env * (0.22 * Math.sin(phase) + 0.06 * Math.sin(2 * phase));
    }
  });
  return out.subarray(0, len);
}
