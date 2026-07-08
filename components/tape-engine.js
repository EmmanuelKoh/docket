// components/tape-engine.js — the Tape tool's engine, following the
// Photo tool's architecture: markup in components/tape-tool.tsx renders
// once, and this module owns all behavior imperatively. Element ids are
// the contract between the two — change them together or not at all.
//
// Pipeline (all in the browser): mic → AudioWorklet (public/pcm-worklet.js,
// raw PCM to the main thread) → decimate to ~22 kHz → windows to the
// pitch worker (public/pitch-worker.js, MPM) → note tracker
// (components/tape-events.js) → tape renderer (components/tape-renderer.js)
// → exact printer rows, drawn on canvas in reading orientation and sent
// verbatim to /api/tape/print. The preview IS the print bytes; there is
// no parallel rendering.
//
// The session is always recorded (decimated PCM in memory, ~10 min cap):
// Replay re-runs the identical windows through the detector with the
// CURRENT slider values and re-renders the whole tape — the tuning loop
// that makes thresholds fixable without playing the phrase again.

import { createNoteTracker } from '@/components/tape-events.js';
import {
  createTapeRenderer,
  KEY_SIGS,
  noteLabel,
} from '@/components/tape-renderer.js';

export function initTapeTool() {
  const WINDOW = 1024; // analysis window (samples at ~22 kHz ≈ 46 ms)
  const HOP = 256; // analysis hop (≈ 12 ms → ~86 frames/s)
  const REC_MAX_S = 600; // recording cap (10 min ≈ 53 MB of Float32)
  const SCALE = 0.75; // preview px per printer dot
  const MAX_VIS_W = 30000; // canvas width guard (~14 min of sounding tape)

  const $ = (id) => document.getElementById(id);
  const statusEl = $('tapeStatus');
  const noteNowEl = $('tapeNoteNow');
  const logEl = $('tapeEventLog');
  const micBtn = $('tapeMicBtn');
  const demoBtn = $('tapeDemoBtn');
  const replayBtn = $('tapeReplayBtn');
  const newBtn = $('tapeNewBtn');
  const printBtn = $('tapePrintBtn');
  const saveBtn = $('tapeSaveClipBtn');
  const loadInput = $('tapeLoadClip');
  const keySel = $('tapeKeySig');
  const vis = $('tapeCanvas');
  const visWrap = $('tapeCanvasWrap');
  const trace = $('tapeTraceCanvas');

  const ink =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ink')
      .trim() || '#1a1a1a';
  const inkFaint =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ink-faint')
      .trim() || '#999';

  // ---- state ----
  let renderer = null;
  let tracker = null;
  let worker = null;

  let actx = null;
  let stream = null;
  let workletNode = null;
  let micOn = false;

  let effSr = 22050; // decimated sample rate (actual, from the device)
  let recorded = new Float32Array(1 << 20);
  let recLen = 0;
  let cursor = 0; // next analysis window start (samples)
  let inFlight = false; // one window in the pitch worker at a time
  let replaying = false;
  let lastT = 0; // timestamp of the newest analyzed frame (ms)
  let lastOn = null; // { midi, tMs } for event-log durations
  let raf = 0;

  // key signature select
  KEY_SIGS.forEach((k) => {
    const o = document.createElement('option');
    o.value = String(k.sharps);
    o.textContent = k.name;
    if (k.sharps === 0) o.selected = true;
    keySel.appendChild(o);
  });

  // ---- sliders: id -> config key, with live application ----
  function bindSlider(id, apply, fmt) {
    const el = $(id);
    const val = $(`${id}Val`);
    const show = () => {
      val.textContent = fmt ? fmt(el.value) : el.value;
    };
    el.addEventListener('input', () => {
      show();
      apply(parseFloat(el.value));
    });
    show();
  }
  function layoutCfg(key) {
    return (v) => {
      if (renderer) renderer.setConfig(keyVal(key, v));
    };
  }
  function trackerCfg(key) {
    return (v) => {
      if (tracker) tracker.setParams(keyVal(key, v));
    };
  }
  function keyVal(k, v) {
    const o = {};
    o[k] = v;
    return o;
  }

  bindSlider('tapeMsPerRow', layoutCfg('msPerRow'), (v) => `${v} ms`);
  bindSlider('tapeStaffGap', layoutCfg('staffGap'), (v) => `${v} dots`);
  bindSlider('tapeNoteDots', layoutCfg('noteDots'), (v) => `${v} dots`);
  bindSlider('tapeGlyphScale', layoutCfg('glyphScale'), (v) => `${v}×`);
  bindSlider('tapeBreathGap', layoutCfg('breathGapMs'), (v) => `${v} ms`);
  bindSlider(
    'tapeClarity',
    (v) => {
      if (tracker) tracker.setParams({ clarityMin: v / 100 });
    },
    (v) => (v / 100).toFixed(2),
  );
  bindSlider('tapeOnsetHold', trackerCfg('onsetHoldMs'), (v) => `${v} ms`);
  bindSlider('tapeRetrig', trackerCfg('retrigCents'), (v) => `±${v}¢`);
  bindSlider('tapeChangeHold', trackerCfg('changeHoldMs'), (v) => `${v} ms`);
  bindSlider('tapeOffMs', trackerCfg('offMs'), (v) => `${v} ms`);

  function layoutValues() {
    return {
      msPerRow: parseFloat($('tapeMsPerRow').value),
      staffGap: parseFloat($('tapeStaffGap').value),
      noteDots: parseFloat($('tapeNoteDots').value),
      glyphScale: parseFloat($('tapeGlyphScale').value),
      breathGapMs: parseFloat($('tapeBreathGap').value),
      keySig: parseInt(keySel.value, 10),
    };
  }
  function trackerValues() {
    return {
      clarityMin: parseFloat($('tapeClarity').value) / 100,
      onsetHoldMs: parseFloat($('tapeOnsetHold').value),
      retrigCents: parseFloat($('tapeRetrig').value),
      changeHoldMs: parseFloat($('tapeChangeHold').value),
      offMs: parseFloat($('tapeOffMs').value),
    };
  }
  keySel.addEventListener('change', () => {
    if (renderer) renderer.setConfig({ keySig: parseInt(keySel.value, 10) });
  });

  // ---- tape preview: offscreen canvas in PRINTER orientation (x = dot,
  // y = row), visible canvas draws it rotated into reading orientation
  // (time left→right, dot 0 at the bottom) via one transform. Dots are
  // ink on white paper in both themes, like every receipt preview. ----
  let off = document.createElement('canvas');
  off.width = 576;
  off.height = 4096;
  let offCtx = off.getContext('2d');
  offCtx.fillStyle = '#fff';
  offCtx.fillRect(0, 0, off.width, off.height);
  let drawnRows = 0;

  function growOff(need) {
    if (need <= off.height) return;
    const bigger = document.createElement('canvas');
    bigger.width = 576;
    bigger.height = Math.max(need, off.height * 2);
    const c = bigger.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, bigger.width, bigger.height);
    c.drawImage(off, 0, 0);
    off = bigger;
    offCtx = c;
  }

  function drawNewRows() {
    if (!renderer || drawnRows >= renderer.rows.length) return false;
    growOff(renderer.rows.length);
    offCtx.fillStyle = '#000';
    for (let y = drawnRows; y < renderer.rows.length; y++) {
      const row = renderer.rows[y];
      for (let xb = 0; xb < 72; xb++) {
        const byte = row[xb];
        if (!byte) continue;
        for (let b = 0; b < 8; b++) {
          if (byte & (0x80 >> b)) offCtx.fillRect(xb * 8 + b, y, 1, 1);
        }
      }
    }
    drawnRows = renderer.rows.length;
    return true;
  }

  function paintVisible() {
    const wantW = Math.min(
      MAX_VIS_W,
      Math.max(visWrap.clientWidth, Math.ceil(drawnRows * SCALE)),
    );
    const wantH = Math.round(576 * SCALE);
    if (vis.width !== wantW || vis.height !== wantH) {
      vis.width = wantW;
      vis.height = wantH;
    }
    const ctx = vis.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, vis.width, vis.height);
    // offscreen pixel (x, row) -> visible (row*SCALE, (576 - x)*SCALE)
    ctx.setTransform(0, -SCALE, SCALE, 0, 0, 576 * SCALE);
    ctx.drawImage(off, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  let follow = true;
  visWrap.addEventListener('scroll', () => {
    follow = visWrap.scrollLeft + visWrap.clientWidth >= vis.width - 8;
  });

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!drawNewRows()) return;
    paintVisible();
    if (follow) visWrap.scrollLeft = vis.width;
  }

  // ---- pitch trace: strip chart, one column per analysis frame ----
  const traceCtx = trace.getContext('2d');
  function traceY(midiFloat) {
    // G3 (55) at the bottom .. D6 (86) at the top
    return trace.height - ((midiFloat - 55) / (86 - 55)) * trace.height;
  }
  function initTrace() {
    trace.width = trace.clientWidth || 800;
    trace.height = trace.clientHeight || 120;
    traceCtx.clearRect(0, 0, trace.width, trace.height);
  }
  function drawTraceFrame(freq, clarity, soundingMidi) {
    traceCtx.drawImage(trace, -1, 0);
    traceCtx.clearRect(trace.width - 1, 0, 1, trace.height);
    if (freq) {
      const mf = 69 + 12 * Math.log2(freq / 440);
      traceCtx.globalAlpha = Math.max(0.15, clarity * clarity);
      traceCtx.fillStyle = ink;
      traceCtx.fillRect(trace.width - 1, traceY(mf) - 1, 1, 3);
      traceCtx.globalAlpha = 1;
    }
    if (soundingMidi !== null) {
      traceCtx.fillStyle = inkFaint;
      traceCtx.fillRect(trace.width - 1, traceY(soundingMidi), 1, 1);
    }
  }

  function logLine(text) {
    const div = document.createElement('div');
    div.textContent = text;
    logEl.prepend(div);
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.lastChild);
  }

  // ---- fresh take ----
  function resetTake(clearRecording) {
    renderer = createTapeRenderer(layoutValues());
    tracker = createNoteTracker(trackerValues());
    cursor = 0;
    lastT = 0;
    lastOn = null;
    drawnRows = 0;
    offCtx.fillStyle = '#fff';
    offCtx.fillRect(0, 0, off.width, off.height);
    logEl.textContent = '';
    noteNowEl.textContent = '—';
    initTrace();
    paintVisible();
    if (clearRecording) recLen = 0;
    printBtn.disabled = true;
  }

  // ---- analysis plumbing ----
  function ensureWorker() {
    if (worker) return;
    worker = new Worker('/pitch-worker.js');
    worker.onmessage = (ev) => {
      inFlight = false;
      onPitchFrame(ev.data);
      pumpAnalysis();
    };
  }

  function applyFrame(m) {
    lastT = m.t;
    const events = tracker.push({ tMs: m.t, freq: m.freq, clarity: m.clarity });
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'on') {
        renderer.noteOn(e.midi, e.tMs);
        lastOn = { midi: e.midi, tMs: e.tMs };
        noteNowEl.textContent = noteLabel(e.midi, renderer.config.keySig);
      } else {
        renderer.noteOff(e.tMs);
        noteNowEl.textContent = '—';
        if (lastOn) {
          logLine(
            noteLabel(lastOn.midi, renderer.config.keySig) +
              '  ' +
              ((e.tMs - lastOn.tMs) / 1000).toFixed(2) +
              's',
          );
          lastOn = null;
        }
      }
    }
    renderer.advance(m.t);
    if (renderer.rows.length) printBtn.disabled = false;
  }

  // End-of-take: flush a still-sounding note through the same logging
  // path a live noteOff takes.
  function flushTracker() {
    const events = tracker.finish(lastT);
    for (let i = 0; i < events.length; i++) {
      renderer.noteOff(events[i].tMs);
      noteNowEl.textContent = '—';
      if (lastOn) {
        logLine(
          noteLabel(lastOn.midi, renderer.config.keySig) +
            '  ' +
            ((events[i].tMs - lastOn.tMs) / 1000).toFixed(2) +
            's',
        );
        lastOn = null;
      }
    }
  }

  function onPitchFrame(m) {
    applyFrame(m);
    drawTraceFrame(m.freq, m.clarity, tracker.sounding);
  }

  function pumpAnalysis() {
    if (inFlight || replaying) return;
    if (recLen - cursor < WINDOW) return;
    const win = new Float32Array(WINDOW);
    win.set(recorded.subarray(cursor, cursor + WINDOW));
    const t = ((cursor + WINDOW) / effSr) * 1000;
    cursor += HOP;
    inFlight = true;
    worker.postMessage({ buf: win.buffer, sr: effSr, t: t }, [win.buffer]);
  }

  function appendPcm(block, factor) {
    const n = Math.floor(block.length / factor);
    if (recLen + n > recorded.length) {
      if (recLen + n > REC_MAX_S * effSr) {
        stopMic('recording cap reached');
        return;
      }
      const bigger = new Float32Array(
        Math.min(REC_MAX_S * effSr, recorded.length * 2) + n,
      );
      bigger.set(recorded.subarray(0, recLen));
      recorded = bigger;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < factor; j++) s += block[i * factor + j];
      recorded[recLen++] = s / factor;
    }
  }

  // ---- mic session ----
  async function startMic() {
    ensureWorker();
    resetTake(true);
    statusEl.textContent = 'starting mic…';
    try {
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
      effSr = actx.sampleRate / factor;
      const src = actx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(actx, 'pcm-forwarder');
      const mute = actx.createGain();
      mute.gain.value = 0; // pull the graph without hearing yourself
      src.connect(workletNode);
      workletNode.connect(mute);
      mute.connect(actx.destination);
      workletNode.port.onmessage = (ev) => {
        appendPcm(ev.data, factor);
        pumpAnalysis();
      };
      micOn = true;
      micBtn.textContent = 'Stop';
      micBtn.classList.add('on');
      statusEl.textContent = `listening — ${Math.round(effSr)} Hz analysis`;
    } catch (e) {
      statusEl.textContent = `mic failed: ${e.message}`;
    }
  }

  function stopMic(reason) {
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
    micBtn.textContent = 'Start mic';
    micBtn.classList.remove('on');
    if (tracker) flushTracker();
    statusEl.textContent =
      reason ||
      (recLen
        ? `stopped — ${(recLen / effSr).toFixed(1)}s recorded`
        : 'stopped');
  }

  micBtn.addEventListener('click', () => {
    if (micOn) stopMic();
    else startMic();
  });

  // ---- replay: identical windows, current slider values ----
  async function replay() {
    if (micOn || replaying || recLen < WINDOW) return;
    ensureWorker();
    replaying = true;
    resetTake(false);
    const total = Math.floor((recLen - WINDOW) / HOP) + 1;
    for (let f = 0; f < total; f++) {
      const start = f * HOP;
      const win = new Float32Array(WINDOW);
      win.set(recorded.subarray(start, start + WINDOW));
      const t = ((start + WINDOW) / effSr) * 1000;
      const m = await new Promise((resolve) => {
        worker.onmessage = (ev) => {
          resolve(ev.data);
        };
        worker.postMessage({ buf: win.buffer, sr: effSr, t: t }, [win.buffer]);
      });
      applyFrame(m);
      if (f % 200 === 0) {
        statusEl.textContent = `replaying… ${Math.round((f / total) * 100)}%`;
        await new Promise((r) => {
          setTimeout(r, 0);
        });
      }
    }
    flushTracker();
    // restore the live handler the replay promise hijacked
    worker.onmessage = (ev) => {
      inFlight = false;
      onPitchFrame(ev.data);
      pumpAnalysis();
    };
    inFlight = false;
    replaying = false;
    statusEl.textContent = `replayed ${(recLen / effSr).toFixed(1)}s with current settings`;
  }
  replayBtn.addEventListener('click', replay);

  // ---- demo phrase: a synthetic duduk-ish take (vibrato, a committed
  // bend, a retreating bend, a fast run, breaths, both ledger regions)
  // so the whole pipeline can be exercised without an instrument ----
  function synthDemo() {
    effSr = effSr || 22050;
    const segs = [
      // [midi from, midi to, ms, silent]
      [69, 69, 2200], // A4, vibrato arrives after the attack
      [69, 71, 150], // bend up to B4 — should commit as a new note
      // (quick enough that the passing A#4 zone stays
      // under changeHoldMs and never commits)
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
    const n = Math.ceil((total / 1000) * effSr);
    recorded = new Float32Array(n + WINDOW);
    recLen = 0;
    let phase = 0;
    let vibPhase = 0;
    segs.forEach((s) => {
      const len = Math.round((s[2] / 1000) * effSr);
      for (let i = 0; i < len; i++) {
        if (s[0] === null) {
          recorded[recLen++] = 0;
          continue;
        }
        const frac = i / len;
        const midi = s[0] + (s[1] - s[0]) * frac;
        const vib = s[0] === s[1] && s[2] > 500 ? 0.3 * Math.sin(vibPhase) : 0; // ±30 cents
        vibPhase += (2 * Math.PI * 5.5) / effSr;
        const f = 440 * 2 ** ((midi + vib - 69) / 12);
        phase += (2 * Math.PI * f) / effSr;
        const env = Math.min(1, i / (0.02 * effSr), (len - i) / (0.02 * effSr));
        recorded[recLen++] =
          env * (0.22 * Math.sin(phase) + 0.06 * Math.sin(2 * phase));
      }
    });
    return replay();
  }
  demoBtn.addEventListener('click', synthDemo);
  newBtn.addEventListener('click', () => {
    if (micOn) stopMic();
    resetTake(true);
    statusEl.textContent = '';
  });

  // ---- save / load clips (WAV, 16-bit mono) for repeatable tuning ----
  saveBtn.addEventListener('click', () => {
    if (!recLen) return;
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    a.download = 'tape-clip.wav';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  loadInput.addEventListener('change', async () => {
    const file = loadInput.files[0];
    if (!file) return;
    statusEl.textContent = 'decoding clip…';
    try {
      const dctx = new AudioContext();
      const decoded = await dctx.decodeAudioData(await file.arrayBuffer());
      dctx.close();
      const ch = decoded.getChannelData(0);
      const factor = Math.max(1, Math.round(decoded.sampleRate / 22050));
      effSr = decoded.sampleRate / factor;
      recorded = new Float32Array(Math.ceil(ch.length / factor) + WINDOW);
      recLen = 0;
      appendPcm(ch, factor);
      await replay();
    } catch (e) {
      statusEl.textContent = `clip load failed: ${e.message}`;
    }
    loadInput.value = '';
  });

  // ---- print the take: the renderer's exact bytes, plus a PNG of the
  // same rows (printer orientation, like every History thumbnail) ----
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  printBtn.addEventListener('click', () => {
    if (!renderer?.rows.length) return;
    if (micOn) stopMic();
    printBtn.disabled = true;
    printBtn.textContent = 'Queuing…';
    const height = renderer.rows.length;
    const crop = document.createElement('canvas');
    crop.width = 576;
    crop.height = height;
    const cctx = crop.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, 576, height);
    cctx.drawImage(off, 0, 0);
    crop.toBlob((blob) => {
      blob
        .arrayBuffer()
        .then((pngBuf) =>
          fetch('/api/tape/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bytes: b64(renderer.toEscpos()),
              png: b64(new Uint8Array(pngBuf)),
              width: 576,
              height: height,
              name: 'Tape take',
            }),
          }),
        )
        .then((r) => r.json())
        .then((body) => {
          statusEl.textContent = body.id
            ? `queued ${body.id}`
            : body.error || 'failed';
        })
        .catch((e) => {
          statusEl.textContent = e.message;
        })
        .finally(() => {
          printBtn.disabled = false;
          printBtn.textContent = 'Print take';
        });
    }, 'image/png');
  });

  resetTake(true);
  raf = requestAnimationFrame(frame);

  // ---- dispose (React unmount) ----
  return function dispose() {
    cancelAnimationFrame(raf);
    if (micOn) stopMic();
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };
}
