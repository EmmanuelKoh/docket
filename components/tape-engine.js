// components/tape-engine.js — the Tape tool's engine, following the
// Photo tool's architecture: markup in components/tape-tool.tsx renders
// once, and this module owns all behavior imperatively. Element ids are
// the contract between the two — change them together or not at all.
//
// Pipeline (all in the browser). LIVE: mic → AudioWorklet
// (public/pcm-worklet.js, raw PCM to the main thread) → decimate to
// ~22 kHz → windows to the pitch worker (public/pitch-worker.js) → v1
// note tracker (components/tape-events.js) → a real-time SKETCH of the
// tape and trace. FINAL: on Stop / Replay / Load clip, the recording is
// transcribed by Basic Pitch (model in public/basic-pitch/) and decoded
// by the shared pass-1/pass-2 modules (scripts/tape-eval/), then fed to
// the tape renderer (components/tape-renderer.js) → exact printer rows,
// drawn on canvas in reading orientation and sent verbatim to
// /api/tape/print. The preview IS the print bytes; there is no parallel
// rendering.
//
// The session is always recorded (decimated PCM in memory, ~10 min cap).

import { createNoteTracker } from '@/components/tape-events.js';
import {
  createTapeRenderer,
  KEY_SIGS,
  noteLabel,
} from '@/components/tape-renderer.js';
import { annotate } from '@/scripts/tape-eval/marks.mjs';
import { normalizeLoudness } from '@/scripts/tape-eval/normalize.mjs';
import { decorate, onsetAt } from '@/scripts/tape-eval/ornaments.mjs';
import { skeletonize } from '@/scripts/tape-eval/skeleton.mjs';

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
  const viewSel = $('tapeView');
  const traceModeSel = $('tapeTraceMode');
  const speedSel = $('tapeSpeed');
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

  // v1 live-detector settings, fixed since the neural decode replaced
  // the live tracker as the source of the final tape (the tracker only
  // sketches the real-time trace now). The old Detection sliders and
  // detector/drone selects are gone with them.
  const detectorMode = 'harm'; // harmonic-salience: drone-robust
  const droneMode = null; // the harmonic detector handles the dam
  let melodyFloor = 230; // Hz — above the dam (185-210 measured), below
  // the melody's lowest note (B3, 247). Also sets the neural skeleton's
  // register floor, so it stays a user control
  let analysisGen = 0; // bumped per take: resets the worker's background

  // ---- view state: what the stage shows, not what was analyzed ----
  let viewMode = 'full'; // 'full' (ornaments + slides) | 'skeleton'
  let traceMode = 'aligned'; // 'aligned' (tape rows) | 'linear' (time)
  let traceZoom = 90; // linear-trace columns per second of audio
  let lastDecode = null; // { notes, opts } of the newest neural decode

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
    'tapeFloor',
    (v) => {
      melodyFloor = v;
    },
    (v) => `${v} Hz`,
  );

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
  // fixed live-tracker settings (the old slider defaults): they shape
  // only the real-time sketch, not the neural transcription
  function trackerValues() {
    return {
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

  // every analyzed frame is kept, so the trace can be redrawn in either
  // mode at any zoom without re-running the detector
  let traceFrames = []; // [{ t, freq, clarity, sounding }]
  let traceCols = 1; // rightmost drawn column (linear mode extent)

  // aligned mode: one column per tape row (raw pitch sits directly
  // under the note bar it produced, but glyph/gap rows cut the audio);
  // linear mode: one continuous ribbon of time, traceZoom columns/sec
  function traceCol(tMs, liveCol) {
    if (traceMode === 'linear') return Math.round((tMs / 1000) * traceZoom);
    if (liveCol !== null && liveCol !== undefined) return liveCol;
    return renderer.rowForTime(tMs);
  }

  function drawTraceFrame(tMs, freq, clarity, soundingMidi, liveCol = null) {
    if (!renderer) return;
    traceFrames.push({ t: tMs, freq, clarity, sounding: soundingMidi });
    paintTraceFrame(tMs, freq, clarity, soundingMidi, liveCol);
  }

  function paintTraceFrame(tMs, freq, clarity, soundingMidi, liveCol = null) {
    const x = Math.max(0, traceCol(tMs, liveCol));
    traceCols = Math.max(traceCols, x + 1);
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

  // redraw the whole trace from stored frames — used when the mode or
  // zoom changes, or when the tape is re-rendered (aligned columns move)
  function rebuildTrace() {
    traceOffCtx.clearRect(0, 0, traceOff.width, TRACE_H);
    traceCols = 1;
    for (const f of traceFrames) {
      paintTraceFrame(f.t, f.freq, f.clarity, f.sounding);
    }
    paintTrace();
  }

  function paintTrace() {
    traceDirty = false;
    const cols =
      traceMode === 'linear' ? Math.max(1, traceCols) : Math.max(1, drawnRows);
    // linear mode may outgrow the tape; the roll scrolls to the widest
    const w = Math.max(vis.width, Math.ceil(cols * SCALE));
    if (trace.width !== w) trace.width = w;
    if (trace.height !== TRACE_H) trace.height = TRACE_H;
    traceCtx.clearRect(0, 0, trace.width, trace.height);
    // faint reference rows at A3 / A4 / A5, the duduk-in-A anchors
    traceCtx.globalAlpha = 0.3;
    traceCtx.fillStyle = inkFaint;
    for (const m of [57, 69, 81]) {
      traceCtx.fillRect(0, traceY(m), trace.width, 1);
    }
    traceCtx.globalAlpha = 1;
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
    traceFrames = [];
    traceCols = 1;
    droneScore.clear(); // re-learned per take (and per replay)
    analysisGen++; // the worker forgets its background spectrum too
    evQueue = [];
    frameQueue = [];
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

  // ---- drone filter. A dam (drone) is a second, steady periodicity:
  // the detector's tallest peak is then often the drone, not the melody,
  // and the mixture drags clarity down. Fixed mode gates a chosen note;
  // Auto mode learns which pitches are drones by PERSISTENCE — every
  // candidate pitch accrues a score with a ~5s time constant, and a
  // pitch continuously present for ~10s (longer than any melody note) is
  // treated as drone until it stops or moves, so a dam that changes
  // pitch mid-piece is re-acquired automatically. The drone's
  // octave-below ghost peak is persistent too, so it earns its own
  // drone score without special handling. While the tracked melody
  // sits within a semitone of a drone pitch the filter stands down —
  // a melody note ON the dam still sustains. ----
  const DRONE_CENTS = 70; // fixed-mode gate half-width
  const DRONE_TAU_S = 5; // persistence EMA time constant
  const DRONE_THRESH = 0.85; // score needed to call a pitch a drone
  const droneScore = new Map(); // 50-cent bin -> presence score 0..1

  const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
  const binOf = (f) => Math.round(midiOf(f) * 2);

  function updateDroneScores(cands) {
    const alpha = Math.min(1, HOP / effSr / DRONE_TAU_S);
    const present = new Set(cands.map((c) => binOf(c.freq)));
    for (const b of present) {
      if (!droneScore.has(b)) droneScore.set(b, 0);
    }
    for (const [b, s] of droneScore) {
      const next = s + ((present.has(b) ? 1 : 0) - s) * alpha;
      if (next < 0.02 && !present.has(b)) droneScore.delete(b);
      else droneScore.set(b, next);
    }
  }

  function isDroneMidi(mf) {
    if (droneMode === 'auto') {
      const b = Math.round(mf * 2);
      for (let d = -1; d <= 1; d++) {
        if ((droneScore.get(b + d) || 0) >= DRONE_THRESH) return true;
      }
      return false;
    }
    const dc = Math.abs(mf - droneMode) * 100;
    const ghost = Math.abs(mf + 12 - droneMode) * 100; // octave-below ghost
    return dc <= DRONE_CENTS || ghost <= DRONE_CENTS;
  }

  function pickFrame(m, trk = tracker) {
    if (m.cands?.length) updateDroneScores(m.cands);
    if (droneMode === null || !m.cands || !m.cands.length) return m;
    if (trk.sounding !== null && isDroneMidi(trk.sounding)) return m;
    let best = 0;
    for (const c of m.cands) best = Math.max(best, c.clarity);
    const pick = m.cands.find(
      (c) => c.clarity >= 0.7 * best && !isDroneMidi(midiOf(c.freq)),
    );
    return pick
      ? { ...m, freq: pick.freq, clarity: pick.clarity }
      : { ...m, freq: null, clarity: 0 };
  }

  // ---- look-behind rendering: the tape draws ~300ms behind the
  // analysis. Some interpretations are only knowable in retrospect — an
  // ornament is recognized when the pitch RETURNS, and the tracker then
  // emits it backdated to its true start with its true span. The delay
  // queue lets those backdated events land before that stretch of tape
  // is drawn, so a grace note gets its real length instead of a
  // zero-width sliver. Live printing runs seconds behind the horn
  // anyway; 300ms of hindsight is free accuracy. ----
  const RENDER_DELAY_MS = 300; // must exceed ornamentMaxMs + one hop
  let evQueue = []; // note events awaiting the horizon, sorted by tMs
  let frameQueue = []; // pitch frames awaiting the (delayed) trace

  function feedRenderer(horizonMs) {
    while (evQueue.length && evQueue[0].tMs <= horizonMs) {
      const e = evQueue.shift();
      renderer.advance(e.tMs);
      if (e.type === 'on') {
        renderer.noteOn(e.midi, e.tMs, e.grace, {
          slide: e.slide,
          ornament: e.ornament,
        });
        lastOn = { midi: e.midi, tMs: e.tMs, grace: e.grace };
        noteNowEl.textContent = noteLabel(e.midi, renderer.config.keySig);
      } else {
        renderer.noteOff(e.tMs);
        noteNowEl.textContent = '—';
        if (lastOn) {
          const label = noteLabel(lastOn.midi, renderer.config.keySig);
          logLine(
            (lastOn.grace ? `( ${label} )` : label) +
              '  ' +
              ((e.tMs - lastOn.tMs) / 1000).toFixed(2) +
              's',
          );
          lastOn = null;
        }
      }
    }
    renderer.advance(horizonMs);
    while (frameQueue.length && frameQueue[0].t <= horizonMs) {
      const f = frameQueue.shift();
      drawTraceFrame(
        f.t,
        f.freq,
        f.clarity,
        f.sounding,
        Math.max(0, renderer.rows.length - 1),
      );
    }
    if (renderer.rows.length) printBtn.disabled = false;
  }

  function applyFrame(raw) {
    const m = pickFrame(raw);
    lastT = m.t;
    const events = tracker.push({
      tMs: m.t,
      freq: m.freq,
      clarity: m.clarity,
      energy: m.energy,
    });
    if (events.length) {
      evQueue.push(...events);
      evQueue.sort((a, b) => a.tMs - b.tMs);
    }
    frameQueue.push({
      t: m.t,
      freq: m.freq,
      clarity: m.clarity,
      sounding: tracker.sounding,
    });
    feedRenderer(m.t - RENDER_DELAY_MS);
    return m;
  }

  // End-of-take: flush the still-sounding note and drain the look-behind
  // queue so the tape catches up to the last analyzed frame.
  function flushTracker() {
    const events = tracker.finish(lastT);
    if (events.length) {
      evQueue.push(...events);
      evQueue.sort((a, b) => a.tMs - b.tMs);
    }
    feedRenderer(Number.MAX_SAFE_INTEGER);
  }

  function onPitchFrame(m) {
    applyFrame(m);
  }

  // detector parameters that ride along with every analysis window;
  // holdF0 tells the harmonic detector which comb is the melody being
  // tracked right now, so its background never learns (eats) a long
  // held note. (The old Tuning slider corrected this for sharp players;
  // the live sketch tolerates the small mask offset, and the neural
  // transcription estimates the take's tuning center on its own.)
  function holdFreq(trk) {
    if (!trk || trk.sounding === null) return 0;
    return 440 * 2 ** ((trk.sounding - 69) / 12);
  }

  function analysisParams() {
    return {
      mode: detectorMode,
      fMin: melodyFloor,
      gen: analysisGen,
      holdF0: holdFreq(tracker),
    };
  }

  function pumpAnalysis() {
    if (inFlight || replaying) return;
    if (recLen - cursor < WINDOW) return;
    const win = new Float32Array(WINDOW);
    win.set(recorded.subarray(cursor, cursor + WINDOW));
    const t = ((cursor + WINDOW) / effSr) * 1000;
    cursor += HOP;
    inFlight = true;
    worker.postMessage(
      { buf: win.buffer, sr: effSr, t: t, ...analysisParams() },
      [win.buffer],
    );
  }

  // ---- input high-pass (~130 Hz, RBJ biquad): kills room rumble and
  // handling noise that erode detector clarity. The duduk's lowest note
  // is A3 (220 Hz), so the music passes untouched. Applied at record
  // time, so replays and saved clips carry the same signal. ----
  const HP_HZ = 130;
  let hpB0 = 1;
  let hpB1 = 0;
  let hpB2 = 0;
  let hpA1 = 0;
  let hpA2 = 0;
  let hpX1 = 0;
  let hpX2 = 0;
  let hpY1 = 0;
  let hpY2 = 0;

  function setHighpass(sr) {
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
  setHighpass(effSr);

  function highpass(x) {
    const y = hpB0 * x + hpB1 * hpX1 + hpB2 * hpX2 - hpA1 * hpY1 - hpA2 * hpY2;
    hpX2 = hpX1;
    hpX1 = x;
    hpY2 = hpY1;
    hpY1 = y;
    return y;
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
      recorded[recLen++] = highpass(s / factor);
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
      setHighpass(effSr);
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
    if (micOn) {
      stopMic();
      // v2: the live tracker is a sketch; the real transcription is the
      // neural decode of the recording, run when the take ends
      if (recLen > effSr) neuralReplay();
    } else {
      startMic();
    }
  });

  // ---- neural replay (transcription v2, see docs/
  // tape-transcription-v2.md): Basic Pitch (Apache-2.0, model bundled
  // in public/basic-pitch/) transcribes the recording polyphonically —
  // melody AND dam as separate note tracks — then the pass-1 skeleton
  // (scripts/tape-eval/skeleton.mjs, same module the corpus scorer
  // runs) reduces it to the main melody, fed to the unchanged renderer.
  // The live mic path above stays on the lightweight v1 tracker for the
  // real-time trace; this decode runs on Stop, Replay, and Load clip.
  let neural = null; // cached { bp } after first use (tfjs is lazy-loaded)

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

  async function neuralReplay() {
    if (micOn || replaying || recLen < effSr / 2) return;
    replaying = true;
    resetTake(false);
    try {
      if (!neural) {
        statusEl.textContent = 'loading transcription model…';
        const bpModule = await import('@spotify/basic-pitch');
        neural = {
          ...bpModule,
          bp: new bpModule.BasicPitch('/basic-pitch/model.json'),
        };
      }
      // loudness-normalize to the corpus calibration level (robustness
      // item 2): the whole evidence chain is amplitude-shaped, and this
      // makes mic gain and clip level irrelevant to the transcription.
      // Playback and the raw-pitch trace keep the original audio
      const audio = normalizeLoudness(
        await resampleTo22050(recorded.subarray(0, recLen), effSr),
      );
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
          statusEl.textContent = `transcribing… ${Math.round(pct * 100)}%`;
        },
      );
      const frameEvents = neural.addPitchBendsToNoteEvents(
        contours,
        neural.outputToNotesPoly(frames, onsets, 0.4, 0.3, 5),
      );
      const events = neural.noteFramesToTime(frameEvents);
      const notes = events
        .map((e, i) => ({
          t0: e.startTimeSeconds,
          t1: e.startTimeSeconds + e.durationSeconds,
          midi: e.pitchMidi,
          amp: e.amplitude,
          bends: e.pitchBends ?? [],
          onset: onsetAt(onsets, frameEvents[i].startFrame, e.pitchMidi),
        }))
        .sort((a, b) => a.t0 - b.t0);
      const opts = {
        melodyLoMidi: Math.round(69 + 12 * Math.log2(melodyFloor / 440)),
      };
      lastDecode = { notes, opts };
      statusEl.textContent = renderDecoded(notes, opts);
    } catch (e) {
      statusEl.textContent = `transcription failed: ${e.message}`;
    }
    replaying = false;
    syncTransport();
    traceReplay(); // fill the raw-pitch trace under the finished tape
  }
  replayBtn.addEventListener('click', neuralReplay);

  // render the cached decode into the tape at the current view mode:
  // 'full' = pass 1 + 2 + 3 (ornaments, splits, slides, squiggles);
  // 'skeleton' = pass 1 only, the bare main-note melody
  function renderDecoded(notes, opts) {
    let timeline;
    let label;
    if (viewMode === 'skeleton') {
      const skeleton = skeletonize(notes, opts);
      timeline = skeleton;
      label = `skeleton view — ${skeleton.length} main notes`;
    } else {
      const decorated = decorate(notes, skeletonize(notes, opts), opts);
      // the fine-cents trace frames (when the backfill has run) add
      // ornament marks the neural model misses — see marks.mjs
      timeline = annotate(notes, decorated, opts, traceFrames);
      label = `transcribed ${decorated.skeleton.length} notes + ${decorated.graces.length} ornaments (neural)`;
    }
    for (const n of timeline) {
      evQueue.push({
        type: 'on',
        midi: n.midi,
        tMs: n.t0 * 1000,
        grace: n.grace,
        slide: n.slide,
        ornament: n.ornament,
      });
      evQueue.push({ type: 'off', tMs: n.t1 * 1000 });
    }
    evQueue.sort((a, b) => a.tMs - b.tMs);
    feedRenderer(Number.MAX_SAFE_INTEGER);
    return label;
  }

  // view toggles re-render from the cache — no re-transcription. The
  // trace frames survive the reset; aligned columns move with the new
  // tape, so the trace is rebuilt against it
  function rerenderView() {
    if (!lastDecode || micOn || replaying) return;
    const frames = traceFrames;
    resetTake(false);
    traceFrames = frames;
    statusEl.textContent = renderDecoded(lastDecode.notes, lastDecode.opts);
    rebuildTrace();
  }
  viewSel.addEventListener('change', () => {
    viewMode = viewSel.value;
    rerenderView();
  });
  traceModeSel.addEventListener('change', () => {
    traceMode = traceModeSel.value;
    rebuildTrace();
  });
  bindSlider(
    'tapeTraceZoom',
    (v) => {
      traceZoom = v;
      if (traceMode === 'linear') rebuildTrace();
    },
    (v) => `${v} px/s`,
  );

  // ---- trace backfill: after a neural decode, run the recording
  // through the v1 detector purely to draw the raw-pitch trace under
  // the tape (continuous cents — finer than the model's 1/3-semitone
  // grid, so it answers "did the recording even capture that figure?"
  // by eye). No note events; the tape itself is the neural decode's.
  async function traceReplay() {
    if (micOn || recLen < WINDOW || !renderer) return;
    ensureWorker();
    const gen = analysisGen;
    const trk = createNoteTracker(trackerValues());
    const total = Math.floor((recLen - WINDOW) / HOP) + 1;
    const analyzeAt = (f) =>
      new Promise((resolve) => {
        const start = f * HOP;
        const win = new Float32Array(WINDOW);
        win.set(recorded.subarray(start, start + WINDOW));
        worker.onmessage = (ev) => resolve(ev.data);
        worker.postMessage(
          {
            buf: win.buffer,
            sr: effSr,
            t: ((start + WINDOW) / effSr) * 1000,
            mode: detectorMode,
            fMin: melodyFloor,
            gen: gen,
            holdF0: holdFreq(trk),
          },
          [win.buffer],
        );
      });
    for (let f = 0; f < total; f++) {
      const m = await analyzeAt(f);
      // a new take, replay, or live mic invalidates this backfill
      if (micOn || analysisGen !== gen) break;
      const p = pickFrame(m, trk);
      trk.push({
        tMs: m.t,
        freq: p.freq,
        clarity: p.clarity,
        energy: p.energy,
      });
      drawTraceFrame(m.t, p.freq, p.clarity, trk.sounding);
      if (f % 400 === 0) {
        paintTrace();
        await new Promise((r) => {
          setTimeout(r, 0);
        });
      }
    }
    // restore the live handler the backfill hijacked
    worker.onmessage = (ev) => {
      inFlight = false;
      onPitchFrame(ev.data);
      pumpAnalysis();
    };
    inFlight = false;
    paintTrace();
    // the fine frames may reveal ornaments the neural decode missed —
    // re-render the tape with them (instant, from the cache), unless
    // audio is mid-play (a reset would yank the playhead)
    if (
      lastDecode &&
      !micOn &&
      analysisGen === gen &&
      playState === 'stopped'
    ) {
      rerenderView();
    }
  }

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
    return neuralReplay();
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
      setHighpass(effSr);
      recorded = new Float32Array(Math.ceil(ch.length / factor) + WINDOW);
      recLen = 0;
      appendPcm(ch, factor);
      await neuralReplay();
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

  let playRate = 1; // varispeed: slower playback also lowers pitch

  const clipDur = () => (recLen ? recLen / effSr : 0);
  const fmtTime = (sec) => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
  };
  const playPos = () =>
    playState === 'playing'
      ? Math.min(
          playOffset + (playerCtx.currentTime - playStartedAt) * playRate,
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
    playSource.playbackRate.value = playRate;
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
  speedSel.addEventListener('change', () => {
    const rate = parseFloat(speedSel.value) || 1;
    if (playState === 'playing') {
      // rebase the position math so the rate change takes effect cleanly
      playOffset = playPos();
      playStartedAt = playerCtx.currentTime;
      playSource.playbackRate.value = rate;
    }
    playRate = rate;
  });

  // scrubbing: the pointer position on the tape maps back to clip time
  let scrubbing = false;
  let scrubWasPlaying = false;

  function seekToEvent(e) {
    // a linear-mode trace has its own time axis; the tape keeps the
    // row-mapped one
    if (traceMode === 'linear' && e.target === trace) {
      const rect = trace.getBoundingClientRect();
      const sec = (e.clientX - rect.left) / SCALE / traceZoom;
      playOffset = Math.max(0, Math.min(clipDur(), sec));
    } else {
      const rect = vis.getBoundingClientRect();
      const row = (e.clientX - rect.left) / SCALE;
      playOffset = Math.max(
        0,
        Math.min(clipDur(), renderer.timeForRow(row) / 1000),
      );
    }
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
