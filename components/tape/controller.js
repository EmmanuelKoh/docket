// components/tape/controller.js — the Tape tool's orchestrator. Owns the
// session objects (recorder, analyzer, player, view, renderer, tracker,
// take document) and the flow between them; writes every UI-visible fact
// into the store (store.js) for React to render. React handlers call the
// methods returned here — nothing in this file touches control DOM.
//
// Pipeline (all in the browser). LIVE: mic → audio-io.js (decimated,
// high-passed PCM) → analyzer.js (pitch worker windows) → v1 note
// tracker (components/tape-events.js) → a real-time SKETCH of the tape
// and trace. FINAL: on Stop / Load clip, the recording is transcribed by
// Basic Pitch (decode.js) and interpreted into a take document
// (doc.mjs — the same pass-1/2/3 modules the eval corpus scores), then
// fed to the tape renderer (components/tape-renderer.js) → exact printer
// rows, painted by tape-view.js and sent verbatim to /api/tape/print.
// The preview IS the print bytes; there is no parallel rendering.

import { createNoteTracker } from '@/components/tape-events.js';
import { createTapeRenderer, noteLabel } from '@/components/tape-renderer.js';

import { createAnalyzer } from './analyzer.js';
import { createRecorder, synthDemoPcm } from './audio-io.js';
import { transcribe } from './decode.js';
import {
  applyEdit,
  createDoc,
  reDerive,
  redo,
  skeletonOf,
  undo,
} from './doc.mjs';
import {
  deleteTake as apiDeleteTake,
  loadTake as apiLoadTake,
  restoreTake as apiRestoreTake,
  saveTake as apiSaveTake,
  updateTake as apiUpdateTake,
  fetchTakes,
} from './persist.js';
import { createPlayer } from './playback.js';
import { tapeStore } from './store';
import { createTapeView } from './tape-view.js';

const WINDOW = 1024; // analysis window (samples at ~22 kHz ≈ 46 ms)
const HOP = 256; // analysis hop (≈ 12 ms → ~86 frames/s)
const RENDER_DELAY_MS = 300; // live look-behind, must exceed ornamentMaxMs

// fixed live-tracker settings: they shape only the real-time sketch,
// not the neural transcription (which estimates tuning on its own)
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

