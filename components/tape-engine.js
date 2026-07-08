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
    const grew = drawNewRows();
    if (grew) {
      paintVisible();
      if (follow) visWrap.scrollLeft = vis.width;
    }
    if (grew || traceDirty) paintTrace();
    if (playState === 'playing') updatePlayhead();
  }

  // ---- pitch trace: the raw-pitch pane riding under the tape in the
  // same scroll container, sharing its x-axis — each detector frame
  // draws at the tape row the renderer had just emitted, so the pitch
  // that produced a note bar sits directly below that bar at any scroll
  // position (and the playhead crosses both panes). Dots accumulate in
  // an offscreen at 1px per tape row; the visible canvas repaints
  // scaled to match the tape, with the reference rows drawn full-width.
  // Like the tape, the x-axis is SOUNDING time: silence doesn't advance,
  // so low-clarity dots during a rest pile into one column. ----
  const TRACE_H = 110;
  const traceCtx = trace.getContext('2d');
  let traceOff = document.createElement('canvas');
  traceOff.width = 4096;
  traceOff.height = TRACE_H;
  let traceOffCtx = traceOff.getContext('2d');
  let traceDirty = false;

  function traceY(midiFloat) {
    // G3 (55) at the bottom .. D6 (86) at the top
    return TRACE_H - ((midiFloat - 55) / (86 - 55)) * TRACE_H;
  }

  function growTraceOff(need) {
    if (need <= traceOff.width) return;
    const bigger = document.createElement('canvas');
    bigger.width = Math.max(need, traceOff.width * 2);
    bigger.height = TRACE_H;
    const c = bigger.getContext('2d');
    c.drawImage(traceOff, 0, 0);
    traceOff = bigger;
    traceOffCtx = c;
  }

  function drawTraceFrame(freq, clarity, soundingMidi) {
    if (!renderer) return;
    const x = Math.max(0, renderer.rows.length - 1);
    growTraceOff(x + 1);
    if (freq) {
      const mf = 69 + 12 * Math.log2(freq / 440);
      traceOffCtx.globalAlpha = Math.max(0.15, clarity * clarity);
      traceOffCtx.fillStyle = ink;
      traceOffCtx.fillRect(x, traceY(mf) - 1, 1, 3);
      traceOffCtx.globalAlpha = 1;
    }
    if (soundingMidi !== null) {
      traceOffCtx.fillStyle = inkFaint;
      traceOffCtx.fillRect(x, traceY(soundingMidi), 1, 1);
    }
    traceDirty = true;
  }

  function paintTrace() {
    traceDirty = false;
    if (trace.width !== vis.width) trace.width = vis.width;
    if (trace.height !== TRACE_H) trace.height = TRACE_H;
    traceCtx.clearRect(0, 0, trace.width, trace.height);
    // faint reference rows at A3 / A4 / A5, the duduk-in-A anchors
    traceCtx.globalAlpha = 0.3;
    traceCtx.fillStyle = inkFaint;
    for (const m of [57, 69, 81]) {
      traceCtx.fillRect(0, traceY(m), trace.width, 1);
    }
    traceCtx.globalAlpha = 1;
    const cols = Math.max(1, drawnRows);
    traceCtx.drawImage(
      traceOff,
      0,
      0,
      cols,
      TRACE_H,
      0,
      0,
      cols * SCALE,
      TRACE_H,
    );
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
    traceOffCtx.clearRect(0, 0, traceOff.width, TRACE_H);
    paintVisible();
    paintTrace();
    if (clearRecording) recLen = 0;
    printBtn.disabled = true;
    stopClip(false); // a new take invalidates the old playhead mapping
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
      syncTransport(); // no playback while the mic is live
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
    syncTransport(); // the fresh recording is now playable
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
      drawTraceFrame(m.freq, m.clarity, tracker.sounding);
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
    syncTransport();
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

  // ---- audio player: hear the recorded clip while a playhead sweeps
  // the tape. The tape is not linear in time (silence compresses to a
  // breath mark; glyph rows carry no time), so position comes from the
  // renderer's timeline (rowForTime / timeForRow) — the bar moves
  // steadily through notes and skips across breath marks, matching the
  // ear. The tape itself is the scrub surface: click or drag to seek
  // (drag pauses, release resumes). AudioBufferSource can't pause, so
  // pause/seek kill the source and remember the offset; resume starts a
  // fresh source there. ----
  const playBtn = $('tapePlayBtn');
  const stopBtn = $('tapeStopBtn');
  const timeEl = $('tapeTimeEl');
  const playhead = $('tapePlayhead');

  let playerCtx = null;
  let playSource = null;
  let playState = 'stopped'; // stopped | playing | paused
  let playOffset = 0; // seconds into the clip
  let playStartedAt = 0; // playerCtx.currentTime when playback began
  let playGen = 0; // invalidates onended of killed sources

  const clipDur = () => (recLen ? recLen / effSr : 0);
  const fmtTime = (sec) => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  };
  const playPos = () =>
    playState === 'playing'
      ? Math.min(
          playOffset + (playerCtx.currentTime - playStartedAt),
          clipDur(),
        )
      : playOffset;

  function killSource() {
    if (!playSource) return;
    playGen++;
    try {
      playSource.stop();
    } catch {
      /* already ended */
    }
    playSource.disconnect();
    playSource = null;
  }

  function playClip() {
    if (micOn || replaying || !recLen) return;
    if (!playerCtx) playerCtx = new AudioContext();
    if (playerCtx.state === 'suspended') playerCtx.resume();
    killSource();
    if (playOffset >= clipDur()) playOffset = 0;
    const buf = playerCtx.createBuffer(1, recLen, Math.round(effSr));
    buf.getChannelData(0).set(recorded.subarray(0, recLen));
    playSource = playerCtx.createBufferSource();
    playSource.buffer = buf;
    playSource.connect(playerCtx.destination);
    const gen = ++playGen;
    playSource.onended = () => {
      if (gen !== playGen || playState !== 'playing') return;
      playState = 'stopped';
      playOffset = 0;
      syncTransport();
    };
    playStartedAt = playerCtx.currentTime;
    playSource.start(0, playOffset);
    playState = 'playing';
    syncTransport();
  }

  function pauseClip() {
    if (playState !== 'playing') return;
    playOffset = playPos();
    killSource();
    playState = 'paused';
    syncTransport();
  }

  function stopClip(keepOffset) {
    killSource();
    playState = 'stopped';
    if (!keepOffset) playOffset = 0;
    syncTransport();
  }

  function syncTransport() {
    const idle = !recLen || micOn || replaying;
    playBtn.disabled = idle;
    stopBtn.disabled = idle || (playState === 'stopped' && playOffset === 0);
    playBtn.textContent = playState === 'playing' ? 'Pause' : 'Play';
    playBtn.classList.toggle('on', playState === 'playing');
    playhead.hidden = playState === 'stopped' && playOffset === 0;
    playhead.classList.toggle('live', playState === 'playing');
    updatePlayhead();
  }

  function updatePlayhead() {
    const t = playPos();
    timeEl.textContent = `${fmtTime(t)} / ${fmtTime(clipDur())}`;
    if (!renderer) return;
    const x = Math.round(renderer.rowForTime(t * 1000) * SCALE);
    playhead.style.left = `${x}px`;
    if (playState === 'playing') {
      // keep the bar in view; center it when it walks off either edge
      const view = visWrap.clientWidth;
      if (x < visWrap.scrollLeft + 16 || x > visWrap.scrollLeft + view - 48) {
        visWrap.scrollLeft = Math.max(0, x - view / 2);
      }
    }
  }

  playBtn.addEventListener('click', () => {
    if (playState === 'playing') pauseClip();
    else playClip();
  });
  stopBtn.addEventListener('click', () => stopClip(false));

  // scrubbing: the pointer position on the tape maps back to clip time
  let scrubbing = false;
  let scrubWasPlaying = false;

  function seekToEvent(e) {
    const rect = vis.getBoundingClientRect();
    const row = (e.clientX - rect.left) / SCALE;
    playOffset = Math.max(
      0,
      Math.min(clipDur(), renderer.timeForRow(row) / 1000),
    );
    syncTransport();
  }

  visWrap.addEventListener('pointerdown', (e) => {
    // both canvases scrub (they share the x-axis); the wrap itself is
    // only hit via its scrollbar, which must keep scrolling
    if (e.target === visWrap) return;
    if (!recLen || micOn || replaying) return;
    scrubbing = true;
    scrubWasPlaying = playState === 'playing';
    if (scrubWasPlaying) pauseClip();
    visWrap.setPointerCapture(e.pointerId);
    seekToEvent(e);
  });
  visWrap.addEventListener('pointermove', (e) => {
    if (scrubbing) seekToEvent(e);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (scrubWasPlaying) playClip();
  };
  visWrap.addEventListener('pointerup', endScrub);
  visWrap.addEventListener('pointercancel', endScrub);

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
    stopClip(false);
    if (playerCtx) {
      playerCtx.close();
      playerCtx = null;
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
  };
}