export function createTapeController({ canvas, traceCanvas, wrap, playhead }) {
  const set = tapeStore.setState;
  const get = tapeStore.getState;
  const settings = () => get().settings;

  // fresh session: clear the transient half of the (persistent) store
  set({
    micOn: false,
    decoding: false,
    status: '',
    noteNow: '—',
    log: [],
    playState: 'stopped',
    playTime: 0,
    clipDur: 0,
    hasAudio: false,
    canPrint: false,
    printState: 'idle',
    truncated: false,
    hasTake: false,
    selection: null,
    selectionRect: null,
    editCount: 0,
    redoCount: 0,
    persistBusy: false,
    currentTake: null,
    lastDeleted: null,
  });

  const recorder = createRecorder();
  const analyzer = createAnalyzer();

  let renderer = null;
  let tracker = null;
  let doc = null; // the take document (doc.mjs) of the newest decode
  let disposed = false;

  let traceFrames = []; // every analyzed frame, for redraw + ornament marks
  let cursor = 0; // next analysis window start (samples)
  let inFlight = false; // one live window in the pitch worker at a time
  let lastT = 0; // timestamp of the newest analyzed frame (ms)
  let lastOn = null; // { midi, tMs, grace } for event-log durations
  let analysisGen = 0; // bumped per take: stale analyses and backfills quit
  let decoding = false;
  let deriveStale = false; // derivation inputs changed (floor / fine frames)
  let pendingRerender = false; // re-render deferred while audio plays
  let logId = 0;

  // ---- player ----
  const player = createPlayer({
    getSamples: () => recorder.samples(),
    getRate: () => recorder.sampleRate,
    onChange(state) {
      set({ playState: state, playTime: player.pos() });
      if (state !== 'playing') applyPendingRerender();
    },
  });

  // ---- view (the canvas island) ----
  let scrubWasPlaying = false;
  let lastTick = -1;
  const view = createTapeView({
    canvas,
    traceCanvas,
    wrap,
    playhead,
    hooks: {
      getPlayback: () => ({
        t: player.pos(),
        playing: player.state === 'playing',
      }),
      onTick(t) {
        if (Math.abs(t - lastTick) >= 0.01) {
          lastTick = t;
          set({ playTime: t });
        }
        if (recorder.micOn) {
          // the time display counts the growing recording
          const d = recorder.seconds;
          if (Math.abs(d - get().clipDur) >= 0.1) set({ clipDur: d });
        }
      },
      isSeekable: () => recorder.length > 0 && !recorder.micOn && !decoding,
      onScrubStart() {
        scrubWasPlaying = player.state === 'playing';
        if (scrubWasPlaying) player.pause(); // drag pauses, release resumes
      },
      onSeek: (sec) => player.seek(sec),
      onScrubEnd() {
        if (scrubWasPlaying) player.play();
        scrubWasPlaying = false;
      },
      onSelect: (id) => selectNote(id),
      onTruncated: (v) => set({ truncated: v }),
    },
  });

  function syncAudioState() {
    set({ hasAudio: recorder.length > 0, clipDur: recorder.seconds });
  }

  function layoutValues() {
    const s = settings();
    return {
      msPerRow: s.msPerRow,
      staffGap: s.staffGap,
      noteDots: s.noteDots,
      glyphScale: s.glyphScale,
      breathGapMs: s.breathGapMs,
      keySig: s.keySig,
    };
  }

  // ---- fresh take ----
  let evQueue = []; // note events awaiting the render horizon
  let frameQueue = []; // pitch frames awaiting the (delayed) trace

  function resetTake(clearRecording) {
    renderer = createTapeRenderer(layoutValues());
    tracker = createNoteTracker(trackerValues());
    view.attachRenderer(renderer);
    cursor = 0;
    lastT = 0;
    lastOn = null;
    traceFrames = [];
    analysisGen++; // stale backfills and live windows quit
    pendingRerender = false; // any queued re-render is now stale
    evQueue = [];
    frameQueue = [];
    view.reset();
    if (clearRecording) recorder.reset();
    set({
      log: [],
      noteNow: '—',
      canPrint: false,
      hasTake: false,
      selection: null,
      selectionRect: null,
    });
    // the audio only changes when the recording is cleared/replaced —
    // re-renders of the same take keep the player's position and cached
    // buffer (the playhead mapping recomputes against the new rows), so
    // an edit doesn't yank the playhead back to zero. A cleared
    // recording also unties the session from its saved take.
    if (clearRecording) {
      player.invalidate();
      set({ currentTake: null });
    } else {
      player.stop(true);
    }
    syncAudioState();
  }

  // ---- selection: the note the inspector edits. The store carries a
  // snapshot (label, times, flags) plus the preview band rect; both are
  // rebuilt here after every render, because renders replace the
  // renderer and its geometry. An id that no longer exists (removed,
  // re-derived, skeleton view) simply clears the selection. ----
  function selectNote(id) {
    if (!doc || !id) {
      set({ selection: null, selectionRect: null });
      return;
    }
    const entry = doc.timeline.find((e) => e.id === id && !e.mark);
    const rect = view.rectForNote(id);
    if (!entry || !rect) {
      set({ selection: null, selectionRect: null });
      return;
    }
    const after = doc.timeline.slice(doc.timeline.indexOf(entry) + 1);
    set({
      selection: {
        id,
        label: noteLabel(entry.midi, renderer.config.keySig),
        midi: entry.midi,
        t0: entry.t0,
        t1: entry.t1,
        grace: !!entry.grace,
        ornament: !!entry.ornament,
        slide: !!entry.slide,
        canJoin: after.some((e) => !e.mark),
      },
      selectionRect: rect,
    });
  }

  function syncEditState() {
    set({
      editCount: doc ? doc.edits.length : 0,
      redoCount: doc ? doc.redoStack.length : 0,
    });
  }

  // ---- look-behind rendering: the live tape draws ~300ms behind the
  // analysis. Some interpretations are only knowable in retrospect — an
  // ornament is recognized when the pitch RETURNS, and the tracker then
  // emits it backdated to its true start with its true span. The delay
  // queue lets those backdated events land before that stretch of tape
  // is drawn. Live printing runs seconds behind the horn anyway; 300ms
  // of hindsight is free accuracy. ----
  function feedRenderer(horizonMs) {
    // store writes are collected and applied as ONE set() per drain —
    // rendering a decoded take pushes hundreds of events through this
    // loop in a single call, and a store write per event would re-render
    // the React side hundreds of times back to back
    let noteNow;
    const newLines = [];
    while (evQueue.length && evQueue[0].tMs <= horizonMs) {
      const e = evQueue.shift();
      renderer.advance(e.tMs);
      if (e.type === 'mark') {
        renderer.markNow(); // time-anchored ornament arc
      } else if (e.type === 'on') {
        renderer.noteOn(e.midi, e.tMs, e.grace, {
          slide: e.slide,
          ornament: e.ornament,
          id: e.id,
        });
        lastOn = { midi: e.midi, tMs: e.tMs, grace: e.grace };
        noteNow = noteLabel(e.midi, renderer.config.keySig);
      } else {
        renderer.noteOff(e.tMs);
        noteNow = '—';
        if (lastOn) {
          const label = noteLabel(lastOn.midi, renderer.config.keySig);
          newLines.push(
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
      traceFrames.push(f);
      view.paintTraceFrame(f, Math.max(0, renderer.rows.length - 1));
    }
    const patch = {};
    if (noteNow !== undefined) patch.noteNow = noteNow;
    if (newLines.length) {
      // newest first, like the log renders; ids keep chronological order
      patch.log = [
        ...newLines.map((text) => ({ id: ++logId, text })).reverse(),
        ...get().log,
      ].slice(0, 200);
    }
    if (renderer.rows.length && !get().canPrint) patch.canPrint = true;
    if (Object.keys(patch).length) set(patch);
  }

  function applyFrame(m) {
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
      energy: m.energy,
      sounding: tracker.sounding,
    });
    feedRenderer(m.t - RENDER_DELAY_MS);
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

  // holdF0 tells the harmonic detector which comb is the melody being
  // tracked right now, so its background never learns (eats) a long
  // held note.
  function holdFreq(trk) {
    if (!trk || trk.sounding === null) return 0;
    return 440 * 2 ** ((trk.sounding - 69) / 12);
  }

  // ---- live analysis pump: recorded blocks → pitch worker → tracker ----
  function pumpAnalysis() {
    if (inFlight || decoding) return;
    if (recorder.length - cursor < WINDOW) return;
    const win = new Float32Array(WINDOW);
    win.set(recorder.samples().subarray(cursor, cursor + WINDOW));
    const t = ((cursor + WINDOW) / recorder.sampleRate) * 1000;
    cursor += HOP;
    inFlight = true;
    const gen = analysisGen;
    analyzer
      .analyze(win, {
        sr: recorder.sampleRate,
        t,
        mode: 'harm', // harmonic-salience: drone-robust
        fMin: settings().melodyFloor,
        gen,
        holdF0: holdFreq(tracker),
      })
      .then((m) => {
        inFlight = false;
        // null = analyzer disposed; stale gen = a new take started
        if (!m || disposed || gen !== analysisGen) return;
        applyFrame(m);
        pumpAnalysis();
      });
  }

  // ---- mic session ----
  async function startMic() {
    resetTake(true);
    set({ status: 'starting mic…' });
    try {
      const sr = await recorder.startMic({
        onBlock: pumpAnalysis,
        onCap: () => stopMic('recording cap reached'),
      });
      set({ micOn: true, status: `listening — ${Math.round(sr)} Hz analysis` });
    } catch (e) {
      set({ status: `mic failed: ${e.message}` });
    }
  }

  function stopMic(reason) {
    recorder.stopMic();
    if (tracker) flushTracker();
    set({
      micOn: false,
      status:
        reason ||
        (recorder.length
          ? `stopped — ${recorder.seconds.toFixed(1)}s recorded`
          : 'stopped'),
    });
    syncAudioState();
  }

  // ---- neural decode (transcription v2, see docs/
  // tape-transcription-v2.md): runs on Stop and Load clip. The live
  // tracker above is only the real-time sketch; this is the tape. ----
  async function neuralDecode() {
    if (recorder.micOn || decoding || recorder.length < recorder.sampleRate / 2)
      return;
    decoding = true;
    set({ decoding: true });
    resetTake(false);
    try {
      const notes = await transcribe({
        samples: recorder.samples(),
        sampleRate: recorder.sampleRate,
        onStatus: (msg) => set({ status: msg }),
      });
      doc = createDoc({
        notes,
        melodyFloorHz: settings().melodyFloor,
        fineFrames: [],
        createdAt: Date.now(),
      });
      deriveStale = false;
      set({ status: renderTimeline(), hasTake: true });
      syncEditState();
    } catch (e) {
      set({ status: `transcription failed: ${e.message}` });
    }
    decoding = false;
    set({ decoding: false });
    syncAudioState();
    traceBackfill(); // fill the raw-pitch trace under the finished tape
  }

  // render the take document into the tape at the current view mode:
  // 'full' = the doc's timeline (passes 1+2+3, plus any edits);
  // 'skeleton' = pass 1 only, the bare main-note melody
  function renderTimeline() {
    let timeline;
    let label;
    if (get().viewMode === 'skeleton') {
      timeline = skeletonOf(doc);
      label = `main notes only — ${timeline.length} notes`;
    } else {
      timeline = doc.timeline;
      const mains = timeline.filter((e) => !e.mark).length;
      const arcs = timeline.filter((e) => e.ornament || e.mark).length;
      label = `${mains} notes · ${arcs} ornaments`;
    }
    for (const n of timeline) {
      if (n.mark) {
        // a time-anchored ornament arc, not a note
        evQueue.push({ type: 'mark', tMs: n.t0 * 1000 });
        continue;
      }
      evQueue.push({
        type: 'on',
        midi: n.midi,
        tMs: n.t0 * 1000,
        grace: n.grace,
        slide: n.slide,
        ornament: n.ornament,
        id: n.id,
      });
      evQueue.push({ type: 'off', tMs: n.t1 * 1000 });
    }
    evQueue.sort((a, b) => a.tMs - b.tMs);
    feedRenderer(Number.MAX_SAFE_INTEGER);
    return label;
  }

  // re-render the finished take from the document — no re-transcription.
  // Layout/key changes replay the existing timeline; when the derivation
  // inputs moved (melody floor, fresh fine frames) the doc re-derives,
  // snapshotting first if it carries edits (freeze-on-edit recovery).
  function rerenderView() {
    if (!doc || recorder.micOn || decoding) return;
    const selId = get().selection ? get().selection.id : null;
    const frames = traceFrames; // survive the reset
    resetTake(false);
    traceFrames = frames;
    // the reset (analysisGen bump) just aborted any running backfill —
    // queue a rerun, or the trace stays half-drawn and the fine-frame
    // ornament evidence never reaches the tape
    if (tracing) traceAgain = true;
    if (deriveStale) {
      deriveStale = false;
      // freeze-on-edit: an edited timeline is never re-derived behind
      // the user's back (the fine frames stay drawn in the trace; the
      // explicit "Start over" path re-derives and snapshots first)
      if (!doc.edits.length) {
        doc = reDerive(doc, {
          melodyFloorHz: settings().melodyFloor,
          fineFrames: traceFrames,
          savedAt: Date.now(),
        });
      }
    }
    set({ status: renderTimeline(), hasTake: true });
    view.rebuildTrace(traceFrames); // aligned columns moved with the tape
    syncEditState();
    selectNote(selId); // geometry moved; recompute (or clear) the band
  }

  // ---- editing: every op goes through the take document (doc.mjs) and
  // re-renders the whole tape from the edited timeline — the preview
  // and the print bytes stay the same rows by construction. ----
  function applyDocOp(op, keepId) {
    if (!doc || recorder.micOn || decoding) return;
    const next = applyEdit(doc, op);
    if (next === doc) return; // op didn't apply (see doc.mjs)
    doc = next;
    rerenderView();
    selectNote(keepId ?? null);
  }

  // a re-render deferred because audio was playing when it was wanted —
  // apply as soon as playback rests
  function applyPendingRerender() {
    if (!pendingRerender || recorder.micOn || decoding) return;
    pendingRerender = false;
    rerenderView();
  }

  // finished takes re-render automatically as settings change (cheap,
  // from the document); live recording keeps applying values to new
  // tape only. Debounced: sliders fire per pixel of drag.
  let rerenderTimer = 0;
  let rerenderReanalyze = false;
  function scheduleRerender(reanalyze = false) {
    if (!doc || recorder.micOn || decoding) return;
    rerenderReanalyze = rerenderReanalyze || reanalyze;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      if (player.state !== 'stopped') {
        pendingRerender = true;
        return;
      }
      const reanalyzeNow = rerenderReanalyze;
      rerenderReanalyze = false;
      rerenderView();
      if (reanalyzeNow) traceBackfill();
    }, 150);
  }

  // ---- trace backfill: after a neural decode, run the recording
  // through the v1 detector purely to draw the raw-pitch trace under
  // the tape (continuous cents — finer than the model's 1/3-semitone
  // grid). The fine frames also feed the pass-3 ornament marks, so a
  // finished backfill re-renders the tape once more. One backfill at a
  // time; the latest request wins. ----
  let tracing = false;
  let traceAgain = false;
  async function traceBackfill() {
    if (recorder.micOn || recorder.length < WINDOW || !renderer) return;
    if (tracing) {
      traceAgain = true; // rerun with fresh settings once this one exits
      return;
    }
    tracing = true;
    traceFrames = [];
    view.rebuildTrace([]); // a full re-analysis replaces the pane
    const gen = analysisGen;
    const trk = createNoteTracker(trackerValues());
    const total = Math.floor((recorder.length - WINDOW) / HOP) + 1;
    for (let f = 0; f < total; f++) {
      const start = f * HOP;
      const win = new Float32Array(WINDOW);
      win.set(recorder.samples().subarray(start, start + WINDOW));
      const m = await analyzer.analyze(win, {
        sr: recorder.sampleRate,
        t: ((start + WINDOW) / recorder.sampleRate) * 1000,
        mode: 'harm',
        fMin: settings().melodyFloor,
        gen,
        holdF0: holdFreq(trk),
      });
      // null = analyzer disposed; a new take, replay, or live mic
      // invalidates this backfill too
      if (!m || disposed || recorder.micOn || analysisGen !== gen) break;
      trk.push({
        tMs: m.t,
        freq: m.freq,
        clarity: m.clarity,
        energy: m.energy,
      });
      const frame = {
        t: m.t,
        freq: m.freq,
        clarity: m.clarity,
        energy: m.energy,
        sounding: trk.sounding,
      };
      traceFrames.push(frame);
      view.paintTraceFrame(frame);
    }
    tracing = false;
    if (disposed) return;
    if (traceAgain) {
      traceAgain = false; // settings changed while this backfill ran
      traceBackfill();
      return;
    }
    // the fine frames may reveal ornaments (and revived notes) the
    // neural decode missed — re-render the tape with them. If audio is
    // mid-play, defer: a reset now would yank the playhead
    if (doc && !recorder.micOn && analysisGen === gen) {
      deriveStale = true;
      if (player.state === 'stopped') rerenderView();
      else pendingRerender = true;
    }
  }

  // ---- print the take: the renderer's exact bytes, plus a PNG of the
  // same rows (printer orientation, like every History thumbnail) ----
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  async function print() {
    if (!renderer?.rows.length || get().printState === 'queuing') return;
    if (recorder.micOn) stopMic();
    set({ printState: 'queuing' });
    try {
      const png = await view.exportPng();
      const r = await fetch('/api/tape/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bytes: b64(renderer.toEscpos()),
          png: b64(png),
          width: 576,
          height: renderer.rows.length,
          name: 'Tape take',
        }),
      });
      const body = await r.json();
      set({
        status: body.id
          ? 'sent to the print queue'
          : body.error || 'print failed',
      });
    } catch (e) {
      set({ status: e.message });
    }
    set({ printState: 'idle' });
  }

  // ---- saved takes (persistence, see persist.js / lib/tape-store.js).
  // The list is fetched once on mount and after each mutation — never
  // polled (metered stores; see docs/store-costs.md). ----
  async function refreshTakes() {
    try {
      const takes = await fetchTakes();
      if (!disposed) set({ takes });
    } catch {
      if (!disposed) set({ takes: [] });
    }
  }

  // Save: when the session is tied to a saved take (currentTake), update
  // it in place — document/settings/name only, no audio re-upload; when
  // untied (or asNew), create a fresh record and tie to it.
  async function persistTake(name, asNew) {
    if (!doc || !recorder.length || recorder.micOn || decoding) return false;
    if (get().persistBusy) return false;
    set({ persistBusy: true });
    let ok = false;
    try {
      const cur = get().currentTake;
      const noteCount = doc.timeline.filter((e) => !e.mark).length;
      const onStatus = (msg) => set({ status: msg });
      const take =
        cur && !asNew
          ? await apiUpdateTake(cur.id, {
              name,
              noteCount,
              settings: settings(),
              doc,
              onStatus,
            })
          : await apiSaveTake({
              name,
              seconds: recorder.seconds,
              sampleRate: recorder.sampleRate,
              noteCount,
              settings: settings(),
              doc,
              wav: recorder.toWavBlob(),
              onStatus,
            });
      set({
        status: `saved "${take.name}"`,
        currentTake: { id: take.id, name: take.name },
      });
      ok = true;
      refreshTakes();
    } catch (e) {
      set({ status: `save failed: ${e.message}` });
    }
    set({ persistBusy: false });
    return ok;
  }

  async function loadTakeById(id) {
    if (recorder.micOn || decoding || get().persistBusy) return;
    set({ persistBusy: true, status: 'loading take…' });
    try {
      const loaded = await apiLoadTake(id);
      // the saved controls first — the renderer reads them on reset
      if (loaded.settings) {
        set((s) => ({ settings: { ...s.settings, ...loaded.settings } }));
        view.setTraceZoom(get().settings.traceZoom);
      }
      if (loaded.audio) await recorder.loadFile(loaded.audio);
      else recorder.reset();
      player.invalidate();
      doc = loaded.doc;
      deriveStale = false;
      resetTake(false);
      set({
        status: `loaded "${loaded.take.name}" — ${renderTimeline()}`,
        hasTake: true,
        currentTake: { id: loaded.take.id, name: loaded.take.name },
      });
      syncEditState();
      syncAudioState();
      traceBackfill(); // no-op without audio; refills the trace with it
    } catch (e) {
      set({ status: `load failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  async function deleteTakeById(id) {
    if (get().persistBusy) return;
    set({ persistBusy: true });
    try {
      const name = (get().takes || []).find((t) => t.id === id)?.name || 'take';
      await apiDeleteTake(id);
      set((s) => ({
        takes: (s.takes || []).filter((t) => t.id !== id),
        // deleting the take this session came from unties it — the next
        // Save creates a fresh record instead of updating a ghost
        currentTake: s.currentTake?.id === id ? null : s.currentTake,
        // soft delete: undoable from the list for the session, and the
        // record survives server-side for 30 days regardless
        lastDeleted: { id, name },
        status: `deleted "${name}" — kept for 30 days`,
      }));
    } catch (e) {
      set({ status: `delete failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  async function undeleteTake() {
    const gone = get().lastDeleted;
    if (!gone || get().persistBusy) return;
    set({ persistBusy: true });
    try {
      const take = await apiRestoreTake(gone.id);
      set({ lastDeleted: null, status: `restored "${take.name}"` });
      await refreshTakes();
    } catch (e) {
      set({ status: `restore failed: ${e.message}` });
    }
    set({ persistBusy: false });
  }

  // ---- boot ----
  resetTake(true);
  refreshTakes();

  // ---- public API (what the React handlers call) ----
  return {
    toggleMic() {
      if (recorder.micOn) {
        stopMic();
        // the live tracker is a sketch; the real transcription is the
        // neural decode of the recording, run when the take ends
        if (recorder.length > recorder.sampleRate) neuralDecode();
      } else if (!decoding) {
        startMic();
      }
    },
    newTake() {
      if (decoding) return; // don't yank the tape from under a decode
      if (recorder.micOn) stopMic();
      resetTake(true);
      set({ status: '' });
    },
    demo() {
      if (recorder.micOn || decoding) return;
      recorder.loadRaw(synthDemoPcm(recorder.sampleRate));
      player.invalidate(); // new audio behind the same take flow
      set({ currentTake: null }); // genuinely a new take
      syncAudioState();
      neuralDecode();
    },
    saveClip() {
      if (!recorder.length) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(recorder.toWavBlob());
      a.download = 'tape-clip.wav';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    async loadClip(file) {
      if (!file || recorder.micOn || decoding) return;
      set({ status: 'decoding clip…' });
      try {
        await recorder.loadFile(file);
        player.invalidate(); // new audio behind the same take flow
        set({ currentTake: null }); // genuinely a new take
        syncAudioState();
        await neuralDecode();
      } catch (e) {
        set({ status: `clip load failed: ${e.message}` });
      }
    },
    playPause() {
      if (recorder.micOn || decoding) return;
      if (player.state === 'playing') player.pause();
      else player.play();
    },
    stopPlay() {
      player.stop(false);
    },
    setSetting(key, value) {
      // freeze-on-edit: the floor changes the derivation, which would
      // replace the edited timeline (the slider is disabled in the UI;
      // this is the belt to that suspender)
      if (key === 'melodyFloor' && doc && doc.edits.length) return;
      set((s) => ({ settings: { ...s.settings, [key]: value } }));
      if (key === 'melodyFloor') {
        // the register split changes the decode AND the trace analysis
        deriveStale = true;
        scheduleRerender(true);
      } else if (key === 'traceZoom') {
        view.setTraceZoom(value);
        if (get().traceMode === 'linear') view.rebuildTrace(traceFrames);
      } else {
        // layout keys: live to the current renderer (mid-recording they
        // shape new tape only), full re-render for a finished take
        renderer?.setConfig({ [key]: value });
        scheduleRerender();
      }
    },
    setViewMode(v) {
      set({ viewMode: v });
      rerenderView();
    },
    setTraceMode(v) {
      set({ traceMode: v });
      view.setTraceMode(v);
      view.rebuildTrace(traceFrames);
    },
    setSpeed(v) {
      set({ speed: v });
      player.setRate(v);
    },

    // ---- editing (Phase 2) ----
    select: (id) => selectNote(id),
    nudgePitch(delta) {
      const sel = get().selection;
      if (!sel) return;
      const midi = Math.max(48, Math.min(91, sel.midi + delta));
      if (midi === sel.midi) return;
      applyDocOp({ op: 'setPitch', id: sel.id, midi }, sel.id);
    },
    toggleOrnament() {
      const sel = get().selection;
      if (sel) applyDocOp({ op: 'toggleOrnament', id: sel.id }, sel.id);
    },
    toggleSlide() {
      const sel = get().selection;
      if (sel) applyDocOp({ op: 'toggleSlide', id: sel.id }, sel.id);
    },
    splitAtPlayhead() {
      const sel = get().selection;
      if (!sel) return;
      const t = player.pos();
      if (!(t > sel.t0 + 0.02 && t < sel.t1 - 0.02)) return;
      applyDocOp({ op: 'split', id: sel.id, t }, `${sel.id}a`);
    },
    joinNext() {
      const sel = get().selection;
      if (sel) applyDocOp({ op: 'join', id: sel.id }, sel.id);
    },
    removeNote() {
      const sel = get().selection;
      if (sel) applyDocOp({ op: 'remove', id: sel.id }, null);
    },
    undoEdit() {
      if (!doc || recorder.micOn || decoding) return;
      const next = undo(doc);
      if (next === doc) return;
      doc = next;
      rerenderView();
    },
    redoEdit() {
      if (!doc || recorder.micOn || decoding) return;
      const next = redo(doc);
      if (next === doc) return;
      doc = next;
      rerenderView();
    },
    // the explicit unfreeze: re-derive from the recording at the current
    // floor. reDerive snapshots the edited tape into doc.versions first,
    // so nothing is lost — the recovery UI is a later phase.
    reread() {
      if (!doc || recorder.micOn || decoding) return;
      selectNote(null); // ids change wholesale; keep nothing selected
      doc = reDerive(doc, {
        melodyFloorHz: settings().melodyFloor,
        fineFrames: traceFrames,
        savedAt: Date.now(),
      });
      deriveStale = false;
      rerenderView();
    },
    // ---- saved takes (Phase 3) ----
    saveTake: (name) => persistTake(name, false),
    saveTakeAsNew: (name) => persistTake(name, true),
    loadTakeById,
    deleteTakeById,
    undeleteTake,
    print,
    dispose() {
      disposed = true;
      clearTimeout(rerenderTimer);
      if (recorder.micOn) recorder.stopMic();
      player.dispose();
      analyzer.dispose();
      view.dispose();
    },
  };
}
